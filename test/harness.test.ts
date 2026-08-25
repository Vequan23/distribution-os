import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AIControlPlaneStore } from "../server/ai-control-plane.ts";
import { DistributionDatabase } from "../server/database.ts";
import { generateDistributionPlan, localFallbackPlan, missingRequiredPlanningTools, planSchema } from "../server/distribution-harness.ts";
import { buildProductBrief } from "../server/ingestion.ts";
import type { NativeModelExecutor } from "../server/model-executor.ts";
import { synthesizeProductBrief } from "../server/onboarding-harness.ts";
import { AgentRuntimeExecutor } from "../server/runtime-executor.ts";

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
