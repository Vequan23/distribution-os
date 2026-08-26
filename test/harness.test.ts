import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AIControlPlaneStore } from "../server/ai-control-plane.ts";
import { DistributionDatabase } from "../server/database.ts";
import { evidencePriority, generateDistributionPlan, localFallbackPlan, missingRequiredPlanningTools, planSchema } from "../server/distribution-harness.ts";
import { missingRequiredDraftTools, writeContributionDraft } from "../server/contribution-harness.ts";
import { buildProductBrief } from "../server/ingestion.ts";
import type { NativeModelExecutor } from "../server/model-executor.ts";
import { synthesizeProductBrief } from "../server/onboarding-harness.ts";
import { AgentRuntimeExecutor, runRuntimeCommand } from "../server/runtime-executor.ts";
import { AutomationKernel } from "../server/automation-kernel.ts";
import { DevToConnector } from "../server/devto-connector.ts";

function seedProduct(database: DistributionDatabase): string {
  return database.onboardProduct({
    name: "Signal Garden",
    description: "An evidence-backed distribution practice for technical founders.",
    stage: "early",
    audience: "Technical founders",
    objective: "Learn which product problem earns ten qualified replies",
    positioning: "Turn distribution into a traceable learning loop.",
    sources: [],
  }, [{
    type: "text",
    label: "Founder brief",
    sourceUrl: "",
    summary: "Technical founders need an accountable distribution practice.",
    excerpt: "Technical founders need an accountable distribution practice.",
    classification: "intent",
    confidence: 52,
  }]);
}

test("fallback planning prefers substantive evidence and emits clean human copy", () => {
  assert.ok(
    evidencePriority({ title: "README product overview", classification: "implementation", confidence: 88 })
      > evidencePriority({ title: "Code of Conduct", classification: "implementation", confidence: 88 }),
  );
  const directory = mkdtempSync(join(tmpdir(), "distribution-os-fallback-copy-"));
  const database = new DistributionDatabase(directory);
  try {
    const productId = database.onboardProduct({
      name: "Aperta", description: "A harness for understanding generated code.", stage: "early", audience: "Developers.", objective: "Test the ownership loop?", positioning: "Evidence before confidence.", sources: [],
    }, [{ type: "text", label: "Founder brief", sourceUrl: "", summary: "Developers need evidence for generated code.", excerpt: "Developers need evidence for generated code.", classification: "intent", confidence: 52 }]);
    const plan = localFallbackPlan(database, productId, "run-1", "Local fallback.");
    assert.doesNotMatch(plan.moves[0]?.draftCopy ?? "", /\.\.|\?\./);
    assert.match(plan.moves[0]?.draftCopy ?? "", /immediate learning goal is to test the ownership loop/i);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("onboarding AI synthesis accepts only exact evidence labels and records its run", async () => {
  const directory = mkdtempSync(join(tmpdir(), "distribution-os-harness-"));
  const database = new DistributionDatabase(directory);
  const sources = [{
    type: "text" as const,
    label: "Founder brief",
    sourceUrl: "",
    summary: "A distribution practice for technical founders.",
    excerpt: "Signal Garden gives technical founders a calmer distribution practice.",
    classification: "intent" as const,
    confidence: 52,
  }];
  const executor = {
    activeDescriptor: async () => ({ provider: "openai" as const, model: "test-model" }),
    generateObject: async () => ({
      output: {
        name: { value: "Signal Garden", citations: ["Founder brief"], needsReview: false },
        description: { value: "A calmer distribution practice.", citations: ["Founder brief"], needsReview: false },
        audience: { value: "Technical founders", citations: ["Founder brief"], needsReview: false },
        positioning: { value: "Evidence before reach.", citations: ["Invented source"], needsReview: false },
        stage: { value: "early" as const, citations: ["Founder brief"], needsReview: false },
        suggestedObjectives: [
          { value: "Earn ten qualified founder replies", citations: ["Founder brief"] },
          { value: "Book three product-learning conversations", citations: ["Founder brief"] },
        ],
      },
      provider: "openai" as const,
      model: "test-model",
      durationMs: 20,
      inputTokens: 100,
      outputTokens: 50,
      attempts: 1,
    }),
  } as unknown as NativeModelExecutor;
  try {
    const brief = await synthesizeProductBrief(sources, buildProductBrief(sources), executor, database);
    assert.equal(brief.analysis.mode, "ai");
    assert.equal(brief.positioning.needsReview, true);
    assert.deepEqual(brief.positioning.sourceLabels, ["Founder brief"]);
    assert.notEqual(brief.positioning.value, "Evidence before reach.");
    const runs = database.getRecentHarnessRuns();
    assert.equal(runs[0]?.kind, "onboarding");
    assert.equal(runs[0]?.status, "completed");
    assert.equal(runs[0]?.steps.length, 3);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("onboarding honors the selected Codex runtime instead of silently using a model API", async () => {
  const directory = mkdtempSync(join(tmpdir(), "distribution-os-onboarding-runtime-"));
  const database = new DistributionDatabase(directory);
  const sources = [{
    type: "text" as const, label: "Founder brief", sourceUrl: "", summary: "A distribution practice for technical founders.",
    excerpt: "Signal Garden gives technical founders a calmer distribution practice.", classification: "intent" as const, confidence: 52,
  }];
  const nativeExecutor = { activeDescriptor: async () => { throw new Error("Native executor should not be used."); } } as unknown as NativeModelExecutor;
  const runtimeExecutor = { generateObject: async (input: { contextFiles: Record<string, unknown> }) => {
    assert.ok(Array.isArray((input.contextFiles.sources as unknown[])));
    return {
      output: {
        name: { value: "Signal Garden", citations: ["Founder brief"], needsReview: false },
        description: { value: "A calmer distribution practice.", citations: ["Founder brief"], needsReview: false },
        audience: { value: "Technical founders building alone", citations: ["Founder brief"], needsReview: false },
        positioning: { value: "Evidence before reach.", citations: ["Founder brief"], needsReview: false },
        stage: { value: "early" as const, citations: ["Founder brief"], needsReview: false },
        suggestedObjectives: [
          { value: "Earn ten qualified founder replies", citations: ["Founder brief"] },
          { value: "Book three product-learning conversations", citations: ["Founder brief"] },
        ],
      },
      runtimeId: "codex" as const, model: "runtime default", durationMs: 24, activityCount: 4, attempts: 1,
    };
  } } as unknown as AgentRuntimeExecutor;
  const controlPlane = { getExecutionProfile: async () => ({ runtimeId: "codex" as const, modelProfileId: "google-profile", runtimeModel: "", updatedAt: new Date().toISOString() }) } as unknown as AIControlPlaneStore;
  try {
    const brief = await synthesizeProductBrief(sources, buildProductBrief(sources), nativeExecutor, database, runtimeExecutor, controlPlane);
    assert.equal(brief.analysis.mode, "ai");
    assert.equal(brief.analysis.provider, "Codex CLI");
    assert.equal(brief.analysis.model, "runtime default");
    const run = database.getRecentHarnessRuns()[0];
    assert.equal(run?.runtimeId, "codex");
    assert.equal(run?.provider, "");
    assert.equal(run?.status, "completed");
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Cursor runtime output is normalized and schema-validated from a bounded workspace", async () => {
  const directory = mkdtempSync(join(tmpdir(), "distribution-os-runtime-test-"));
  const controlPlane = new AIControlPlaneStore(directory, async () => ({ stdout: "opencode 1.0.0", stderr: "" }));
  try {
    await controlPlane.activateRuntime("cursor");
    const executor = new AgentRuntimeExecutor(controlPlane, async (command, args, cwd) => {
      assert.match(cwd, /distribution-os-runtime-/);
      assert.equal(command, "cursor-agent");
      assert.ok(args.includes("-p"));
      assert.ok(!args.includes("--force"));
      const plan = {
        summary: "A source-cited plan that tests the product problem before asking for attention.",
        assumptions: ["No live audience signal is connected."],
        moves: [{
          channelId: "linkedin",
          type: "owned-post",
          title: "Ask technical founders where distribution breaks",
          whyNow: "The founder brief is ready for a narrow problem-framing test.",
          suggestedAngle: "Share the constraint and ask for concrete failure stories.",
          draftCopy: "I am testing a calmer way for technical founders to practice distribution. Where does the current process break for you?",
          citationLabels: ["Founder brief"],
          relevanceScore: 85,
          valueScore: 80,
          freshnessScore: 70,
          promotionRisk: 15,
        }],
      };
      return { stdout: `${JSON.stringify({ type: "result", subtype: "success", result: JSON.stringify(plan) })}\n`, stderr: "" };
    });
    const result = await executor.generateObject({ schema: planSchema, prompt: "Plan", contextFiles: { evidence: [{ title: "Founder brief" }] } });
    assert.equal(result.runtimeId, "cursor");
    assert.equal(result.output.moves[0]?.citationLabels[0], "Founder brief");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("bounded readiness probes exercise OpenCode and Codex through their real adapter contracts", async () => {
  const directory = mkdtempSync(join(tmpdir(), "distribution-os-runtime-probes-"));
  const controlPlane = new AIControlPlaneStore(directory, async () => ({ stdout: "runtime 1.0.0", stderr: "" }));
  try {
    const executor = new AgentRuntimeExecutor(controlPlane, async (command, args, cwd) => {
      assert.match(cwd, /distribution-os-runtime-/);
      const output = JSON.stringify({ status: "ready", evidenceLabel: "runtime-probe" });
      if (command === "codex") {
        const outputIndex = args.indexOf("-o");
        assert.ok(outputIndex >= 0);
        assert.ok(args.includes("--output-schema"));
        writeFileSync(args[outputIndex + 1]!, output);
        return { stdout: `${JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: output } })}\n`, stderr: "" };
      }
      assert.equal(command, "opencode");
      return { stdout: `${JSON.stringify({ type: "text", part: { text: output } })}\n`, stderr: "" };
    });

    const openCode = await executor.probeRuntime("opencode");
    const codex = await executor.probeRuntime("codex");
    assert.equal(openCode.ok, true);
    assert.equal(codex.ok, true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("runtime launcher closes stdin so non-interactive CLIs do not wait for more prompt input", async () => {
  const directory = mkdtempSync(join(tmpdir(), "distribution-os-runtime-stdin-"));
  try {
    const result = await runRuntimeCommand(process.execPath, ["-e", "process.stdin.resume(); process.stdin.once('end', () => console.log('stdin-closed'));"], directory);
    assert.equal(result.stdout.trim(), "stdin-closed");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("runtime readiness probes expose only bounded failure categories", async () => {
  const directory = mkdtempSync(join(tmpdir(), "distribution-os-runtime-probe-errors-"));
  const controlPlane = new AIControlPlaneStore(directory, async () => ({ stdout: "runtime 1.0.0", stderr: "" }));
  try {
    const authenticationFailure = new AgentRuntimeExecutor(controlPlane, async () => {
      throw Object.assign(new Error("private command details"), { stdout: JSON.stringify({ error: { message: "Provided authentication token is expired." } }), stderr: "" });
    });
    const auth = await authenticationFailure.probeRuntime("opencode");
    assert.equal(auth.ok, false);
    assert.equal(auth.failureCode, "authentication-required");
    assert.doesNotMatch(auth.detail, /customer@example\.com|private command/i);

    const schemaFailure = new AgentRuntimeExecutor(controlPlane, async () => ({
      stdout: `${JSON.stringify({ type: "text", part: { text: JSON.stringify({ status: "almost" }) } })}\n`,
      stderr: "",
    }));
    const schema = await schemaFailure.probeRuntime("opencode");
    assert.equal(schema.ok, false);
    assert.equal(schema.failureCode, "schema-invalid");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("durable plan and outcome memory close the approval learning loop", () => {
  const directory = mkdtempSync(join(tmpdir(), "distribution-os-loop-"));
  const database = new DistributionDatabase(directory);
  try {
    const productId = seedProduct(database);
    database.addAudienceSignals(productId, [{
      type: "text",
      label: "Founder community discussion",
      sourceUrl: "",
      summary: "Several founders asked how to choose a distribution channel without defaulting to spam.",
      excerpt: "Several founders asked how to choose a distribution channel without defaulting to spam.",
      classification: "intent",
      confidence: 52,
    }]);
    assert.equal(database.getDashboard().audienceSignals[0]?.classification, "audience-signal");
    const runId = database.beginHarnessRun({ kind: "distribution-plan", productId, runtimeId: "native", provider: "test", model: "model" });
    const application = database.applyDistributionPlan({
      runId,
      productId,
      summary: "A cited plan.",
      assumptions: [],
      mode: "ai",
      warning: "",
      moves: [{
        channelId: "devto",
        type: "durable-content",
        title: "Document the evidence-first distribution loop",
        whyNow: "The approved brief can be turned into a durable explanation.",
        suggestedAngle: "Explain the workflow and its limits.",
        draftCopy: "Distribution becomes more useful when every move cites product evidence and records an outcome.",
        citationLabels: ["Founder brief"],
        relevanceScore: 90,
        valueScore: 84,
        freshnessScore: 74,
        promotionRisk: 10,
      }],
    });
    assert.equal(application.insertedCount, 1);
    assert.equal(application.opportunityIds.length, 1);
    const opportunity = database.getDashboard().opportunities.find((item) => item.title.startsWith("Document the evidence"));
    assert.ok(opportunity);
    database.decideOpportunity(opportunity.id, "approve");
    database.recordOutcome(opportunity.id, "qualified-visits", 12, "Two readers asked follow-up questions.");
    const memory = database.getOutcomeMemory(productId);
    assert.equal(memory[0]?.metric, "qualified-visits");
    assert.equal(memory[0]?.total, 12);
    assert.equal(database.getDashboard().opportunities.find((item) => item.id === opportunity.id)?.status, "published");
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("fallback plans always cite independent product evidence before audience observations", () => {
  const directory = mkdtempSync(join(tmpdir(), "distribution-os-fallback-"));
  const database = new DistributionDatabase(directory);
  try {
    const productId = seedProduct(database);
    database.addAudienceSignals(productId, [{
      type: "text", label: "Founder discussion", sourceUrl: "", summary: "Founders asked for calmer distribution workflows.", excerpt: "Founders asked for calmer distribution workflows.", classification: "intent", confidence: 52,
    }]);
    const plan = localFallbackPlan(database, productId, "test-run", "Local test");
    assert.ok(plan.moves[0]?.citationLabels.includes("Founder brief"));
    assert.ok(plan.moves[0]?.citationLabels.includes("Founder discussion"));
    assert.equal(new Set(plan.moves[0]?.citationLabels).size, plan.moves[0]?.citationLabels.length);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("required planning tools cannot be skipped silently", () => {
  assert.deepEqual(missingRequiredPlanningTools(["readProductMemory", "readProductEvidence"]), ["readAudienceSignals", "readChannelPolicies", "readOutcomeMemory"]);
  assert.deepEqual(missingRequiredPlanningTools(["readProductMemory", "readProductEvidence", "readAudienceSignals", "readChannelPolicies", "readOutcomeMemory"]), []);
});

test("contribution writing preserves a cited local draft when no model is configured", async () => {
  const directory = mkdtempSync(join(tmpdir(), "distribution-os-draft-"));
  const database = new DistributionDatabase(directory);
  try {
    const productId = seedProduct(database);
    const opportunity = database.getDashboard().opportunities.find((item) => item.productId === productId);
    assert.ok(opportunity);
    const executor = { activeLanguageModel: async () => null } as unknown as NativeModelExecutor;
    const result = await writeContributionDraft(opportunity.id, executor, database);
    assert.equal(result.mode, "fallback");
    assert.ok(result.draftCopy.length >= 20);
    assert.deepEqual(result.citationLabels, ["Founder brief"]);
    const run = database.getHarnessRun(result.runId);
    assert.equal(run.kind, "contribution-draft");
    assert.equal(run.status, "fallback");
    assert.equal(database.getDashboard().opportunities.find((item) => item.id === opportunity.id)?.draftCopy, result.draftCopy);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("required contribution-writing tools cannot be skipped silently", () => {
  assert.deepEqual(missingRequiredDraftTools(["readOpportunity"]), ["readSupportingEvidence"]);
  assert.deepEqual(missingRequiredDraftTools(["readOpportunity", "readSupportingEvidence"]), []);
});

test("runtime failures persist only normalized diagnostics", async () => {
  const directory = mkdtempSync(join(tmpdir(), "distribution-os-private-error-"));
  const database = new DistributionDatabase(directory);
  const controlPlane = new AIControlPlaneStore(directory, async () => ({ stdout: "opencode 1.0.0", stderr: "" }));
  try {
    const productId = seedProduct(database);
    await controlPlane.activateRuntime("opencode");
    const runtimeExecutor = new AgentRuntimeExecutor(controlPlane, async () => {
      throw new Error("Command failed: private prompt customer@example.com");
    });
    const result = await generateDistributionPlan(productId, {} as NativeModelExecutor, runtimeExecutor, controlPlane, database);
    const persisted = JSON.stringify(database.getHarnessRun(result.plan.runId));
    assert.doesNotMatch(`${result.plan.warning}\n${persisted}`, /customer@example\.com|private prompt/i);
    assert.match(result.plan.warning, /failed before producing a reviewable result/i);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("cancelling a planning run never creates fallback work", async () => {
  const directory = mkdtempSync(join(tmpdir(), "distribution-os-cancelled-run-"));
  const database = new DistributionDatabase(directory);
  const controlPlane = new AIControlPlaneStore(directory, async () => ({ stdout: "opencode 1.0.0", stderr: "" }));
  try {
    const productId = seedProduct(database);
    const before = database.getDashboard().opportunities.length;
    await controlPlane.activateRuntime("opencode");
    const runtimeExecutor = new AgentRuntimeExecutor(controlPlane, async () => ({ stdout: "", stderr: "" }));
    const abortController = new AbortController();
    abortController.abort();
    await assert.rejects(
      generateDistributionPlan(productId, {} as NativeModelExecutor, runtimeExecutor, controlPlane, database, { signal: abortController.signal }),
    );
    const dashboard = database.getDashboard();
    assert.equal(dashboard.opportunities.length, before);
    assert.equal(dashboard.harnessRuns[0]?.status, "failed");
    assert.match(dashboard.harnessRuns[0]?.summary ?? "", /cancelled/i);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("automation prepares bounded work once and stops at human approval", async () => {
  const directory = mkdtempSync(join(tmpdir(), "distribution-os-automation-"));
  const database = new DistributionDatabase(directory);
  try {
    const productId = seedProduct(database);
    const playbook = database.createAutomationPlaybook({ productId, intervalMinutes: 60, maxActionsPerRun: 1 });
    let planCalls = 0;
    let draftCalls = 0;
    const kernel = new AutomationKernel(database, {
      syncConnector: async () => ({ importedCount: 0, inspectedCount: 0 }),
      generatePlan: async (targetProductId, maxMoves) => {
        planCalls += 1;
        assert.equal(targetProductId, productId);
        assert.equal(maxMoves, 1);
        const plan = {
          runId: `automation-plan-${planCalls}`,
          productId,
          summary: "One bounded contribution grounded in approved product evidence.",
          assumptions: [],
          mode: "ai" as const,
          warning: "",
          moves: [{
            channelId: "devto",
            type: "durable-content" as const,
            title: `Explain the evidence loop ${planCalls}`,
            whyNow: "The founder-approved brief supports a concrete explanation.",
            suggestedAngle: "Teach the workflow and state its limits without promotional claims.",
            draftCopy: "A useful distribution loop starts with evidence and ends with a measured outcome.",
            citationLabels: ["Founder brief"], relevanceScore: 91, valueScore: 88, freshnessScore: 80, promotionRisk: 8,
          }],
        };
        return { plan, application: database.applyDistributionPlan(plan) };
      },
      writeDraft: async (opportunityId) => {
        draftCalls += 1;
        database.updateOpportunityDraft(opportunityId, "A source-cited founder-editable contribution prepared inside the private ledger.");
        return { runId: "draft-run", opportunityId, draftCopy: "A source-cited founder-editable contribution prepared inside the private ledger.", hook: "Evidence first", callToAction: "What did we miss?", citationLabels: ["Founder brief"], mode: "ai" as const, provider: "test", model: "test", warning: "" };
      },
    });

    const first = await kernel.runPlaybook(playbook.id, "manual", "manual:test-once");
    const repeated = await kernel.runPlaybook(playbook.id, "manual", "manual:test-once");
    assert.equal(first.id, repeated.id);
    assert.equal(first.status, "waiting-approval");
    assert.equal(first.createdOpportunityIds.length, 1);
    assert.equal(first.steps.length, 4);
    assert.equal(first.steps.at(-1)?.name, "Stop at the human approval boundary");
    assert.equal(planCalls, 1);
    assert.equal(draftCalls, 1);
    assert.equal(database.getAutomationState().control.publicExecutionEnabled, false);

    database.decideOpportunity(first.createdOpportunityIds[0], "approve");
    assert.equal(database.getAutomationRun(first.id).status, "completed");
    database.decideOpportunity(first.createdOpportunityIds[0], "restore");
    assert.equal(database.getAutomationRun(first.id).status, "waiting-approval");

    database.setAutomationPaused(true);
    await assert.rejects(() => kernel.runPlaybook(playbook.id), /automation is paused/i);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("interrupted automation runs recover safely after a service restart", () => {
  const directory = mkdtempSync(join(tmpdir(), "distribution-os-automation-recovery-"));
  let database = new DistributionDatabase(directory);
  try {
    const productId = seedProduct(database);
    const playbook = database.createAutomationPlaybook({ productId, intervalMinutes: 60, maxActionsPerRun: 1 });
    const pending = database.beginAutomationRun(playbook.id, "schedule", "schedule:restart-test");
    assert.equal(pending.run.status, "queued");
    database.startAutomationRun(pending.run.id);
    database.close();

    database = new DistributionDatabase(directory);
    const recovered = database.getAutomationRun(pending.run.id);
    assert.equal(recovered.status, "failed");
    assert.match(recovered.error, /closed safely/i);
    assert.equal(database.getDueAutomationPlaybooks().some((item) => item.id === playbook.id), true);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("deleting an evidence loop removes its schedule but preserves completed run history", () => {
  const directory = mkdtempSync(join(tmpdir(), "distribution-os-loop-delete-"));
  const database = new DistributionDatabase(directory);
  try {
    const productId = seedProduct(database);
    const playbook = database.createAutomationPlaybook({ productId, intervalMinutes: 60, maxActionsPerRun: 1 });
    const active = database.beginAutomationRun(playbook.id, "manual", "loop-delete-active").run;
    database.startAutomationRun(active.id);
    assert.throws(() => database.archiveAutomationPlaybook(playbook.id), /active evidence loop run/i);
    database.finishAutomationRun(active.id, "completed", "One bounded cycle completed.");

    database.archiveAutomationPlaybook(playbook.id);
    assert.throws(() => database.getAutomationPlaybook(playbook.id), /not found/i);
    assert.equal(database.getAutomationState().playbooks.some((item) => item.id === playbook.id), false);
    assert.equal(database.getDueAutomationPlaybooks("9999-12-31T23:59:59.999Z").some((item) => item.id === playbook.id), false);
    assert.equal(database.getAutomationRun(active.id).summary, "One bounded cycle completed.");
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("DEV First Win Loop quarantines signals, publishes only an approved edit, and refreshes outcomes", async () => {
  const directory = mkdtempSync(join(tmpdir(), "distribution-os-devto-"));
  const database = new DistributionDatabase(directory);
  const previousKey = process.env.DEVTO_API_KEY;
  delete process.env.DEVTO_API_KEY;
  let storedKey: string | null = null;
  let publishedBody = "";
  let metricVersion = 0;
  const fetcher = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url.endsWith("/users/me")) return Response.json({ id: 7, username: "founder" });
    if (url.includes("/articles/search")) return Response.json([{
      id: 41, title: "Distribution without spam", description: "A technical founder asks how to choose a useful channel.",
      url: "https://dev.to/founder/distribution-without-spam", published_at: "2026-08-20T12:00:00Z", comments_count: 3, public_reactions_count: 7,
    }]);
    if (url.endsWith("/articles") && init?.method === "POST") {
      publishedBody = String(init.body);
      return Response.json({ id: 99, title: "Evidence-first distribution", url: "https://dev.to/me/evidence-first-distribution", comments_count: 0, public_reactions_count: 0, page_views_count: 1 }, { status: 201 });
    }
    if (url.includes("/articles/me/all")) return Response.json([{
      id: 99, title: "Evidence-first distribution", url: "https://dev.to/me/evidence-first-distribution",
      comments_count: metricVersion ? 2 : 0, public_reactions_count: metricVersion ? 5 : 0, page_views_count: metricVersion ? 31 : 1,
    }]);
    throw new Error(`Unexpected DEV request: ${url}`);
  };
  const connector = new DevToConnector(database, fetcher as typeof fetch, {
    read: async () => storedKey,
    write: async (secret) => { storedKey = secret; },
  });
  try {
    const productId = seedProduct(database);
    await connector.saveApiKey("devto-test-key-123456");
    assert.equal(storedKey, "devto-test-key-123456");
    const connected = await connector.connectAndSync(productId, "technical founder distribution", ["opensource", "productivity"]);
    assert.equal(connected.imported, 1);
    let dashboard = database.getDashboard();
    assert.equal(dashboard.signalInbox[0]?.origin, "devto");
    assert.equal(dashboard.signalInbox[0]?.status, "new");
    assert.equal(dashboard.audienceSignals.length, 0);
    database.decideSignalCandidate(dashboard.signalInbox[0].id, "accept");
    assert.equal(database.getDashboard().audienceSignals.length, 1);

    const runId = database.beginHarnessRun({ kind: "distribution-plan", productId, runtimeId: "native" });
    database.applyDistributionPlan({
      runId, productId, summary: "One cited DEV contribution.", assumptions: [], mode: "ai", warning: "",
      moves: [{
        channelId: "devto", type: "durable-content", title: "A practical evidence-first distribution loop",
        whyNow: "A current DEV discussion exposes the exact founder problem.", suggestedAngle: "Share the bounded workflow and ask where it breaks.",
        draftCopy: "Start with a real observation, cite the product evidence, and make one useful contribution. Then measure what actually happened.",
        citationLabels: ["Distribution without spam"], relevanceScore: 94, valueScore: 90, freshnessScore: 88, promotionRisk: 8,
      }],
    });
    dashboard = database.getDashboard();
    const opportunity = dashboard.opportunities.find((item) => item.title.startsWith("A practical evidence"));
    assert.ok(opportunity);
    await assert.rejects(() => connector.executeApproved(opportunity.id), /Approve/);
    database.decideOpportunity(opportunity.id, "approve", `${opportunity.draftCopy}\n\nFounder edit.`);
    const receipt = await connector.executeApproved(opportunity.id);
    assert.equal(receipt.externalId, "99");
    assert.match(publishedBody, /Founder edit/);
    metricVersion = 1;
    assert.equal(await connector.syncOutcomes(), 1);
    const measured = database.getDashboard().opportunities.find((item) => item.id === opportunity.id);
    assert.equal(measured?.execution?.status, "published");
    assert.equal(measured?.outcomes.find((item) => item.metric === "views")?.value, 31);
    assert.equal(database.getOutcomeMemory(productId).find((item) => item.metric === "comments")?.total, 2);
  } finally {
    if (previousKey === undefined) delete process.env.DEVTO_API_KEY;
    else process.env.DEVTO_API_KEY = previousKey;
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
