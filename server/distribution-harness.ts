import { isStepCount, Output, tool, ToolLoopAgent } from "ai";
import { z } from "zod";
import type { DistributionDatabase } from "./database.ts";
import type { DistributionPlan, DistributionPlanMove, PlanApplication } from "./domain.ts";
import type { AIControlPlaneStore } from "./ai-control-plane.ts";
import type { NativeModelExecutor } from "./model-executor.ts";
import type { AgentRuntimeExecutor } from "./runtime-executor.ts";
import { safeHarnessFailure } from "./safe-errors.ts";

export const planSchema = z.object({
  summary: z.string().min(20).max(700),
  assumptions: z.array(z.string().min(4).max(240)).max(8),
  moves: z.array(z.object({
    channelId: z.enum(["linkedin", "bluesky", "x", "devto"]),
    type: z.enum(["owned-post", "community-contribution", "durable-content"]),
    title: z.string().min(8).max(160),
    whyNow: z.string().min(12).max(420),
    suggestedAngle: z.string().min(12).max(500),
    draftCopy: z.string().min(20).max(4_000),
    citationLabels: z.array(z.string().min(1).max(160)).min(1).max(8),
    relevanceScore: z.number().int().min(0).max(100),
    valueScore: z.number().int().min(0).max(100),
    freshnessScore: z.number().int().min(0).max(100),
    promotionRisk: z.number().int().min(0).max(100),
  })).min(1).max(5),
});

export const REQUIRED_PLANNING_TOOLS = ["readProductMemory", "readProductEvidence", "readAudienceSignals", "readChannelPolicies", "readOutcomeMemory"] as const;

export function missingRequiredPlanningTools(toolNames: Iterable<string>): string[] {
  const called = new Set(toolNames);
  return REQUIRED_PLANNING_TOOLS.filter((name) => !called.has(name));
}

export function localFallbackPlan(database: DistributionDatabase, productId: string, runId: string, warning: string): DistributionPlan {
  const { product, evidence } = database.getProductContext(productId);
  const primary = evidence.find((item) => item.kind !== "audience-signal");
  const audienceSignal = evidence.find((item) => item.kind === "audience-signal");
  if (!primary) throw new Error("A distribution plan requires product evidence.");
  const move: DistributionPlanMove = {
    channelId: "linkedin",
    type: "owned-post",
    title: `Explain the problem behind ${product.name}`,
    whyNow: audienceSignal ? `A founder-supplied audience signal provides a concrete conversation to respond to: ${audienceSignal.summary}` : "The product brief is approved, but its problem statement has not yet been tested with the intended audience.",
    suggestedAngle: product.positioning || `Describe the problem ${product.name} addresses and ask the audience where the framing is incomplete.`,
    draftCopy: `${product.name} is being built for ${product.audience}.\n\n${product.description}\n\nThe next question is simple: ${product.objective}.\n\nWhat part of this problem is most costly or frustrating today?`,
    citationLabels: [...new Set(audienceSignal ? [primary.title, audienceSignal.title] : [primary.title])],
    relevanceScore: Math.max(55, product.confidence), valueScore: 76, freshnessScore: 80, promotionRisk: 24,
  };
  return {
    runId,
    productId,
    summary: audienceSignal
      ? "A conservative learning move grounded in product memory and one founder-supplied audience observation."
      : "A conservative source-based learning move generated without external audience signals.",
    assumptions: audienceSignal
      ? ["The audience observation is founder-supplied, bounded, and not treated as verified demand or a representative trend."]
      : ["No live channel or audience signal was available."],
    moves: [move],
    mode: "fallback",
    warning,
  };
}

export async function generateDistributionPlan(
  productId: string,
  executor: NativeModelExecutor,
  runtimeExecutor: AgentRuntimeExecutor,
  controlPlane: AIControlPlaneStore,
  database: DistributionDatabase,
): Promise<{ plan: DistributionPlan; application: PlanApplication }> {
  const execution = await controlPlane.getExecutionProfile();
  const active = execution.runtimeId === "native" ? await executor.activeLanguageModel() : null;
  const runId = database.beginHarnessRun({ kind: "distribution-plan", productId, runtimeId: execution.runtimeId, provider: active?.provider, model: active?.model || execution.runtimeModel || "runtime default" });
  const planStep = database.beginHarnessStep(runId, 1, "Plan evidence-grounded distribution work", execution.runtimeId === "native" ? (active ? "Native agent is gathering product memory, evidence, and channel policy." : "No ready model profile; preparing the local fallback plan.") : `${execution.runtimeId} is reading a bounded temporary evidence workspace.`);

  const context = database.getProductContext(productId);
  const productEvidence = context.evidence.filter((item) => item.kind !== "audience-signal");
  const audienceSignals = context.evidence.filter((item) => item.kind === "audience-signal");
  if (execution.runtimeId !== "native") {
    try {
      const runtimeResult = await runtimeExecutor.generateObject({
        schema: planSchema,
        contextFiles: {
          product: context.product,
          productEvidence: productEvidence.map((item) => ({ title: item.title, summary: item.summary, classification: item.classification, confidence: item.confidence })),
          audienceSignals: audienceSignals.map((item) => ({ title: item.title, summary: item.summary, sourceUrl: item.sourceUrl, confidence: item.confidence })),
          channelPolicy: context.channels.map((item) => ({ id: item.id, name: item.name, mode: item.mode, status: item.status, connected: item.connected, dailyLimit: item.dailyLimit })),
          outcomeMemory: database.getOutcomeMemory(productId),
        },
        prompt: [
          "Build the next evidence-grounded distribution plan.",
          "Return keys: summary, assumptions, moves. Each move requires channelId, type, title, whyNow, suggestedAngle, draftCopy, citationLabels, relevanceScore, valueScore, freshnessScore, promotionRisk.",
          "Use at most three moves and cite evidence titles exactly. Prefer useful contributions and learning over reach. Never describe an audience signal as live, representative, or independently verified.",
        ].join(" "),
      });
      const evidenceLabels = new Set(context.evidence.map((item) => item.title));
      const productLabels = new Set(productEvidence.map((item) => item.title));
      const moves = runtimeResult.output.moves.map((move) => ({ ...move, citationLabels: [...new Set(move.citationLabels.filter((label) => evidenceLabels.has(label)))] })).filter((move) => move.citationLabels.some((label) => productLabels.has(label)));
      if (!moves.length) throw new Error("The runtime did not return any source-cited distribution moves.");
      const plan: DistributionPlan = { runId, productId, summary: runtimeResult.output.summary, assumptions: runtimeResult.output.assumptions, moves, mode: "ai", warning: "" };
      database.finishHarnessStep(planStep, "completed", `${runtimeResult.runtimeId} completed ${runtimeResult.activityCount} activity event${runtimeResult.activityCount === 1 ? "" : "s"} in ${runtimeResult.durationMs}ms after ${runtimeResult.attempts} attempt${runtimeResult.attempts === 1 ? "" : "s"} and returned ${moves.length} cited move${moves.length === 1 ? "" : "s"}.`);
      const application = database.applyDistributionPlan(plan);
      database.finishHarnessRun(runId, "completed", `${application.insertedCount} new cited move${application.insertedCount === 1 ? "" : "s"} added to the review queue.`);
      return { plan, application };
    } catch (error) {
      const failure = safeHarnessFailure(error, execution.runtimeId);
      database.finishHarnessStep(planStep, "failed", failure.message);
      const fallback = localFallbackPlan(database, productId, runId, `${failure.message} A conservative local plan was used instead.`);
      const application = database.applyDistributionPlan(fallback);
      database.finishHarnessRun(runId, "fallback", fallback.summary, fallback.warning.slice(0, 1_000));
      return { plan: fallback, application };
    }
  }

  if (!active) {
    const fallback = localFallbackPlan(database, productId, runId, "No ready native model profile was selected.");
    const application = database.applyDistributionPlan(fallback);
    database.finishHarnessStep(planStep, "skipped", fallback.warning);
    database.finishHarnessRun(runId, "fallback", fallback.summary, fallback.warning);
    return { plan: fallback, application };
  }

  const agent = new ToolLoopAgent({
    model: active.languageModel,
    instructions: [
      "You are the governed Distribution-OS planning agent.",
      "Use the available read-only tools before producing a plan.",
      "Return at most three high-leverage moves. Contribution and useful learning beat reach.",
      "Do not invent trends, conversations, customer demand, metrics, testimonials, or external signals.",
      "Every move must cite at least one exact product evidence title returned by readProductEvidence. Claims based on audience observations may additionally cite exact labels from readAudienceSignals.",
      "Respect channel policy. Public execution always remains a separate human approval step.",
      "Drafts should sound direct and human, avoid hype, and expose uncertainty honestly.",
    ].join(" "),
    tools: {
      readProductMemory: tool({
        description: "Read the founder-approved product brief and current distribution objective.",
        inputSchema: z.object({}),
        execute: async () => context.product,
      }),
      readProductEvidence: tool({
        description: "Read bounded evidence labels and summaries. These are the only valid factual sources for claims.",
        inputSchema: z.object({}),
        execute: async () => productEvidence.map((item) => ({ title: item.title, summary: item.summary, classification: item.classification, confidence: item.confidence })),
      }),
      readAudienceSignals: tool({
        description: "Read founder-supplied public URLs or discussion excerpts. These are bounded observations, not proof of demand or a live trend feed.",
        inputSchema: z.object({}),
        execute: async () => audienceSignals.map((item) => ({ title: item.title, summary: item.summary, sourceUrl: item.sourceUrl, confidence: item.confidence })),
      }),
      readChannelPolicies: tool({
        description: "Read configured channel modes, connection state, and daily limits.",
        inputSchema: z.object({}),
        execute: async () => context.channels.map((item) => ({ id: item.id, name: item.name, mode: item.mode, status: item.status, connected: item.connected, dailyLimit: item.dailyLimit })),
      }),
      readOutcomeMemory: tool({
        description: "Read measured outcomes from prior approved moves so the next plan can learn instead of repeating blindly.",
        inputSchema: z.object({}),
        execute: async () => database.getOutcomeMemory(productId),
      }),
    },
    output: Output.object({ schema: planSchema }),
    stopWhen: isStepCount(10),
    prepareStep: ({ stepNumber }) => {
      const toolName = REQUIRED_PLANNING_TOOLS[stepNumber];
      return toolName
        ? { activeTools: [toolName], toolChoice: { type: "tool" as const, toolName } }
        : { toolChoice: "none" as const };
    },
  });

  try {
    const result = await agent.generate({ prompt: `Build the next distribution plan for product ${productId}. Read product memory, evidence, audience signals, channel policies, and outcome memory before deciding.` });
    const missingTools = missingRequiredPlanningTools(result.toolCalls.map((call) => call.toolName));
    if (missingTools.length) throw new Error(`Required planning tools were not called: ${missingTools.join(", ")}`);
    const evidenceLabels = new Set(context.evidence.map((item) => item.title));
    const productLabels = new Set(productEvidence.map((item) => item.title));
    const moves = result.output.moves.map((move) => ({ ...move, citationLabels: [...new Set(move.citationLabels.filter((label) => evidenceLabels.has(label)))] })).filter((move) => move.citationLabels.some((label) => productLabels.has(label)));
    if (!moves.length) throw new Error("The agent did not return any source-cited distribution moves.");
    const plan: DistributionPlan = { runId, productId, summary: result.output.summary, assumptions: result.output.assumptions, moves, mode: "ai", warning: "" };
    const steps = result.steps as Array<{ toolCalls?: Array<{ toolName?: string }>; toolResults?: unknown[]; text?: string }>;
    database.finishHarnessStep(planStep, "completed", `Agent completed ${steps.length} model step${steps.length === 1 ? "" : "s"} and returned ${moves.length} cited move${moves.length === 1 ? "" : "s"}.`);
    steps.forEach((step, index) => {
      const toolNames = [...new Set((step.toolCalls || []).map((call) => call.toolName || "tool"))];
      if (!toolNames.length) return;
      const id = database.beginHarnessStep(runId, index + 2, `Tool output: ${toolNames.join(", ")}`, `${step.toolResults?.length || 0} result${step.toolResults?.length === 1 ? "" : "s"} returned to the next model step.`);
      database.finishHarnessStep(id, "completed", `${toolNames.join(", ")} output was chained into the agent context.`);
    });
    const application = database.applyDistributionPlan(plan);
    database.finishHarnessRun(runId, "completed", `${application.insertedCount} new cited move${application.insertedCount === 1 ? "" : "s"} added to the review queue.`);
    return { plan, application };
  } catch (error) {
    const failure = safeHarnessFailure(error, "The native planning agent");
    database.finishHarnessStep(planStep, "failed", failure.message);
    const fallback = localFallbackPlan(database, productId, runId, `${failure.message} A conservative local plan was used instead.`);
    const application = database.applyDistributionPlan(fallback);
    database.finishHarnessRun(runId, "fallback", fallback.summary, fallback.warning.slice(0, 1_000));
    return { plan: fallback, application };
  }
}
