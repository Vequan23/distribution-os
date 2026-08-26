import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z, type ZodType } from "zod";
import type { AIControlPlaneStore } from "./ai-control-plane.ts";
import type { AgentRuntimeId, RuntimeFailureCode } from "./domain.ts";

interface RuntimeResult<T> {
  output: T;
  runtimeId: AgentRuntimeId;
  model: string;
  durationMs: number;
  activityCount: number;
  attempts: number;
}

type RuntimeRunner = (command: string, args: string[], cwd: string, options?: { signal?: AbortSignal }) => Promise<{ stdout: string; stderr: string }>;

export function runRuntimeCommand(command: string, args: string[], cwd: string, options?: { signal?: AbortSignal }): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, {
      cwd,
      signal: options?.signal,
      timeout: 75_000,
      maxBuffer: 8 * 1024 * 1024,
      encoding: "utf8",
    }, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stdout: String(stdout || ""), stderr: String(stderr || "") }));
        return;
      }
      resolve({ stdout: String(stdout || ""), stderr: String(stderr || "") });
    });
    // Agent CLIs treat a piped stdin as more prompt input and wait for EOF.
    child.stdin?.end();
  });
}

export interface RuntimeProbeOutcome {
  ok: boolean;
  runtimeId: AgentRuntimeId;
  durationMs: number;
  failureCode?: RuntimeFailureCode;
  detail: string;
}

class RuntimeExecutionError extends Error {
  readonly code: RuntimeFailureCode;

  constructor(code: RuntimeFailureCode, message: string) {
    super(message);
    this.name = "RuntimeExecutionError";
    this.code = code;
  }
}

function commandFailure(error: unknown): Error {
  if (error instanceof Error && error.name === "AbortError") return error;
  const record = error as { message?: string; stdout?: string; stderr?: string; code?: string | number; killed?: boolean; signal?: string };
  const privateDiagnostic = `${record.message || ""}\n${record.stdout || ""}\n${record.stderr || ""}`.toLowerCase();
  if (record.killed || record.signal === "SIGTERM" || privateDiagnostic.includes("timed out") || privateDiagnostic.includes("timeout")) {
    return new RuntimeExecutionError("timeout", "The runtime did not complete the bounded readiness task within 75 seconds.");
  }
  if (/auth|login|log in|unauthori[sz]ed|credential|api key|token/.test(privateDiagnostic)) {
    return new RuntimeExecutionError("authentication-required", "The runtime rejected the request because its own authentication is not ready.");
  }
  return new RuntimeExecutionError("invocation-failed", "The runtime process exited before returning a reviewable result.");
}

export function runtimeFailureDiagnostic(error: unknown): { failureCode: RuntimeFailureCode; detail: string } {
  if (error instanceof RuntimeExecutionError) return { failureCode: error.code, detail: error.message };
  return { failureCode: "invocation-failed", detail: "The runtime failed before returning a reviewable result." };
}

function jsonCandidate(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) throw new RuntimeExecutionError("empty-response", "The runtime completed without returning a final response.");
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    if (fenced) {
      try {
        return JSON.parse(fenced.trim());
      } catch {
        // Continue to the bounded object candidate before returning a safe category.
      }
    }
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        // Fall through to the privacy-safe invalid JSON diagnostic.
      }
    }
    throw new RuntimeExecutionError("invalid-json", "The runtime returned text, but it was not a complete JSON object.");
  }
}

function textFromClaude(stdout: string): { text: string; activityCount: number } {
  try {
    const value = JSON.parse(stdout) as { result?: string; structured_output?: unknown };
    return { text: value.structured_output ? JSON.stringify(value.structured_output) : String(value.result || ""), activityCount: 1 };
  } catch {
    throw new RuntimeExecutionError("invalid-json", "The runtime transport returned an unreadable JSON envelope.");
  }
}

function textFromJsonLines(stdout: string): { text: string; activityCount: number } {
  const lines = stdout.split("\n").filter(Boolean);
  const fragments: string[] = [];
  for (const line of lines) {
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      const part = event.part as Record<string, unknown> | undefined;
      const item = event.item as Record<string, unknown> | undefined;
      if (typeof part?.text === "string") fragments.push(part.text);
      if (item?.type === "agent_message" && typeof item.text === "string") fragments.push(item.text);
      if (typeof event.text === "string" && (event.type === "text" || event.type === "message")) fragments.push(event.text);
      if (event.type === "result" && typeof event.result === "string") fragments.push(event.result);
    } catch {
      // Keep processing valid events. Raw diagnostic lines are never persisted.
    }
  }
  const completeJson = [...fragments].reverse().find((fragment) => {
    try {
      JSON.parse(fragment.trim());
      return true;
    } catch {
      return false;
    }
  });
  const joined = fragments.join("");
  const joinedLines = fragments.join("\n");
  let text = completeJson || fragments.at(-1) || joinedLines;
  if (!completeJson && fragments.length > 1) {
    try {
      JSON.parse(joined);
      text = joined;
    } catch {
      try {
        JSON.parse(joinedLines);
        text = joinedLines;
      } catch {
        // The downstream JSON normalizer will return a privacy-safe failure category.
      }
    }
  }
  return { text, activityCount: lines.length };
}

export class AgentRuntimeExecutor {
  private readonly controlPlane: AIControlPlaneStore;
  private readonly runner: RuntimeRunner;

  constructor(
    controlPlane: AIControlPlaneStore,
    runner: RuntimeRunner = runRuntimeCommand,
  ) {
    this.controlPlane = controlPlane;
    this.runner = runner;
  }

  async generateObject<T>(input: {
    schema: ZodType<T>;
    prompt: string;
    contextFiles: Record<string, unknown>;
    signal?: AbortSignal;
  }): Promise<RuntimeResult<T>> {
    const execution = await this.controlPlane.getExecutionProfile();
    if (execution.runtimeId === "native") throw new Error("The native runtime must use the native model executor.");
    return this.generateForRuntime(execution.runtimeId, execution.runtimeModel, input, 2);
  }

  async probeRuntime(runtimeId: AgentRuntimeId, runtimeModel = ""): Promise<RuntimeProbeOutcome> {
    if (runtimeId === "native") return { ok: true, runtimeId, durationMs: 0, detail: "The built-in runtime is ready." };
    if (!["claude-code", "cursor", "opencode", "codex"].includes(runtimeId)) {
      return { ok: false, runtimeId, durationMs: 0, failureCode: "invocation-failed", detail: "Choose a supported external runtime." };
    }
    const startedAt = Date.now();
    try {
      await this.generateForRuntime(runtimeId, runtimeModel, {
        schema: z.object({ status: z.literal("ready"), evidenceLabel: z.literal("runtime-probe") }).strict(),
        prompt: 'Read probe.json, then return exactly {"status":"ready","evidenceLabel":"runtime-probe"}.',
        contextFiles: { probe: { label: "runtime-probe", purpose: "Verify bounded JSON generation through the selected local runtime adapter." } },
      }, 1);
      return { ok: true, runtimeId, durationMs: Date.now() - startedAt, detail: "Authenticated and returned schema-valid bounded output." };
    } catch (error) {
      const diagnostic = runtimeFailureDiagnostic(error);
      return { ok: false, runtimeId, durationMs: Date.now() - startedAt, ...diagnostic };
    }
  }

  private async generateForRuntime<T>(runtimeId: Exclude<AgentRuntimeId, "native">, runtimeModel: string, input: {
    schema: ZodType<T>;
    prompt: string;
    contextFiles: Record<string, unknown>;
    signal?: AbortSignal;
  }, maxAttempts: 1 | 2): Promise<RuntimeResult<T>> {
    const workspace = await mkdtemp(join(tmpdir(), "distribution-os-runtime-"));
    const outputFile = join(workspace, "last-message.json");
    const outputSchemaFile = join(workspace, "output-schema.json");
    try {
      await Promise.all(Object.entries(input.contextFiles).map(([name, value]) => writeFile(join(workspace, `${name}.json`), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })));
      await writeFile(outputSchemaFile, `${JSON.stringify(z.toJSONSchema(input.schema), null, 2)}\n`, { mode: 0o600 });
      const guardrail = [
        input.prompt,
        "Read the JSON evidence files in the current temporary workspace before deciding.",
        "Do not edit files, run network requests, publish content, or claim access to live audience signals.",
        "Return only one JSON object matching the requested shape. Do not wrap it in commentary.",
      ].join("\n\n");
      const modelArgs = runtimeModel ? ["--model", runtimeModel] : [];
      let command = "";
      let args: string[] = [];
      if (runtimeId === "claude-code") {
        command = "claude";
        args = ["-p", "--no-session-persistence", "--permission-mode", "plan", "--tools", "Read,Glob,Grep", "--output-format", "json", ...modelArgs, guardrail];
      } else if (runtimeId === "opencode") {
        command = "opencode";
        args = ["run", "--pure", "--format", "json", "--dir", workspace, ...modelArgs, guardrail];
      } else if (runtimeId === "codex") {
        command = "codex";
        args = ["exec", "--json", "--sandbox", "read-only", "--ephemeral", "--skip-git-repo-check", "-C", workspace, "--output-schema", outputSchemaFile, "-o", outputFile, ...modelArgs.flatMap((value, index) => index === 0 ? ["-m"] : [value]), guardrail];
      } else {
        command = "cursor-agent";
        args = ["-p", "--output-format", "json", ...modelArgs, guardrail];
      }
      const startedAt = Date.now();
      let previousError: unknown;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        if (input.signal?.aborted) throw new DOMException("The runtime request was cancelled.", "AbortError");
        const attemptPrompt = `${guardrail}${attempt === 2 ? "\n\nYour previous response was not valid for the requested schema. Return one complete JSON object and nothing else." : ""}`;
        if (runtimeId === "codex") await rm(outputFile, { force: true });
        let result: { stdout: string; stderr: string };
        try {
          result = await this.runner(command, [...args.slice(0, -1), attemptPrompt], workspace, { signal: input.signal });
        } catch (error) {
          throw commandFailure(error);
        }
        let normalized: { text: string; activityCount: number };
        if (runtimeId === "claude-code") normalized = textFromClaude(result.stdout);
        else if (runtimeId === "codex") {
          const finalText = await readFile(outputFile, "utf8").catch(() => "");
          normalized = finalText.trim() ? { text: finalText, activityCount: result.stdout.split("\n").filter(Boolean).length } : textFromJsonLines(result.stdout);
        } else normalized = textFromJsonLines(result.stdout);
        try {
          const parsed = input.schema.safeParse(jsonCandidate(normalized.text));
          if (!parsed.success) throw new RuntimeExecutionError("schema-invalid", "The runtime returned JSON that did not match the required evidence schema.");
          return {
            output: parsed.data,
            runtimeId,
            model: runtimeModel || "runtime default",
            durationMs: Date.now() - startedAt,
            activityCount: normalized.activityCount,
            attempts: attempt,
          };
        } catch (error) {
          previousError = error;
          if (attempt === maxAttempts) throw error;
        }
      }
      throw previousError;
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }
}
