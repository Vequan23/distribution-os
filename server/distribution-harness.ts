import { z } from "zod";
import type { DistributionDatabase } from "./database.ts";
import type { DistributionPlan, DistributionPlanMove, PlanApplication } from "./domain.ts";
import type { AIControlPlaneStore } from "./ai-control-plane.ts";
import type { NativeModelExecutor } from "./model-executor.ts";
import type { AgentRuntimeExecutor } from "./runtime-executor.ts";
import { safeHarnessFailure } from "./safe-errors.ts";
import { runGovernedAgentWithVraxis } from "./vraxis-agent-runtime.ts";

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

function stripTerminalPunctuation(value: string): string {
  return value.trim().replace(/[.!?]+$/g, "");
}

export function evidencePriority(item: { title: string; classification: string; confidence: number }): number {
  const classificationWeight: Record<string, number> = { outcome: 36, implementation: 30, "public-claim": 22, intent: 16, "audience-signal": 8 };
  const title = item.title.toLowerCase();
  const productSignal = /readme|product|brief|architecture|overview/.test(title) ? 12 : 0;
  const policyPenalty = /code of conduct|contributing|license|security policy/.test(title) ? 30 : 0;
  return item.confidence + (classificationWeight[item.classification] || 0) + productSignal - policyPenalty;
}

export function localFallbackPlan(database: DistributionDatabase, productId: string, runId: string, warning: string): DistributionPlan {
  const { product, evidence } = database.getProductContext(productId);
  const primary = evidence.filter((item) => item.kind !== "audience-signal").sort((left, right) => evidencePriority(right) - evidencePriority(left))[0];
  const audienceSignal = evidence.find((item) => item.kind === "audience-signal");
  if (!primary) throw new Error("A distribution plan requires product evidence.");
  const move: DistributionPlanMove = {
    channelId: "linkedin",
    type: "owned-post",
    title: `Explain the problem behind ${product.name}`,
    whyNow: audienceSignal ? `A founder-supplied audience signal provides a concrete conversation to respond to: ${audienceSignal.summary}` : "The product brief is approved, but its problem statement has not yet been tested with the intended audience.",
    suggestedAngle: product.positioning || `Describe the problem ${product.name} addresses and ask the audience where the framing is incomplete.`,
    draftCopy: `${stripTerminalPunctuation(product.description)}.\n\nI am testing this with ${stripTerminalPunctuation(product.audience).toLowerCase()}. The immediate learning goal is to ${stripTerminalPunctuation(product.objective).replace(/^to\s+/i, "")}.\n\nWhere does this problem become most costly or frustrating in practice?`,
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
  options: { maxMoves?: number; signal?: AbortSignal } = {},
): Promise<{ plan: DistributionPlan; application: PlanApplication }> {
  const maxMoves = Math.max(1, Math.min(5, Math.trunc(options.maxMoves ?? 3)));
  const execution = await controlPlane.getExecutionProfile();
  const active = execution.runtimeId === "native" ? await executor.activeLanguageModel() : null;
  const runId = database.beginHarnessRun({ kind: "distribution-plan", productId, runtimeId: execution.runtimeId, provider: active?.provider, model: active?.model || execution.runtimeModel || "runtime default" });
  const planStep = database.beginHarnessStep(runId, 1, "Plan evidence-grounded distribution work", execution.runtimeId === "native" ? (active ? "Native agent is gathering product memory, evidence, and channel policy." : "No ready model profile; preparing the local fallback plan.") : `${execution.runtimeId} is reading a bounded temporary evidence workspace.`);

  const context = database.getProductContext(productId);
  const productEvidence = context.evidence.filter((item) => item.kind !== "audience-signal");
  const audienceSignals = context.evidence.filter((item) => item.kind === "audience-signal");
  const sourceCitedMoves = (output: z.infer<typeof planSchema>): DistributionPlanMove[] => {
    const evidenceLabels = new Set(context.evidence.map((item) => item.title));
    const productLabels = new Set(productEvidence.map((item) => item.title));
    return output.moves
      .map((move) => ({ ...move, citationLabels: [...new Set(move.citationLabels.filter((label) => evidenceLabels.has(label)))] }))
      .filter((move) => move.citationLabels.some((label) => productLabels.has(label)))
      .slice(0, maxMoves);
  };
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
          `Use at most ${maxMoves} moves and cite evidence titles exactly. Prefer useful contributions and learning over reach. Never describe an audience signal as live, representative, or independently verified.`,
        ].join(" "),
        signal: options.signal,
      });
      const moves = sourceCitedMoves(runtimeResult.output);
      if (!moves.length) throw new Error("The runtime did not return any source-cited distribution moves.");
      const plan: DistributionPlan = { runId, productId, summary: runtimeResult.output.summary, assumptions: runtimeResult.output.assumptions, moves, mode: "ai", warning: "" };
      database.finishHarnessStep(planStep, "completed", `${runtimeResult.runtimeId} completed ${runtimeResult.activityCount} activity event${runtimeResult.activityCount === 1 ? "" : "s"} in ${runtimeResult.durationMs}ms after ${runtimeResult.attempts} attempt${runtimeResult.attempts === 1 ? "" : "s"} and returned ${moves.length} cited move${moves.length === 1 ? "" : "s"}.`);
      const application = database.applyDistributionPlan(plan);
      database.finishHarnessRun(runId, "completed", `${application.insertedCount} new cited move${application.insertedCount === 1 ? "" : "s"} added to the review queue.`);
      return { plan, application };
    } catch (error) {
      const failure = safeHarnessFailure(error, execution.runtimeId);
      database.finishHarnessStep(planStep, "failed", `${failure.message} ${failure.diagnostic}`);
      if (options.signal?.aborted) {
        database.finishHarnessRun(runId, "failed", "The planning run was cancelled before it produced reviewable work.", failure.message);
        throw error;
      }
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

  const instructions = [
      "You are the governed Distribution-OS planning agent.",
      "Use the available read-only tools before producing a plan.",
      `Return at most ${maxMoves} high-leverage moves. Contribution and useful learning beat reach.`,
      "Do not invent trends, conversations, customer demand, metrics, testimonials, or external signals.",
      "Every move must cite at least one exact product evidence title returned by readProductEvidence. Claims based on audience observations may additionally cite exact labels from readAudienceSignals.",
      "Respect channel policy. Public execution always remains a separate human approval step.",
      "Drafts should sound direct and human, avoid hype, and expose uncertainty honestly.",
    ].join(" ");
  const tools = [
      {
        name: "readProductMemory",
        description: "Read the founder-approved product brief and current distribution objective.",
        execute: async () => context.product,
      },
      {
        name: "readProductEvidence",
        description: "Read bounded evidence labels and summaries. These are the only valid factual sources for claims.",
        execute: async () => productEvidence.map((item) => ({ title: item.title, summary: item.summary, classification: item.classification, confidence: item.confidence })),
      },
      {
        name: "readAudienceSignals",
        description: "Read founder-supplied public URLs or discussion excerpts. These are bounded observations, not proof of demand or a live trend feed.",
        execute: async () => audienceSignals.map((item) => ({ title: item.title, summary: item.summary, sourceUrl: item.sourceUrl, confidence: item.confidence })),
      },
      {
        name: "readChannelPolicies",
        description: "Read configured channel modes, connection state, and daily limits.",
        execute: async () => context.channels.map((item) => ({ id: item.id, name: item.name, mode: item.mode, status: item.status, connected: item.connected, dailyLimit: item.dailyLimit })),
      },
      {
        name: "readOutcomeMemory",
        description: "Read measured outcomes from prior approved moves so the next plan can learn instead of repeating blindly.",
        execute: async () => database.getOutcomeMemory(productId),
      },
    ] as const;

  try {
    if (options.signal?.aborted) throw new DOMException("The planning run was cancelled.", "AbortError");
    const result = await runGovernedAgentWithVraxis({
      agentId: "distribution-os-planner",
      agentName: "Distribution OS planner",
      model: active.languageModel,
      provider: active.provider,
      modelId: active.model,
      projectId: productId,
      runId,
      instructions,
      prompt: `Build the next distribution plan for product ${productId}. Read product memory, evidence, audience signals, channel policies, and outcome memory before deciding.`,
      schema: planSchema,
      tools,
      requiredSequence: REQUIRED_PLANNING_TOOLS,
      maxSteps: 10,
      abortSignal: options.signal,
      metadata: { operation: "distribution-plan", productId },
    });
    const missingTools = missingRequiredPlanningTools(result.toolAudit.observedSequence);
    if (missingTools.length) throw new Error(`Required planning tools were not called: ${missingTools.join(", ")}`);
    const moves = sourceCitedMoves(result.output);
    if (!moves.length) throw new Error("The agent did not return any source-cited distribution moves.");
    const plan: DistributionPlan = { runId, productId, summary: result.output.summary, assumptions: result.output.assumptions, moves, mode: "ai", warning: "" };
    database.finishHarnessStep(planStep, "completed", `Vraxis completed ${result.steps} model step${result.steps === 1 ? "" : "s"} via ${result.provenance.adapterStrategy} and returned ${moves.length} cited move${moves.length === 1 ? "" : "s"}.`);
    result.toolAudit.calls.forEach((call, index) => {
      const id = database.beginHarnessStep(runId, index + 2, `Tool output: ${call.toolName}`, `Vraxis audit recorded step ${call.step}, tool version ${call.toolVersion}, and ${call.durationMs}ms execution without persisting tool payloads.`);
      database.finishHarnessStep(id, call.status, `${call.toolName} completed under the required evidence-read sequence.`);
    });
    const application = database.applyDistributionPlan(plan);
    database.finishHarnessRun(runId, "completed", `${application.insertedCount} new cited move${application.insertedCount === 1 ? "" : "s"} added to the review queue.`);
    return { plan, application };
  } catch (error) {
    const failure = safeHarnessFailure(error, "The native planning agent");
    database.finishHarnessStep(planStep, "failed", `${failure.message} ${failure.diagnostic}`);
    if (options.signal?.aborted) {
      database.finishHarnessRun(runId, "failed", "The planning run was cancelled before it produced reviewable work.", failure.message);
      throw error;
    }
    if (failure.kind === "invalid-output" && !options.signal?.aborted) {
      const repairStep = database.beginHarnessStep(runId, 2, "Repair structured plan", "The tool-loop result missed the contract, so one schema-focused repair is running against the same bounded evidence.");
      try {
        const repaired = await executor.generateObject({
          schema: planSchema,
          instructions: "Return one complete distribution plan using only the supplied bounded evidence. Every move must cite an exact product evidence title. Do not invent demand, trends, outcomes, or channel access.",
          prompt: JSON.stringify({ product: context.product, productEvidence, audienceSignals, channels: context.channels, outcomes: database.getOutcomeMemory(productId), maxMoves }),
          signal: options.signal,
          projectId: productId,
          runId,
          metadata: { operation: "distribution-plan-repair", productId },
        });
        const moves = sourceCitedMoves(repaired.output);
        if (!moves.length) throw new Error("The repaired plan did not cite supporting product evidence.");
        const plan: DistributionPlan = { runId, productId, summary: repaired.output.summary, assumptions: repaired.output.assumptions, moves, mode: "ai", warning: "" };
        database.finishHarnessStep(repairStep, "completed", `${repaired.provider}/${repaired.model} repaired the plan contract via ${repaired.provenance?.adapterStrategy || "the native structured adapter"} after ${repaired.attempts} structured attempt${repaired.attempts === 1 ? "" : "s"}.`);
        const application = database.applyDistributionPlan(plan);
        database.finishHarnessRun(runId, "completed", `${application.insertedCount} new cited move${application.insertedCount === 1 ? "" : "s"} added after structured repair.`);
        return { plan, application };
      } catch (repairError) {
        const repairFailure = safeHarnessFailure(repairError, "The structured repair");
        database.finishHarnessStep(repairStep, "failed", `${repairFailure.message} ${repairFailure.diagnostic}`);
        if (options.signal?.aborted) {
          database.finishHarnessRun(runId, "failed", "The planning run was cancelled during structured repair.", repairFailure.message);
          throw repairError;
        }
      }
    }
    const fallback = localFallbackPlan(database, productId, runId, `${failure.message} A conservative local plan was used instead.`);
    const application = database.applyDistributionPlan(fallback);
    database.finishHarnessRun(runId, "fallback", fallback.summary, fallback.warning.slice(0, 1_000));
    return { plan: fallback, application };
  }
}
