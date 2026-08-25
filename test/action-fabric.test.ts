import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import test from "node:test";
import { McpServer, WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { z } from "zod";
import { ActionFabricRegistry, evaluateActionPolicy, type ActionAdapter, type ActionIntent } from "../packages/action-fabric/src/index.ts";
import { DistributionDatabase } from "../server/database.ts";
import { DistributionActionFabric } from "../server/action-fabric.ts";
import { ActionConnectionService } from "../server/action-connections.ts";

function intent(overrides: Partial<ActionIntent> = {}): ActionIntent {
  return {
    id: "action-1",
    adapterId: "publisher",
    capability: "execute",
    actorId: "local-user",
    resourceId: "product-1",
    purpose: "Publish an approved, evidence-cited contribution.",
    evidenceRefs: ["evidence-1"],
    idempotencyKey: "publish:product-1:one",
    requestedAt: new Date().toISOString(),
    approved: false,
    dryRun: false,
    budget: { used: 0, limit: 1 },
    ...overrides,
  };
}

test("identity-bearing actions always stop for explicit approval", () => {
  const adapter: ActionAdapter["descriptor"] = {
    id: "publisher", name: "Publisher", version: "1.0.0", description: "Publishes a contribution.",
    transport: "managed-gateway", capabilities: ["execute"], risk: "identity-bearing", approval: "none",
    state: "available", publicSideEffect: true, origin: "user", configSummary: "External gateway",
  };
  const waiting = evaluateActionPolicy(adapter, intent());
  assert.equal(waiting.status, "approval-required");
  assert.equal(waiting.approval, "every-time");
  assert.equal(evaluateActionPolicy(adapter, intent({ approved: true })).status, "allowed");
});

test("policy blocks undeclared capabilities, missing evidence, and exhausted budgets", () => {
  const adapter: ActionAdapter["descriptor"] = {
    id: "publisher", name: "Reader", version: "1.0.0", description: "Reads evidence.",
    transport: "mcp", capabilities: ["read"], risk: "read-only", approval: "first-use",
    state: "available", publicSideEffect: false, origin: "user", configSummary: "localhost",
  };
  const decision = evaluateActionPolicy(adapter, intent({ capability: "prepare", evidenceRefs: [], budget: { used: 1, limit: 1 } }));
  assert.equal(decision.status, "blocked");
  assert.match(decision.reasons.join(" "), /did not declare/i);
  assert.match(decision.reasons.join(" "), /evidence/i);
  assert.match(decision.reasons.join(" "), /budget/i);
});

test("registry returns the first completed result for a repeated idempotency key", async () => {
  let calls = 0;
  const adapter: ActionAdapter = {
    descriptor: {
      id: "publisher", name: "Private writer", version: "1.0.0", description: "Writes a private artifact.",
      transport: "direct-api", capabilities: ["prepare"], risk: "private-write", approval: "none",
      state: "available", publicSideEffect: false, origin: "core", configSummary: "Local ledger",
    },
    execute: async (action) => {
      calls += 1;
      return {
        actionId: action.id, adapterId: action.adapterId, capability: action.capability, status: "completed",
        summary: "Private artifact prepared.", externalId: "", externalUrl: "", diagnostics: "",
        startedAt: action.requestedAt, completedAt: new Date().toISOString(),
      };
    },
  };
  const registry = new ActionFabricRegistry();
  registry.register(adapter);
  const action = intent({ capability: "prepare", approved: true });
  const first = await registry.execute(action);
  const repeated = await registry.execute({ ...action, id: "action-2" });
  assert.equal(first.result?.summary, "Private artifact prepared.");
  assert.equal(repeated.result?.actionId, "action-1");
  assert.equal(calls, 1);
  await assert.rejects(() => registry.execute({ ...action, id: "action-3", purpose: "A different action using the same key." }), /already bound/i);
});

test("configured adapters store only bounded manifests and reject arbitrary shell", () => {
  const directory = mkdtempSync(join(tmpdir(), "distribution-os-action-fabric-"));
  const database = new DistributionDatabase(directory);
  try {
    assert.throws(() => database.createActionAdapter({ name: "Unsafe", transport: "cli", capabilities: ["read"], command: "sh -c env" }), /supported executable|forbidden/i);
    assert.throws(() => database.createActionAdapter({ name: "Overpowered CLI", transport: "cli", capabilities: ["execute"], command: "gh" }), /read-only/i);
    assert.throws(() => database.createActionAdapter({ name: "Overpowered handoff", transport: "manual", capabilities: ["read", "execute"] }), /execute and measure/i);
    assert.throws(() => database.createActionAdapter({ name: "Credential leak", transport: "cli", capabilities: ["read"], command: "gh", credentialEnv: "GH_TOKEN" }), /only supported by MCP/i);
    assert.throws(() => database.createActionAdapter({ name: "Unsafe MCP", transport: "mcp", capabilities: ["read"], endpoint: "http://example.com/mcp" }), /must use HTTPS/i);
    const adapter = database.createActionAdapter({ name: "Research MCP", transport: "mcp", capabilities: ["observe", "read"], endpoint: "http://127.0.0.1:3456/mcp" });
    assert.equal(adapter.state, "setup-required");
    assert.equal(adapter.approval, "none");
    assert.equal(adapter.publicSideEffect, false);
    assert.equal(database.getActionAdapters().find((item) => item.id === "github-observer")?.state, "setup-required");
    assert.doesNotMatch(JSON.stringify(database.getAutomationState()), /127\.0\.0\.1:3456\/mcp/);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("manual connection actions stop for approval, execute once, and remain idempotent", async () => {
  const directory = mkdtempSync(join(tmpdir(), "distribution-os-connection-loop-"));
  const database = new DistributionDatabase(directory);
  const connections = new ActionConnectionService(database, new DistributionActionFabric(database));
  try {
    const adapter = database.createActionAdapter({ name: "Founder handoff", transport: "manual", capabilities: ["execute", "measure"] });
    const verified = await connections.probe(adapter.id);
    assert.equal(verified.state, "available");
    assert.equal(verified.connection.tools[0]?.name, "human-handoff");
    const first = await connections.request({
      adapterId: adapter.id, capability: "execute", toolName: "human-handoff", purpose: "Give the founder a cited contribution to publish manually.",
      evidenceRefs: ["evidence-1"], arguments: { draftId: "draft-1" }, idempotencyKey: "manual:handoff:one",
    });
    assert.equal(first.status, "approval-required");
    const completed = await connections.approve(first.id);
    assert.equal(completed.status, "completed");
    assert.ok(completed.approvedAt);
    assert.match(completed.argumentPreview, /draft-1/);
    assert.match(completed.summary, /human-owned handoff/i);
    const repeated = await connections.request({
      adapterId: adapter.id, capability: "execute", toolName: "human-handoff", purpose: "Give the founder a cited contribution to publish manually.",
      evidenceRefs: ["evidence-1"], arguments: { draftId: "draft-1" }, idempotencyKey: "manual:handoff:one",
    });
    assert.equal(repeated.id, completed.id);
    assert.equal(database.getActionExecutions().length, 1);
    await assert.rejects(() => connections.request({
      adapterId: adapter.id, capability: "execute", toolName: "human-handoff", purpose: "Try to reuse a key for a different payload.",
      evidenceRefs: ["evidence-1"], arguments: { draftId: "draft-2" }, idempotencyKey: "manual:handoff:one",
    }), /already bound/i);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("failed credential probes remain visibly unverified and credential-like arguments are rejected", async () => {
  const directory = mkdtempSync(join(tmpdir(), "distribution-os-connection-failure-"));
  const database = new DistributionDatabase(directory);
  const connections = new ActionConnectionService(database, new DistributionActionFabric(database));
  const credentialEnv = "DISTRIBUTION_OS_TEST_MISSING_TOKEN";
  delete process.env[credentialEnv];
  try {
    const adapter = database.createActionAdapter({ name: "Protected research", transport: "mcp", capabilities: ["read"], endpoint: "http://127.0.0.1:9/mcp", credentialEnv });
    await assert.rejects(() => connections.probe(adapter.id), new RegExp(credentialEnv));
    const failed = database.getActionAdapters().find((item) => item.id === adapter.id);
    assert.equal(failed?.state, "setup-required");
    assert.match(failed?.connection.lastError || "", new RegExp(credentialEnv));

    const manual = database.createActionAdapter({ name: "Safe handoff", transport: "manual", capabilities: ["execute"] });
    await connections.probe(manual.id);
    await assert.rejects(() => connections.request({
      adapterId: manual.id, capability: "execute", toolName: "human-handoff", purpose: "Reject credentials at the boundary.",
      evidenceRefs: ["evidence-1"], arguments: { apiKey: "must-not-persist" }, idempotencyKey: "manual:secret:test",
    }), /credential field/i);
    assert.doesNotMatch(JSON.stringify(database.getAutomationState()), /must-not-persist/);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("official MCP transport discovers a bounded tool, executes it, and records confirmation once", async () => {
  const directory = mkdtempSync(join(tmpdir(), "distribution-os-mcp-loop-"));
  const database = new DistributionDatabase(directory);
  const connections = new ActionConnectionService(database, new DistributionActionFabric(database));
  const mcp = new McpServer({ name: "distribution-os-test", version: "1.0.0" });
  let calls = 0;
  mcp.registerTool("search-audience", {
    description: "Search and read bounded audience evidence without creating external state.",
    inputSchema: { query: z.string() },
  }, async ({ query }) => {
    calls += 1;
    return { content: [{ type: "text", text: `One evidence result for ${query}.` }], structuredContent: { id: "result-1", url: query === "unsafe-url" ? "javascript:alert(1)" : "https://example.com/evidence/result-1" } };
  });
  mcp.registerTool("frobnicate", { description: "An unclassified operation.", inputSchema: {} }, async () => ({ content: [{ type: "text", text: "Unknown operation." }] }));
  mcp.registerTool("read-mutating-state", { description: "Read state while mutating the remote system.", annotations: { readOnlyHint: false }, inputSchema: {} }, async () => ({ content: [{ type: "text", text: "Mutation must not be mapped as read." }] }));
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await mcp.connect(transport);
  const httpServer = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const address = httpServer.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const webRequest = new Request(`http://127.0.0.1:${port}${request.url || "/mcp"}`, {
      method: request.method, headers: request.headers as HeadersInit,
      body: chunks.length ? Buffer.concat(chunks) : undefined,
    });
    const result = await transport.handleRequest(webRequest);
    response.writeHead(result.status, Object.fromEntries(result.headers.entries()));
    response.end(Buffer.from(await result.arrayBuffer()));
  });
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const address = httpServer.address();
  const port = typeof address === "object" && address ? address.port : 0;
  try {
    const adapter = database.createActionAdapter({ name: "Audience evidence MCP", transport: "mcp", capabilities: ["search", "read"], endpoint: `http://127.0.0.1:${port}/mcp` });
    const verified = await connections.probe(adapter.id);
    assert.equal(verified.state, "available");
    assert.equal(verified.connection.tools.length, 1);
    assert.deepEqual(verified.connection.tools[0]?.capabilities, ["search", "read"]);
    const completed = await connections.request({
      adapterId: adapter.id, capability: "read", toolName: "search-audience", purpose: "Read one bounded audience signal for a cited planning decision.",
      evidenceRefs: [], arguments: { query: "local-first founder distribution" }, idempotencyKey: "mcp:audience:one",
    });
    assert.equal(completed.status, "completed");
    assert.equal(completed.externalId, "result-1");
    assert.equal(completed.externalUrl, "https://example.com/evidence/result-1");
    assert.match(completed.summary, /one evidence result/i);
    const repeated = await connections.request({
      adapterId: adapter.id, capability: "read", toolName: "search-audience", purpose: "Read one bounded audience signal for a cited planning decision.",
      evidenceRefs: [], arguments: { query: "local-first founder distribution" }, idempotencyKey: "mcp:audience:one",
    });
    assert.equal(repeated.id, completed.id);
    assert.equal(calls, 1);
    await assert.rejects(() => connections.request({
      adapterId: adapter.id, capability: "read", toolName: "search-audience", purpose: "Reuse the key with changed input.",
      evidenceRefs: [], arguments: { query: "different input" }, idempotencyKey: "mcp:audience:one",
    }), /already bound/i);

    const dryRun = await connections.request({
      adapterId: adapter.id, capability: "read", toolName: "search-audience", purpose: "Validate policy without reaching the MCP transport.",
      evidenceRefs: [], arguments: { query: "dry run" }, idempotencyKey: "mcp:audience:dry-run", dryRun: true,
    });
    assert.equal(dryRun.status, "completed");
    assert.match(dryRun.summary, /transport was not called/i);
    assert.equal(calls, 1);

    const unsafeUrl = await connections.request({
      adapterId: adapter.id, capability: "read", toolName: "search-audience", purpose: "Reject unsafe result links.",
      evidenceRefs: [], arguments: { query: "unsafe-url" }, idempotencyKey: "mcp:audience:unsafe-url",
    });
    assert.equal(unsafeUrl.status, "completed");
    assert.equal(unsafeUrl.externalUrl, "");
    assert.equal(calls, 2);
  } finally {
    await new Promise<void>((resolve, reject) => httpServer.close((error) => error ? reject(error) : resolve()));
    await mcp.close();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("interrupted and concurrently approved actions fail closed in the durable ledger", async () => {
  const directory = mkdtempSync(join(tmpdir(), "distribution-os-action-recovery-"));
  let database = new DistributionDatabase(directory);
  try {
    const adapter = database.createActionAdapter({ name: "Recovery handoff", transport: "manual", capabilities: ["execute"] });
    const decision = evaluateActionPolicy({
      ...adapter,
      state: "available",
      connection: { lastCheckedAt: "", lastError: "", credentialSource: "none", tools: [] },
    }, intent({ adapterId: adapter.id, approved: true }));
    const created = database.createActionExecution({
      adapterId: adapter.id, capability: "execute", toolName: "human-handoff", status: "approval-required",
      purpose: "Exercise atomic approval and restart recovery.", evidenceRefs: ["evidence-1"], arguments: { draftId: "draft-recovery" },
      decision, idempotencyKey: "manual:recovery:one",
    });
    const firstClaim = database.markActionExecutionApproved(created.record.id);
    const secondClaim = database.markActionExecutionApproved(created.record.id);
    assert.equal(firstClaim.claimed, true);
    assert.equal(secondClaim.claimed, false);
    assert.ok(firstClaim.record.approvedAt);
    database.close();

    database = new DistributionDatabase(directory);
    const recovered = database.getActionExecution(created.record.id);
    assert.equal(recovered.status, "failed");
    assert.match(recovered.error, /interrupted action/i);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
