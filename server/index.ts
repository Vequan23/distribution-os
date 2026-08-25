import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { DistributionDatabase } from "./database.ts";
import { buildProductBrief, ingestSources } from "./ingestion.ts";
import { AIControlPlaneStore } from "./ai-control-plane.ts";
import { NativeModelExecutor } from "./model-executor.ts";
import { synthesizeProductBrief } from "./onboarding-harness.ts";
import { generateDistributionPlan } from "./distribution-harness.ts";
import { AgentRuntimeExecutor } from "./runtime-executor.ts";
import type { OnboardProductInput, OnboardingSourceInput } from "./domain.ts";

const port = Number(process.env.DISTRIBUTION_OS_PORT || 4191);
const database = new DistributionDatabase();
const aiControlPlane = new AIControlPlaneStore(database.dataDirectory);
const modelExecutor = new NativeModelExecutor(aiControlPlane);
const runtimeExecutor = new AgentRuntimeExecutor(aiControlPlane);
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

function serveStatic(pathname: string, response: ServerResponse): boolean {
  if (!existsSync(distDirectory)) return false;
  const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const candidate = normalize(join(distDirectory, requested));
  if (!candidate.startsWith(distDirectory) || !existsSync(candidate) || !statSync(candidate).isFile()) {
    const fallback = join(distDirectory, "index.html");
    if (!existsSync(fallback)) return false;
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    createReadStream(fallback).pipe(response);
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
  createReadStream(candidate).pipe(response);
  return true;
}

const server = createServer(async (request, response) => {
  try {
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
    if (request.method === "POST" && url.pathname === "/api/refresh") {
      database.recordRefresh();
      json(response, 200, database.getDashboard());
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/products/onboard") {
      const body = await readJson(request);
      const input: OnboardProductInput = {
        name: String(body.name || ""),
        description: String(body.description || ""),
        stage: String(body.stage || "early"),
        audience: String(body.audience || ""),
        objective: String(body.objective || ""),
        positioning: String(body.positioning || ""),
        websiteUrl: typeof body.websiteUrl === "string" ? body.websiteUrl : "",
        repositoryUrl: typeof body.repositoryUrl === "string" ? body.repositoryUrl : "",
        sources: Array.isArray(body.sources) ? body.sources as OnboardingSourceInput[] : [],
      };
      const sources = await ingestSources(input.sources);
      const productId = database.onboardProduct(input, sources);
      json(response, 201, { productId, dashboard: database.getDashboard() });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/products/analyze") {
      const body = await readJson(request);
      const sources = await ingestSources(Array.isArray(body.sources) ? body.sources as OnboardingSourceInput[] : []);
      const localBrief = buildProductBrief(sources);
      json(response, 200, { brief: await synthesizeProductBrief(sources, localBrief, modelExecutor, database) });
      return;
    }
    const planMatch = url.pathname.match(/^\/api\/products\/([^/]+)\/plan$/);
    if (request.method === "POST" && planMatch) {
      const plan = await generateDistributionPlan(decodeURIComponent(planMatch[1]), modelExecutor, runtimeExecutor, aiControlPlane, database);
      json(response, 201, { plan, dashboard: database.getDashboard() });
      return;
    }
    const signalMatch = url.pathname.match(/^\/api\/products\/([^/]+)\/signals$/);
    if (request.method === "POST" && signalMatch) {
      const body = await readJson(request);
      const inputs = Array.isArray(body.sources) ? body.sources as OnboardingSourceInput[] : [];
      if (inputs.some((source) => source.type !== "text" && source.type !== "url")) throw new Error("Audience signals must be pasted context or a public URL.");
      const sources = await ingestSources(inputs);
      const count = database.addAudienceSignals(decodeURIComponent(signalMatch[1]), sources);
      json(response, 201, { count, dashboard: database.getDashboard() });
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
    if (request.method === "GET" && serveStatic(url.pathname, response)) return;
    json(response, 404, { error: "Not found" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error";
    console.error("[distribution-os] request failed", { method: request.method, path: request.url, message });
    json(response, message === "Opportunity not found" ? 404 : 500, { error: message });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Distribution-OS local service: http://127.0.0.1:${port}`);
  console.log(`Private ledger: ${database.databasePath}`);
});

function shutdown(): void {
  server.close(() => {
    database.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
