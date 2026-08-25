import { isStepCount, Output, tool, ToolLoopAgent } from "ai";
import { z } from "zod";
import type { DistributionDatabase } from "./database.ts";
import type { ContributionDraftResult } from "./domain.ts";
import type { NativeModelExecutor } from "./model-executor.ts";
import { safeHarnessFailure } from "./safe-errors.ts";

export const contributionDraftSchema = z.object({
  draftCopy: z.string().min(20).max(4_000),
  hook: z.string().min(4).max(280),
  callToAction: z.string().max(500),
  citationLabels: z.array(z.string().min(1).max(160)).min(1).max(8),
});

export const REQUIRED_DRAFT_TOOLS = ["readOpportunity", "readSupportingEvidence"] as const;

export function missingRequiredDraftTools(toolNames: Iterable<string>): string[] {
  const called = new Set(toolNames);
  return REQUIRED_DRAFT_TOOLS.filter((name) => !called.has(name));
}

function localDraft(
  database: DistributionDatabase,
  opportunityId: string,
  runId: string,
  warning: string,
): ContributionDraftResult {
  const { opportunity, evidence } = database.getOpportunityDraftContext(opportunityId);
  const productEvidence = evidence.find((item) => item.classification !== "audience-signal") || evidence[0];
  if (!productEvidence) throw new Error("A contribution draft requires supporting product evidence.");
  const draftCopy = opportunity.draftCopy.trim() || [
    opportunity.title,
    opportunity.suggestedAngle,
    opportunity.whyNow,
    "What has your experience been?",
  ].join("\n\n");
  database.updateOpportunityDraft(opportunityId, draftCopy);
  return {
    runId,
    opportunityId,
    draftCopy,
    hook: opportunity.title,
    callToAction: "What has your experience been?",
    citationLabels: [productEvidence.title],
    mode: "fallback",
    provider: "local",
    model: "deterministic",
    warning,
  };
}

export async function writeContributionDraft(
  opportunityId: string,
  executor: NativeModelExecutor,
  database: DistributionDatabase,
): Promise<ContributionDraftResult> {
  const context = database.getOpportunityDraftContext(opportunityId);
  const active = await executor.activeLanguageModel();
  const runId = database.beginHarnessRun({
    kind: "contribution-draft",
    productId: context.product.id,
    runtimeId: "native",
    provider: active?.provider,
    model: active?.model || "deterministic",
  });
  const draftStep = database.beginHarnessStep(
    runId,
    1,
    "Write a channel-native contribution",
    active
      ? `The native writer is reading the approved opportunity and ${context.evidence.length} supporting evidence item${context.evidence.length === 1 ? "" : "s"}.`
      : "No ready model profile; preserving the existing source-cited local draft.",
  );

  if (!active) {
    const fallback = localDraft(database, opportunityId, runId, "No ready model profile was selected. The existing local draft was preserved.");
    database.finishHarnessStep(draftStep, "skipped", fallback.warning);
    database.finishHarnessRun(runId, "fallback", "A local source-cited draft remains available for editing.", fallback.warning);
    return fallback;
  }

  const agent = new ToolLoopAgent({
    model: active.languageModel,
    instructions: [
      "You are the governed Distribution-OS contribution writer.",
      "Read the approved opportunity and supporting evidence before writing.",
      "Write one complete, channel-native draft—not a strategy memo or list of alternatives.",
      "Preserve the founder's direct, technically credible voice. Avoid hype, fake urgency, engagement bait, fabricated experience, and unsupported metrics.",
      "For a community contribution, answer the audience's problem before mentioning the product. For an owned post, make the first line useful and specific. For durable content, provide a publishable opening and coherent body.",
      "Use only factual claims supported by evidence returned from readSupportingEvidence.",
      "Cite exact evidence titles in citationLabels. Citations are stored as proof metadata and should not be inserted into the public draft unless naturally useful.",
      "End with a proportionate call to action. A genuine question is preferable to a forced product pitch.",
    ].join(" "),
    tools: {
      readOpportunity: tool({
        description: "Read the selected contribution strategy, intended audience, channel, and current editable draft.",
        inputSchema: z.object({}),
        execute: async () => ({
          product: context.product,
          channel: context.channel,
          opportunity: {
            type: context.opportunity.type,
            title: context.opportunity.title,
            whyNow: context.opportunity.whyNow,
            suggestedAngle: context.opportunity.suggestedAngle,
            audience: context.opportunity.audience,
            currentDraft: context.opportunity.draftCopy,
          },
        }),
      }),
      readSupportingEvidence: tool({
        description: "Read the exact evidence titles and summaries that may support factual claims in the public draft.",
        inputSchema: z.object({}),
        execute: async () => context.evidence.map((item) => ({
          title: item.title,
          summary: item.summary,
          classification: item.classification,
          confidence: item.confidence,
        })),
      }),
    },
    output: Output.object({ schema: contributionDraftSchema }),
    stopWhen: isStepCount(6),
    prepareStep: ({ stepNumber }) => {
      const toolName = REQUIRED_DRAFT_TOOLS[stepNumber];
      return toolName
        ? { activeTools: [toolName], toolChoice: { type: "tool" as const, toolName } }
        : { toolChoice: "none" as const };
    },
  });

  try {
    const result = await agent.generate({
      prompt: `Write the reviewable ${context.channel.name} contribution for opportunity ${opportunityId}. Nothing will be published automatically.`,
    });
    const missingTools = missingRequiredDraftTools(result.toolCalls.map((call) => call.toolName));
    if (missingTools.length) throw new Error(`Required contribution tools were not called: ${missingTools.join(", ")}`);
    const evidenceLabels = new Set(context.evidence.map((item) => item.title));
    const productLabels = new Set(context.evidence.filter((item) => item.classification !== "audience-signal").map((item) => item.title));
    const citationLabels = [...new Set(result.output.citationLabels.filter((label) => evidenceLabels.has(label)))];
    if (!citationLabels.some((label) => productLabels.has(label))) {
      throw new Error("The contribution draft did not cite supporting product evidence.");
    }
    database.updateOpportunityDraft(opportunityId, result.output.draftCopy);
    database.finishHarnessStep(
      draftStep,
      "completed",
      `The writer completed ${result.steps.length} model step${result.steps.length === 1 ? "" : "s"} and cited ${citationLabels.length} evidence item${citationLabels.length === 1 ? "" : "s"}.`,
    );
    result.steps.forEach((step, index) => {
      const toolNames = [...new Set(step.toolCalls.map((call) => call.toolName))];
      if (!toolNames.length) return;
      const id = database.beginHarnessStep(runId, index + 2, `Tool output: ${toolNames.join(", ")}`, `${step.toolResults.length} result${step.toolResults.length === 1 ? "" : "s"} returned to the writer.`);
      database.finishHarnessStep(id, "completed", `${toolNames.join(", ")} output was chained into the next model step.`);
    });
    database.finishHarnessRun(runId, "completed", `A cited ${context.channel.name} contribution draft is ready for human review.`);
    return {
      runId,
      opportunityId,
      draftCopy: result.output.draftCopy,
      hook: result.output.hook,
      callToAction: result.output.callToAction,
      citationLabels,
      mode: "ai",
      provider: active.provider,
      model: active.model,
      warning: "",
    };
  } catch (error) {
    const failure = safeHarnessFailure(error, "The contribution writer");
    database.finishHarnessStep(draftStep, "failed", failure.message);
    const fallback = localDraft(database, opportunityId, runId, `${failure.message} The existing local draft was preserved.`);
    database.finishHarnessRun(runId, "fallback", "The existing source-cited draft remains available for editing.", fallback.warning);
    return fallback;
  }
}
