import { execFile } from "node:child_process";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { promisify } from "node:util";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { DistributionDatabase } from "./database.ts";
import type { DistributionActionFabric } from "./action-fabric.ts";
import type {
  ActionAdapterDescriptor,
  ActionCapability,
  ActionExecutionRecord,
  ActionResult,
  ActionToolDescriptor,
} from "../packages/action-fabric/src/index.ts";

const execFileAsync = promisify(execFile);
const SECRET_KEY = /(token|secret|password|passphrase|api[-_]?key|authorization|cookie|credential)/i;

function redactSensitiveText(value: string): string {
  return value
    .replace(/(?:bearer\s+|sk-|ghp_|github_pat_|npm_)[a-z0-9._-]+/gi, "[redacted]")
    .replace(/([?&](?:token|key|secret|password|authorization)=)[^&\s]+/gi, "$1[redacted]");
}

function boundedMessage(error: unknown, fallback: string): string {
  const value = error instanceof Error ? error.message : fallback;
  return redactSensitiveText(value).slice(0, 500) || fallback;
}

function sanitizeArguments(value: unknown, path = "arguments", depth = 0): unknown {
  if (depth > 8) throw new Error("Tool arguments are nested too deeply.");
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") return redactSensitiveText(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${path} contains a non-finite number.`);
    return value;
  }
  if (Array.isArray(value)) return value.map((item, index) => sanitizeArguments(item, `${path}[${index}]`, depth + 1));
  if (typeof value !== "object") throw new Error(`${path} contains an unsupported value.`);
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY.test(key)) throw new Error(`Tool arguments may not include credential field "${key}".`);
    output[key] = sanitizeArguments(item, `${path}.${key}`, depth + 1);
  }
  return output;
}

type McpToolLike = {
  name: string;
  description?: string;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
};

function inferToolCapabilities(name: string, description: string, annotations?: McpToolLike["annotations"]): ActionCapability[] {
  const value = `${name} ${description}`.toLowerCase();
  const capabilities = new Set<ActionCapability>();
  if (/\b(search|find|query|lookup|discover)\b/.test(value)) capabilities.add("search");
  if (/\b(list|get|read|fetch|inspect|view|retrieve)\b/.test(value)) capabilities.add("read");
  if (/\b(observe|monitor|watch|scan|signal)\b/.test(value)) capabilities.add("observe");
  if (/\b(draft|generate|prepare|compose|summarize)\b/.test(value)) capabilities.add("prepare");
  if (/\b(post|publish|send|reply|comment|create|update|edit|write|delete|remove|invite|message|react|deploy|submit|trigger|run|mutate|upload|approve)\b/.test(value)) capabilities.add("execute");
  if (/\b(measure|metric|analytics|stats|performance|outcome)\b/.test(value)) capabilities.add("measure");
  if (annotations?.readOnlyHint === false || annotations?.destructiveHint === true) capabilities.add("execute");
  if (annotations?.readOnlyHint === true && !capabilities.size) capabilities.add("read");
  if (capabilities.has("execute")) return ["execute"];
  return [...capabilities];
}

function mapMcpTools(
  tools: McpToolLike[],
  declared: ActionCapability[],
): ActionToolDescriptor[] {
  return tools.slice(0, 100).flatMap((tool): ActionToolDescriptor[] => {
    const inferred = inferToolCapabilities(tool.name, tool.description || "", tool.annotations);
    const capabilities = inferred.filter((capability) => declared.includes(capability));
    if (!capabilities.length) return [];
    const publicSideEffect = capabilities.includes("execute");
    return [{
      name: tool.name.slice(0, 160), description: (tool.description || "MCP tool").slice(0, 500), capabilities,
      risk: publicSideEffect ? "identity-bearing" : capabilities.includes("prepare") ? "private-write" : "read-only",
      publicSideEffect,
    }];
  });
}

function isBlockedAddress(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^::ffff:/, "");
  if (isIP(normalized) === 4) {
    const [a, b] = normalized.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && (b === 0 || b === 168))
      || (a === 198 && (b === 18 || b === 19 || b === 51))
      || (a === 203 && b === 0);
  }
  if (isIP(normalized) === 6) {
    return normalized === "::" || normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd")
      || /^fe[89ab]/.test(normalized) || normalized.startsWith("ff") || normalized.startsWith("2001:db8:");
  }
  return true;
}

async function withTimeout<T>(operation: Promise<T>, milliseconds: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export class ActionConnectionService {
  private readonly database: DistributionDatabase;
  private readonly policy: DistributionActionFabric;

  constructor(database: DistributionDatabase, policy: DistributionActionFabric) {
    this.database = database;
    this.policy = policy;
  }

  async probe(adapterId: string): Promise<ActionAdapterDescriptor> {
    const connection = this.database.getActionAdapterConnection(adapterId);
    if (connection.descriptor.state === "disabled") throw new Error("Enable this adapter before testing it.");
    try {
      const tools = connection.descriptor.transport === "mcp" || connection.descriptor.transport === "managed-gateway"
        ? await this.probeMcp(connection)
        : connection.descriptor.transport === "cli"
          ? await this.probeCli(connection)
          : [{ name: "human-handoff", description: "Human performs the approved external action.", capabilities: connection.descriptor.capabilities, risk: connection.descriptor.risk, publicSideEffect: connection.descriptor.publicSideEffect }];
      if (!tools.length) throw new Error("The connection exposed no tools matching the adapter's declared capabilities.");
      return this.database.recordActionAdapterProbe(adapterId, tools);
    } catch (error) {
      const message = boundedMessage(error, "The connection could not be verified.");
      this.database.recordActionAdapterProbe(adapterId, [], message);
      throw new Error(message);
    }
  }

  async request(input: {
    adapterId: string; capability: ActionCapability; toolName: string; purpose: string; evidenceRefs: string[];
    arguments: Record<string, unknown>; idempotencyKey: string; dryRun?: boolean; budgetLimit?: number;
  }): Promise<ActionExecutionRecord> {
    const adapter = this.database.getActionAdapters().find((item) => item.id === input.adapterId);
    if (!adapter) throw new Error("Action adapter not found.");
    const tool = adapter.connection.tools.find((item) => item.name === input.toolName);
    const evidenceRefs = [...new Set(input.evidenceRefs.map((value) => value.trim()).filter(Boolean))].slice(0, 100);
    if (evidenceRefs.some((value) => value.length > 200 || !/^[A-Za-z0-9_.:@/-]+$/.test(value))) throw new Error("Evidence references must be bounded local record IDs.");
    const args = sanitizeArguments(input.arguments) as Record<string, unknown>;
    if (JSON.stringify(args).length > 32_000) throw new Error("Tool arguments exceed the 32 KB connection boundary.");
    const capabilityDeclaredByTool = tool?.capabilities.includes(input.capability) === true;
    const budgetLimit = input.budgetLimit ?? 1;
    if (!Number.isInteger(budgetLimit) || budgetLimit < 1 || budgetLimit > 20) throw new Error("Action budget must be a whole number between 1 and 20.");
    const decision = this.policy.evaluate({
      adapterId: adapter.id, capability: input.capability, evidenceRefs,
      purpose: input.purpose, approved: false, dryRun: input.dryRun,
      budgetLimit,
    });
    if (!tool || !capabilityDeclaredByTool) {
      decision.status = "blocked";
      decision.reasons = ["The selected tool did not expose the requested capability during the latest verified discovery."];
    }
    if (adapter.origin === "core" && adapter.id !== "human-handoff") {
      decision.status = "blocked";
      decision.reasons = ["This core capability is executed through its purpose-built Distribution OS workflow, not the generic connection runner."];
    }
    const status = decision.status === "allowed" ? "running" : decision.status;
    const created = this.database.createActionExecution({
      adapterId: adapter.id, capability: input.capability, toolName: input.toolName, status,
      purpose: input.purpose, evidenceRefs, arguments: args, decision, idempotencyKey: input.idempotencyKey, dryRun: input.dryRun === true,
    });
    if (!created.created || status !== "running") return created.record;
    if (input.dryRun) {
      return this.database.updateActionExecution(created.record.id, "completed", "Dry run passed policy. The transport was not called and no external action occurred.");
    }
    return this.execute(created.record, args);
  }

  async approve(id: string): Promise<ActionExecutionRecord> {
    const record = this.database.getActionExecution(id);
    if (record.status !== "approval-required") return record;
    const adapter = this.database.getActionAdapters().find((item) => item.id === record.adapterId);
    const tool = adapter?.connection.tools.find((item) => item.name === record.toolName);
    if (!adapter || adapter.state !== "available" || !tool?.capabilities.includes(record.capability)) {
      return this.database.updateActionExecution(id, "blocked", "", "The connection or discovered capability changed before approval.");
    }
    const decision = this.policy.evaluate({
      adapterId: record.adapterId, capability: record.capability, evidenceRefs: record.evidenceRefs,
      purpose: record.purpose, approved: true, budgetLimit: 1,
    });
    if (decision.status !== "allowed") return this.database.updateActionExecution(id, "blocked", "", decision.reasons.join(" "));
    const approval = this.database.markActionExecutionApproved(id);
    if (!approval.claimed) return approval.record;
    return this.execute(approval.record, this.database.getActionExecutionPayload(id));
  }

  private async execute(record: ActionExecutionRecord, args: Record<string, unknown>): Promise<ActionExecutionRecord> {
    try {
      if (record.adapterId === "human-handoff") {
        const result = this.manualHandoff(record);
        return this.database.updateActionExecution(record.id, "completed", result.summary);
      }
      const connection = this.database.getActionAdapterConnection(record.adapterId);
      const result = connection.descriptor.transport === "mcp" || connection.descriptor.transport === "managed-gateway"
        ? await this.callMcp(connection, record.toolName, args, record)
        : connection.descriptor.transport === "cli"
          ? await this.callCli(connection, record.toolName, args, record)
          : this.manualHandoff(record);
      return this.database.updateActionExecution(record.id, result.status === "completed" ? "completed" : "failed", result.summary, result.diagnostics, result.externalId, result.externalUrl);
    } catch (error) {
      return this.database.updateActionExecution(record.id, "failed", "The adapter stopped without a confirmed external result.", boundedMessage(error, "Connection execution failed."));
    }
  }

  private async probeMcp(connection: ReturnType<DistributionDatabase["getActionAdapterConnection"]>): Promise<ActionToolDescriptor[]> {
    const { client, transport } = await this.connectMcp(connection);
    try {
      const result = await withTimeout(client.listTools(), 12_000, "MCP tool discovery timed out.");
      return mapMcpTools(result.tools, connection.descriptor.capabilities);
    } finally {
      await this.closeMcp(client, transport);
    }
  }

  private async callMcp(connection: ReturnType<DistributionDatabase["getActionAdapterConnection"]>, toolName: string, args: Record<string, unknown>, record: ActionExecutionRecord): Promise<ActionResult> {
    const { client, transport } = await this.connectMcp(connection);
    const startedAt = new Date().toISOString();
    try {
      const current = await withTimeout(client.listTools(), 12_000, "MCP tool verification timed out.");
      const mapped = mapMcpTools(current.tools, connection.descriptor.capabilities).find((item) => item.name === toolName);
      if (!mapped?.capabilities.includes(record.capability)) throw new Error("The MCP tool changed or no longer exposes the approved capability.");
      const result = await withTimeout(client.callTool({ name: toolName, arguments: args }), 45_000, "MCP tool call timed out.");
      const summary = this.summarizeMcpResult(result);
      return {
        actionId: record.id, adapterId: record.adapterId, capability: record.capability,
        status: result.isError ? "failed" : "completed", summary: result.isError ? "The MCP tool returned an error." : summary,
        externalId: this.extractString(result.structuredContent, ["id", "externalId", "postId"]),
        externalUrl: this.extractExternalUrl(result.structuredContent, ["url", "externalUrl", "permalink"]),
        diagnostics: result.isError ? summary : "", startedAt, completedAt: new Date().toISOString(),
      };
    } finally {
      await this.closeMcp(client, transport);
    }
  }

  private async connectMcp(connection: ReturnType<DistributionDatabase["getActionAdapterConnection"]>): Promise<{ client: Client; transport: StreamableHTTPClientTransport }> {
    const endpoint = connection.config.endpoint;
    if (!endpoint) throw new Error("This adapter has no MCP endpoint.");
    await this.assertSafeMcpEndpoint(endpoint);
    const token = connection.credentialEnv ? process.env[connection.credentialEnv]?.trim() : "";
    if (connection.credentialEnv && !token) throw new Error(`${connection.credentialEnv} is not available to the local service.`);
    const client = new Client({ name: "distribution-os-action-fabric", version: "1.0.0" });
    const endpointUrl = new URL(endpoint);
    const guardedFetch: typeof fetch = async (input, init) => {
      const requestUrl = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      if (requestUrl.origin !== endpointUrl.origin) throw new Error("MCP transport requests may not leave the verified endpoint origin.");
      await this.assertSafeMcpEndpoint(requestUrl.toString());
      const response = await fetch(input, { ...init, redirect: "manual" });
      if (response.status >= 300 && response.status < 400) throw new Error("MCP endpoint redirects are disabled by the host.");
      return response;
    };
    const transport = new StreamableHTTPClientTransport(endpointUrl, { ...(token ? { authProvider: { token: async () => token } } : {}), fetch: guardedFetch });
    try {
      await withTimeout(client.connect(transport), 12_000, "MCP connection timed out.");
      return { client, transport };
    } catch (error) {
      await this.closeMcp(client, transport);
      throw error;
    }
  }

  private async probeCli(connection: ReturnType<DistributionDatabase["getActionAdapterConnection"]>): Promise<ActionToolDescriptor[]> {
    const command = connection.config.command;
    if (command !== "gh") throw new Error("Only the GitHub CLI is available as an Action Fabric connector. Agent CLIs belong to the AI Harness.");
    await withTimeout(execFileAsync(command, ["--version"], { timeout: 5_000, maxBuffer: 32_000 }), 6_000, "CLI probe timed out.");
    await withTimeout(execFileAsync(command, ["auth", "status", "--active"], { timeout: 8_000, maxBuffer: 32_000 }), 9_000, "GitHub CLI authentication check timed out.");
    return [{ name: "list-issues", description: "List bounded GitHub issues from an explicitly named repository.", capabilities: ["observe", "search", "read"], risk: "read-only", publicSideEffect: false }];
  }

  private async callCli(connection: ReturnType<DistributionDatabase["getActionAdapterConnection"]>, toolName: string, args: Record<string, unknown>, record: ActionExecutionRecord): Promise<ActionResult> {
    if (connection.config.command !== "gh" || toolName !== "list-issues") throw new Error("This CLI tool is not allowlisted.");
    const repository = String(args.repository || "");
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error("GitHub CLI issue discovery requires an owner/repository value.");
    const rawLimit = args.limit ?? 10;
    const limit = Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error("GitHub issue limit must be a whole number between 1 and 20.");
    const startedAt = new Date().toISOString();
    const result = await execFileAsync("gh", ["issue", "list", "--repo", repository, "--limit", String(limit), "--json", "number,title,url,updatedAt"], { timeout: 15_000, maxBuffer: 128_000 });
    const issues = JSON.parse(result.stdout) as unknown[];
    return { actionId: record.id, adapterId: record.adapterId, capability: record.capability, status: "completed", summary: `${issues.length} issue${issues.length === 1 ? "" : "s"} returned by the bounded GitHub CLI query.`, externalId: "", externalUrl: "", diagnostics: "", startedAt, completedAt: new Date().toISOString() };
  }

  private manualHandoff(record: ActionExecutionRecord): ActionResult {
    const timestamp = new Date().toISOString();
    return { actionId: record.id, adapterId: record.adapterId, capability: record.capability, status: "completed", summary: "The approved context is ready for the human-owned handoff. Distribution OS did not claim the external action occurred.", externalId: "", externalUrl: "", diagnostics: "", startedAt: timestamp, completedAt: timestamp };
  }

  private summarizeMcpResult(result: { content?: unknown; structuredContent?: unknown }): string {
    if (Array.isArray(result.content)) {
      const text = result.content.flatMap((block) => typeof block === "object" && block !== null && "type" in block && block.type === "text" && "text" in block ? [String(block.text)] : []).join("\n").trim();
      if (text) return redactSensitiveText(text).slice(0, 2_000);
    }
    if (result.structuredContent && typeof result.structuredContent === "object") return redactSensitiveText(JSON.stringify(result.structuredContent)).slice(0, 2_000);
    return "The MCP tool completed without a textual result.";
  }

  private extractString(value: unknown, keys: string[]): string {
    if (!value || typeof value !== "object") return "";
    for (const key of keys) {
      const candidate = (value as Record<string, unknown>)[key];
      if (typeof candidate === "string") return redactSensitiveText(candidate).slice(0, 1_000);
    }
    return "";
  }

  private extractExternalUrl(value: unknown, keys: string[]): string {
    const candidate = this.extractString(value, keys);
    if (!candidate) return "";
    try {
      const url = new URL(candidate);
      return url.protocol === "http:" || url.protocol === "https:" ? url.toString().slice(0, 1_000) : "";
    } catch {
      return "";
    }
  }

  private async assertSafeMcpEndpoint(endpoint: string): Promise<void> {
    const url = new URL(endpoint);
    if (new Set(["localhost", "127.0.0.1", "[::1]", "::1"]).has(url.hostname)) return;
    if (isIP(url.hostname)) {
      if (isBlockedAddress(url.hostname)) throw new Error("MCP endpoints may not target private, loopback, link-local, or reserved networks.");
      return;
    }
    const addresses = await withTimeout(lookup(url.hostname, { all: true }), 5_000, "MCP endpoint DNS lookup timed out.");
    if (!addresses.length || addresses.some((entry) => isBlockedAddress(entry.address))) throw new Error("MCP endpoint resolved to a private or reserved network.");
  }

  private async closeMcp(client: Client, transport: StreamableHTTPClientTransport): Promise<void> {
    try { await transport.terminateSession(); } catch { /* stateless or not connected */ }
    try { await client.close(); } catch { /* preserve the original connection/tool error */ }
  }
}
