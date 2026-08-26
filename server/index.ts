import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import { DistributionDatabase } from "./database.ts";
import { buildProductBrief, ingestSources } from "./ingestion.ts";
import { AIControlPlaneStore } from "./ai-control-plane.ts";
import { NativeModelExecutor } from "./model-executor.ts";
import { synthesizeProductBrief } from "./onboarding-harness.ts";
import { generateDistributionPlan } from "./distribution-harness.ts";
import { writeContributionDraft } from "./contribution-harness.ts";
import { AgentRuntimeExecutor } from "./runtime-executor.ts";
import { GitHubConnectorService } from "./github-connector.ts";
import { DevToConnector } from "./devto-connector.ts";
import { AutomationKernel } from "./automation-kernel.ts";
import { DistributionActionFabric } from "./action-fabric.ts";
import { ActionConnectionService } from "./action-connections.ts";
import { isTrustedLocalRequest } from "./local-request.ts";
import { isProductStage, type AgentRuntimeId, type ChannelMode, type OnboardProductInput, type OnboardingSourceInput } from "./domain.ts";

const port = Number(process.env.DISTRIBUTION_OS_PORT || 4191);
const database = new DistributionDatabase();
const aiControlPlane = new AIControlPlaneStore(database.dataDirectory);
const modelExecutor = new NativeModelExecutor(aiControlPlane);
const runtimeExecutor = new AgentRuntimeExecutor(aiControlPlane);
const githubConnector = new GitHubConnectorService(database);
const devToConnector = new DevToConnector(database);
const actionFabric = new DistributionActionFabric(database);
const actionConnections = new ActionConnectionService(database, actionFabric);
const automationKernel = new AutomationKernel(database, {
  syncConnector: async (id) => githubConnector.sync(id),
  generatePlan: async (productId, maxMoves) => generateDistributionPlan(productId, modelExecutor, runtimeExecutor, aiControlPlane, database, { maxMoves }),
  writeDraft: async (opportunityId) => writeContributionDraft(opportunityId, modelExecutor, database),
  actionFabric,
});
const projectRoot = resolve(process.cwd());
const distDirectory = join(projectRoot, "dist");

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(value));
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 12_000_000) throw new Error("Request body is too large");
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

function serveStatic(pathname: string, response: ServerResponse, head = false): boolean {
  if (!existsSync(distDirectory)) return false;
  const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const candidate = normalize(join(distDirectory, requested));
  const relativeCandidate = relative(distDirectory, candidate);
  if (relativeCandidate.startsWith("..") || isAbsolute(relativeCandidate) || !existsSync(candidate) || !statSync(candidate).isFile()) {
    const fallback = join(distDirectory, "index.html");
    if (!existsSync(fallback)) return false;
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    if (head) response.end();
    else createReadStream(fallback).pipe(response);
    return true;
  }
  const contentTypes: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
  };
  response.writeHead(200, { "content-type": contentTypes[extname(candidate)] || "application/octet-stream" });
  if (head) response.end();
  else createReadStream(candidate).pipe(response);
  return true;
}

const server = createServer(async (request, response) => {
  try {
    if (!isTrustedLocalRequest({
      method: request.method,
      host: request.headers.host,
      origin: request.headers.origin,
      secFetchSite: request.headers["sec-fetch-site"],
    })) {
      json(response, 403, { error: "Distribution-OS accepts requests only from the local application origin." });
      return;
    }
    const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
    if (request.method === "GET" && url.pathname === "/api/health") {
      json(response, 200, { ok: true, storage: "local", generatedAt: new Date().toISOString() });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/dashboard") {
      json(response, 200, database.getDashboard());
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/ai/control-plane") {
      json(response, 200, await aiControlPlane.getPublicState());
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/ai/discover") {
      json(response, 200, await aiControlPlane.getPublicState());
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/ai/profiles") {
      const body = await readJson(request);
      console.info("[ai-control-plane] saving model profile", {
        provider: String(body.provider || ""),
        model: String(body.model || "").slice(0, 120),
        credentialSupplied: typeof body.apiKey === "string" && body.apiKey.trim().length > 0,
      });
      const result = await aiControlPlane.saveModelProfile({
        id: typeof body.id === "string" ? body.id : undefined,
        name: typeof body.name === "string" ? body.name : undefined,
        provider: typeof body.provider === "string" ? body.provider : undefined,
        model: typeof body.model === "string" ? body.model : undefined,
        baseUrl: typeof body.baseUrl === "string" ? body.baseUrl : undefined,
        apiKey: typeof body.apiKey === "string" ? body.apiKey : undefined,
        activate: body.activate === true,
      });
      console.info("[ai-control-plane] model profile saved", { profileCount: result.profiles.length, activeProfileId: result.execution.modelProfileId });
      json(response, 201, result);
      return;
    }
    const profileMatch = url.pathname.match(/^\/api\/ai\/profiles\/([^/]+)\/activate$/);
    if (request.method === "POST" && profileMatch) {
      json(response, 200, await aiControlPlane.activateModelProfile(decodeURIComponent(profileMatch[1])));
      return;
    }
    const profileTestMatch = url.pathname.match(/^\/api\/ai\/profiles\/([^/]+)\/test$/);
    if (request.method === "POST" && profileTestMatch) {
      const result = await modelExecutor.testProfile(decodeURIComponent(profileTestMatch[1]));
      json(response, 200, { ok: true, ...result });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/ai/runtime") {
      const body = await readJson(request);
      const result = await aiControlPlane.activateRuntime(String(body.runtimeId || ""), typeof body.model === "string" ? body.model : "");
      console.info("[ai-control-plane] runtime activated", { runtimeId: result.execution.runtimeId, modelOverride: Boolean(result.execution.runtimeModel) });
      json(response, 200, result);
      return;
    }
    const runtimeTestMatch = url.pathname.match(/^\/api\/ai\/runtimes\/([^/]+)\/test$/);
    if (request.method === "POST" && runtimeTestMatch) {
      const body = await readJson(request);
      const runtimeId = decodeURIComponent(runtimeTestMatch[1]) as AgentRuntimeId;
      if (!["claude-code", "cursor", "opencode", "codex"].includes(runtimeId)) throw new Error("Choose a supported external runtime.");
      const result = await runtimeExecutor.probeRuntime(runtimeId, typeof body.model === "string" ? body.model.trim().slice(0, 160) : "");
      const controlPlane = await aiControlPlane.recordRuntimeVerification(runtimeId, result);
      console.info("[ai-control-plane] runtime tested", { runtimeId, ok: result.ok, failureCode: result.failureCode || "", durationMs: result.durationMs });
      json(response, 200, { ...result, controlPlane });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/refresh") {
      const devConnection = database.getDevToConnection();
      if (devConnection.productId && devConnection.signalQuery) await devToConnector.syncSignals(devConnection.productId);
      await devToConnector.syncOutcomes();
      json(response, 200, database.getDashboard());
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/automation/control") {
      const body = await readJson(request);
      if (typeof body.paused !== "boolean") throw new Error("Automation control requires a paused state.");
      json(response, 200, { automation: database.setAutomationPaused(body.paused), dashboard: database.getDashboard() });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/action-fabric") {
      json(response, 200, database.getAutomationState().actionFabric);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/action-fabric/adapters") {
      const body = await readJson(request);
      const adapter = database.createActionAdapter({
        name: String(body.name || ""),
        transport: String(body.transport || ""),
        capabilities: Array.isArray(body.capabilities) ? body.capabilities.map(String) : [],
        endpoint: typeof body.endpoint === "string" ? body.endpoint : undefined,
        command: typeof body.command === "string" ? body.command : undefined,
        gateway: typeof body.gateway === "string" ? body.gateway : undefined,
        connectionRef: typeof body.connectionRef === "string" ? body.connectionRef : undefined,
        credentialEnv: typeof body.credentialEnv === "string" ? body.credentialEnv : undefined,
      });
      json(response, 201, { adapter, dashboard: database.getDashboard() });
      return;
    }
    const adapterStateMatch = url.pathname.match(/^\/api\/action-fabric\/adapters\/([^/]+)\/state$/);
    if (request.method === "POST" && adapterStateMatch) {
      const body = await readJson(request);
      if (typeof body.enabled !== "boolean") throw new Error("Adapter state requires an enabled value.");
      const adapter = database.setActionAdapterEnabled(decodeURIComponent(adapterStateMatch[1]), body.enabled);
      json(response, 200, { adapter, dashboard: database.getDashboard() });
      return;
    }
    const adapterProbeMatch = url.pathname.match(/^\/api\/action-fabric\/adapters\/([^/]+)\/probe$/);
    if (request.method === "POST" && adapterProbeMatch) {
      const adapter = await actionConnections.probe(decodeURIComponent(adapterProbeMatch[1]));
      json(response, 200, { adapter, dashboard: database.getDashboard() });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/action-fabric/actions") {
      const body = await readJson(request);
      if (Object.prototype.hasOwnProperty.call(body, "approved")) throw new Error("Initial action requests cannot self-approve. Use the recorded one-time approval endpoint.");
      const capability = String(body.capability || "");
      if (!["observe", "search", "read", "prepare", "execute", "measure"].includes(capability)) throw new Error("Choose a discovered action capability.");
      const record = await actionConnections.request({
        adapterId: String(body.adapterId || ""),
        capability: capability as import("../packages/action-fabric/src/index.ts").ActionCapability,
        toolName: String(body.toolName || ""), purpose: String(body.purpose || ""),
        evidenceRefs: Array.isArray(body.evidenceRefs) ? body.evidenceRefs.map(String) : [],
        arguments: body.arguments && typeof body.arguments === "object" && !Array.isArray(body.arguments) ? body.arguments as Record<string, unknown> : {},
        idempotencyKey: String(body.idempotencyKey || ""),
        dryRun: body.dryRun === true, budgetLimit: Number(body.budgetLimit || 1),
      });
      json(response, 201, { record, dashboard: database.getDashboard() });
      return;
    }
    const actionApprovalMatch = url.pathname.match(/^\/api\/action-fabric\/actions\/([^/]+)\/approve$/);
    if (request.method === "POST" && actionApprovalMatch) {
      const record = await actionConnections.approve(decodeURIComponent(actionApprovalMatch[1]));
      json(response, 200, { record, dashboard: database.getDashboard() });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/action-fabric/evaluate") {
      const body = await readJson(request);
      const capability = String(body.capability || "");
      if (!["observe", "search", "read", "prepare", "execute", "measure"].includes(capability)) throw new Error("Choose a declared action capability.");
      json(response, 200, actionFabric.evaluate({
        adapterId: String(body.adapterId || ""), capability: capability as import("../packages/action-fabric/src/index.ts").ActionCapability,
        productId: typeof body.productId === "string" ? body.productId : undefined,
        evidenceRefs: Array.isArray(body.evidenceRefs) ? body.evidenceRefs.map(String) : [],
        approved: body.approved === true, dryRun: body.dryRun === true,
        budgetUsed: Number(body.budgetUsed || 0), budgetLimit: Number(body.budgetLimit || 1), purpose: typeof body.purpose === "string" ? body.purpose : undefined,
      }));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/automation/playbooks") {
      const body = await readJson(request);
      const playbook = database.createAutomationPlaybook({
        productId: String(body.productId || ""),
        name: typeof body.name === "string" ? body.name : undefined,
        intervalMinutes: Number(body.intervalMinutes),
        maxActionsPerRun: Number(body.maxActionsPerRun),
      });
      json(response, 201, { playbook, dashboard: database.getDashboard() });
      return;
    }
    const automationPlaybookMatch = url.pathname.match(/^\/api\/automation\/playbooks\/([^/]+)$/);
    if (request.method === "PUT" && automationPlaybookMatch) {
      const body = await readJson(request);
      const playbook = database.updateAutomationPlaybook(decodeURIComponent(automationPlaybookMatch[1]), {
        enabled: body.enabled === true,
        intervalMinutes: Number(body.intervalMinutes),
        maxActionsPerRun: Number(body.maxActionsPerRun),
      });
      json(response, 200, { playbook, dashboard: database.getDashboard() });
      return;
    }
    if (request.method === "DELETE" && automationPlaybookMatch) {
      database.archiveAutomationPlaybook(decodeURIComponent(automationPlaybookMatch[1]));
      json(response, 200, { dashboard: database.getDashboard() });
      return;
    }
    const automationRunMatch = url.pathname.match(/^\/api\/automation\/playbooks\/([^/]+)\/run$/);
    if (request.method === "POST" && automationRunMatch) {
      const run = await automationKernel.runPlaybook(decodeURIComponent(automationRunMatch[1]));
      json(response, 201, { run, dashboard: database.getDashboard() });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/connectors/github") {
      const body = await readJson(request);
      const result = await githubConnector.connect(String(body.productId || ""), String(body.repository || ""));
      json(response, 201, { ...result, dashboard: database.getDashboard() });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/connectors/devto/credential") {
      const body = await readJson(request);
      await devToConnector.saveApiKey(String(body.apiKey || ""));
      json(response, 200, database.getDashboard());
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/connectors/devto") {
      const body = await readJson(request);
      const tags = Array.isArray(body.publishTags) ? body.publishTags.map(String) : [];
      const result = await devToConnector.connectAndSync(String(body.productId || ""), String(body.signalQuery || ""), tags);
      json(response, 201, { ...result, dashboard: database.getDashboard() });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/connectors/devto/outcomes/sync") {
      const synced = await devToConnector.syncOutcomes();
      json(response, 200, { synced, dashboard: database.getDashboard() });
      return;
    }
    const connectorSyncMatch = url.pathname.match(/^\/api\/connectors\/([^/]+)\/sync$/);
    if (request.method === "POST" && connectorSyncMatch) {
      const result = await githubConnector.sync(decodeURIComponent(connectorSyncMatch[1]));
      json(response, 200, { ...result, dashboard: database.getDashboard() });
      return;
    }
    const connectorMatch = url.pathname.match(/^\/api\/connectors\/([^/]+)$/);
    if (request.method === "DELETE" && connectorMatch) {
      database.disconnectSourceConnector(decodeURIComponent(connectorMatch[1]));
      json(response, 200, database.getDashboard());
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/products/onboard") {
      const body = await readJson(request);
      const stage = String(body.stage || "early");
      if (!isProductStage(stage)) throw new Error("Choose a supported product stage.");
      const input: OnboardProductInput = {
        name: String(body.name || ""),
        description: String(body.description || ""),
        stage,
        audience: String(body.audience || ""),
        objective: String(body.objective || ""),
        positioning: String(body.positioning || ""),
        voiceGuidance: typeof body.voiceGuidance === "string" ? body.voiceGuidance : "",
        websiteUrl: typeof body.websiteUrl === "string" ? body.websiteUrl : "",
        repositoryUrl: typeof body.repositoryUrl === "string" ? body.repositoryUrl : "",
        sources: Array.isArray(body.sources) ? body.sources as OnboardingSourceInput[] : [],
      };
      const sources = await ingestSources(input.sources);
      const existingProductId = database.findMatchingProductId(input, sources);
      const productId = database.onboardProduct(input, sources);
      json(response, existingProductId ? 200 : 201, { productId, operation: existingProductId ? "updated" : "created", dashboard: database.getDashboard() });
      return;
    }
    const productMatch = url.pathname.match(/^\/api\/products\/([^/]+)$/);
    if (request.method === "DELETE" && productMatch) {
      database.deleteProduct(decodeURIComponent(productMatch[1]));
      json(response, 200, { dashboard: database.getDashboard() });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/products/analyze") {
      const body = await readJson(request);
      const sources = await ingestSources(Array.isArray(body.sources) ? body.sources as OnboardingSourceInput[] : []);
      const localBrief = buildProductBrief(sources);
      json(response, 200, { brief: await synthesizeProductBrief(sources, localBrief, modelExecutor, database, runtimeExecutor, aiControlPlane) });
      return;
    }
    const planMatch = url.pathname.match(/^\/api\/products\/([^/]+)\/plan$/);
    if (request.method === "POST" && planMatch) {
      const abortController = new AbortController();
      const abort = (): void => abortController.abort();
      request.once("aborted", abort);
      response.once("close", () => {
        if (!response.writableEnded) abort();
      });
      const result = await generateDistributionPlan(decodeURIComponent(planMatch[1]), modelExecutor, runtimeExecutor, aiControlPlane, database, { signal: abortController.signal });
      if (abortController.signal.aborted) return;
      json(response, 201, { ...result, dashboard: database.getDashboard() });
      return;
    }
    const channelMatch = url.pathname.match(/^\/api\/channels\/([^/]+)\/policy$/);
    if (request.method === "PUT" && channelMatch) {
      const body = await readJson(request);
      database.updateChannelPolicy(decodeURIComponent(channelMatch[1]), {
        mode: String(body.mode || "") as ChannelMode,
        dailyLimit: Number(body.dailyLimit),
      });
      json(response, 200, database.getDashboard());
      return;
    }
    const signalMatch = url.pathname.match(/^\/api\/products\/([^/]+)\/signals$/);
    if (request.method === "POST" && signalMatch) {
      const body = await readJson(request);
      const inputs = Array.isArray(body.sources) ? body.sources as OnboardingSourceInput[] : [];
      if (inputs.some((source) => source.type !== "text" && source.type !== "url")) throw new Error("Audience signals must be pasted context or a public URL.");
      const sources = await ingestSources(inputs);
      const result = database.addSignalCandidates(decodeURIComponent(signalMatch[1]), sources);
      json(response, 201, { count: result.insertedCount, signalIds: result.signalIds, dashboard: database.getDashboard() });
      return;
    }
    const signalInboxMatch = url.pathname.match(/^\/api\/products\/([^/]+)\/signals\/inbox$/);
    if (request.method === "POST" && signalInboxMatch) {
      const body = await readJson(request);
      const inputs = Array.isArray(body.sources) ? body.sources as OnboardingSourceInput[] : [];
      if (inputs.some((source) => source.type !== "text" && source.type !== "url")) throw new Error("Signal candidates must be pasted context or a public URL.");
      const sources = await ingestSources(inputs);
      const result = database.addSignalCandidates(decodeURIComponent(signalInboxMatch[1]), sources);
      json(response, 201, { ...result, dashboard: database.getDashboard() });
      return;
    }
    const signalDecisionMatch = url.pathname.match(/^\/api\/signals\/([^/]+)\/decision$/);
    if (request.method === "POST" && signalDecisionMatch) {
      const body = await readJson(request);
      const action = String(body.action || "");
      if (!(action === "accept" || action === "dismiss" || action === "restore")) throw new Error("Signal action must be accept, dismiss, or restore.");
      database.decideSignalCandidate(decodeURIComponent(signalDecisionMatch[1]), action);
      json(response, 200, database.getDashboard());
      return;
    }
    const runMatch = url.pathname.match(/^\/api\/harness\/runs\/([^/]+)$/);
    if (request.method === "GET" && runMatch) {
      json(response, 200, { run: database.getHarnessRun(decodeURIComponent(runMatch[1])) });
      return;
    }
    const decisionMatch = url.pathname.match(/^\/api\/opportunities\/([^/]+)\/decision$/);
    if (request.method === "POST" && decisionMatch) {
      const body = await readJson(request);
      const action = String(body.action || "");
      if (!(["approve", "skip", "restore"] as string[]).includes(action)) {
        json(response, 400, { error: "Action must be approve, skip, or restore." });
        return;
      }
      database.decideOpportunity(
        decodeURIComponent(decisionMatch[1]),
        action as "approve" | "skip" | "restore",
        typeof body.draftCopy === "string" ? body.draftCopy : undefined,
      );
      json(response, 200, database.getDashboard());
      return;
    }
    const draftMatch = url.pathname.match(/^\/api\/opportunities\/([^/]+)\/draft$/);
    if (request.method === "POST" && draftMatch) {
      const result = await writeContributionDraft(decodeURIComponent(draftMatch[1]), modelExecutor, database);
      json(response, 200, { result, dashboard: database.getDashboard() });
      return;
    }
    const executeMatch = url.pathname.match(/^\/api\/opportunities\/([^/]+)\/execute$/);
    if (request.method === "POST" && executeMatch) {
      const receipt = await devToConnector.executeApproved(decodeURIComponent(executeMatch[1]));
      json(response, 201, { receipt, dashboard: database.getDashboard() });
      return;
    }
    const outcomeMatch = url.pathname.match(/^\/api\/opportunities\/([^/]+)\/outcomes$/);
    if (request.method === "POST" && outcomeMatch) {
      const body = await readJson(request);
      database.recordOutcome(
        decodeURIComponent(outcomeMatch[1]),
        String(body.metric || ""),
        Number(body.value),
        typeof body.note === "string" ? body.note : "",
      );
      json(response, 201, database.getDashboard());
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      json(response, 404, { error: "Not found" });
      return;
    }
    if ((request.method === "GET" || request.method === "HEAD") && serveStatic(url.pathname, response, request.method === "HEAD")) return;
    json(response, 404, { error: "Not found" });
  } catch (error) {
    if (response.destroyed || response.writableEnded) return;
    const message = error instanceof Error ? error.message : "Unexpected server error";
    console.error("[distribution-os] request failed", { method: request.method, path: request.url, message });
    const missing = /not found$/i.test(message);
    const invalid = error instanceof SyntaxError || /required|must|choose|supported|cannot|only|private-network|larger than|too many|could not be found/i.test(message);
    json(response, missing ? 404 : invalid ? 400 : 500, { error: message });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Distribution-OS local service: http://127.0.0.1:${port}`);
  console.log(`Private ledger: ${database.databasePath}`);
});

const automationTimer = setInterval(() => {
  void automationKernel.tickDuePlaybooks().catch((error) => {
    console.error("[distribution-os] automation tick failed", { message: error instanceof Error ? error.message : "Unexpected automation error" });
  });
}, 30_000);
automationTimer.unref();

function shutdown(): void {
  clearInterval(automationTimer);
  server.close(() => {
    database.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
