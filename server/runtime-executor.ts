import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ZodType } from "zod";
import type { AIControlPlaneStore } from "./ai-control-plane.ts";
import type { AgentRuntimeId } from "./domain.ts";

const execFileAsync = promisify(execFile);

interface RuntimeResult<T> {
  output: T;
  runtimeId: AgentRuntimeId;
  model: string;
  durationMs: number;
  activityCount: number;
  attempts: number;
}

type RuntimeRunner = (command: string, args: string[], cwd: string) => Promise<{ stdout: string; stderr: string }>;

function jsonCandidate(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("The runtime returned an empty response.");
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    if (fenced) return JSON.parse(fenced.trim());
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error("The runtime response did not contain valid JSON.");
  }
}

function textFromClaude(stdout: string): { text: string; activityCount: number } {
  const value = JSON.parse(stdout) as { result?: string; structured_output?: unknown };
  return { text: value.structured_output ? JSON.stringify(value.structured_output) : String(value.result || ""), activityCount: 1 };
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
  return { text: fragments.at(-1) || fragments.join("\n"), activityCount: lines.length };
}

export class AgentRuntimeExecutor {
  private readonly controlPlane: AIControlPlaneStore;
  private readonly runner: RuntimeRunner;

  constructor(
    controlPlane: AIControlPlaneStore,
    runner: RuntimeRunner = async (command, args, cwd) => {
      const result = await execFileAsync(command, args, { cwd, timeout: 180_000, maxBuffer: 8 * 1024 * 1024 });
      return { stdout: result.stdout, stderr: result.stderr };
    },
  ) {
    this.controlPlane = controlPlane;
    this.runner = runner;
  }

  async generateObject<T>(input: {
    schema: ZodType<T>;
    prompt: string;
    contextFiles: Record<string, unknown>;
  }): Promise<RuntimeResult<T>> {
    const execution = await this.controlPlane.getExecutionProfile();
    if (execution.runtimeId === "native") throw new Error("The native runtime must use the native model executor.");
    const workspace = await mkdtemp(join(tmpdir(), "distribution-os-runtime-"));
    const outputFile = join(workspace, "last-message.json");
    try {
      await Promise.all(Object.entries(input.contextFiles).map(([name, value]) => writeFile(join(workspace, `${name}.json`), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })));
      const guardrail = [
        input.prompt,
        "Read the JSON evidence files in the current temporary workspace before deciding.",
        "Do not edit files, run network requests, publish content, or claim access to live audience signals.",
        "Return only one JSON object matching the requested shape. Do not wrap it in commentary.",
      ].join("\n\n");
      const modelArgs = execution.runtimeModel ? ["--model", execution.runtimeModel] : [];
      let command = "";
      let args: string[] = [];
      if (execution.runtimeId === "claude-code") {
        command = "claude";
        args = ["-p", "--no-session-persistence", "--permission-mode", "plan", "--tools", "Read,Glob,Grep", "--output-format", "json", ...modelArgs, guardrail];
      } else if (execution.runtimeId === "opencode") {
        command = "opencode";
        args = ["run", "--pure", "--format", "json", "--dir", workspace, ...modelArgs, guardrail];
      } else if (execution.runtimeId === "codex") {
        command = "codex";
        args = ["exec", "--json", "--sandbox", "read-only", "--ephemeral", "--skip-git-repo-check", "-C", workspace, "-o", outputFile, ...modelArgs.flatMap((value, index) => index === 0 ? ["-m"] : [value]), guardrail];
      } else {
        command = "cursor-agent";
        args = ["-p", "--output-format", "json", ...modelArgs, guardrail];
      }
      const startedAt = Date.now();
      let previousError: unknown;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const attemptPrompt = `${guardrail}${attempt === 2 ? "\n\nYour previous response was not valid for the requested schema. Return one complete JSON object and nothing else." : ""}`;
        const result = await this.runner(command, [...args.slice(0, -1), attemptPrompt], workspace);
        let normalized: { text: string; activityCount: number };
        if (execution.runtimeId === "claude-code") normalized = textFromClaude(result.stdout);
        else if (execution.runtimeId === "codex") {
          const finalText = await readFile(outputFile, "utf8").catch(() => "");
          normalized = finalText.trim() ? { text: finalText, activityCount: result.stdout.split("\n").filter(Boolean).length } : textFromJsonLines(result.stdout);
        } else normalized = textFromJsonLines(result.stdout);
        try {
          return {
            output: input.schema.parse(jsonCandidate(normalized.text)),
            runtimeId: execution.runtimeId,
            model: execution.runtimeModel || "runtime default",
            durationMs: Date.now() - startedAt,
            activityCount: normalized.activityCount,
            attempts: attempt,
          };
        } catch (error) {
          previousError = error;
          if (attempt === 2) throw error;
        }
      }
      throw previousError;
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }
}
