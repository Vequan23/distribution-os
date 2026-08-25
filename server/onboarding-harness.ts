import { z } from "zod";
import type { DistributionDatabase } from "./database.ts";
import { PRODUCT_STAGES, type IngestedSource, type ProductBriefDraft, type ProductBriefField } from "./domain.ts";
import type { NativeModelExecutor } from "./model-executor.ts";
import { safeHarnessFailure } from "./safe-errors.ts";

const citedField = z.object({
  value: z.string().min(2).max(600),
  citations: z.array(z.string().min(1).max(160)).max(8),
  needsReview: z.boolean(),
});

const citedStage = z.object({
  value: z.enum(PRODUCT_STAGES),
  citations: z.array(z.string().min(1).max(160)).max(8),
  needsReview: z.boolean(),
});

const citedObjective = z.object({
  value: z.string().min(8).max(180),
  citations: z.array(z.string().min(1).max(160)).max(8),
});

export const productBriefSynthesisSchema = z.object({
  name: citedField,
  description: citedField,
  audience: citedField,
  positioning: citedField,
  stage: citedStage,
  suggestedObjectives: z.array(citedObjective).min(2).max(4),
});

type ProductBriefSynthesis = z.infer<typeof productBriefSynthesisSchema>;

function sourcePrompt(sources: IngestedSource[]): string {
  return sources.map((source, index) => [
    `[SOURCE ${index + 1}]`,
    `Label: ${source.label}`,
    `Evidence class: ${source.classification}`,
    `Source type: ${source.type}`,
    `Summary: ${source.summary}`,
    `Excerpt:\n${source.excerpt.slice(0, 12_000)}`,
  ].join("\n")).join("\n\n").slice(0, 72_000);
}

function citedFieldValue(
  generated: ProductBriefSynthesis["name"],
  local: ProductBriefField,
  labels: Set<string>,
): ProductBriefField {
  const validLabels = [...new Set(generated.citations.filter((label) => labels.has(label)))];
  const grounded = validLabels.length > 0;
  if (!grounded) return { ...local, sourceLabels: [...local.sourceLabels], needsReview: true };
  return {
    value: generated.value.trim() || local.value,
    confidence: Math.min(92, local.confidence + 10),
    sourceLabels: validLabels,
    needsReview: generated.needsReview,
  };
}

export async function synthesizeProductBrief(
  sources: IngestedSource[],
  local: ProductBriefDraft,
  executor: NativeModelExecutor,
  database: DistributionDatabase,
): Promise<ProductBriefDraft> {
  const descriptor = await executor.activeDescriptor();
  if (!descriptor) return local;

  const runId = database.beginHarnessRun({ kind: "onboarding", runtimeId: "native", provider: descriptor.provider, model: descriptor.model });
  const evidenceStep = database.beginHarnessStep(runId, 1, "Bound product evidence", `${sources.length} source${sources.length === 1 ? "" : "s"} prepared without secrets or dependency trees.`);
  database.finishHarnessStep(evidenceStep, "completed", `${sources.length} bounded source${sources.length === 1 ? "" : "s"} ready for synthesis.`);
  const synthesisStep = database.beginHarnessStep(runId, 2, "Synthesize cited product brief", "Waiting for structured model output.");
  try {
    const generation = await executor.generateObject({
      schema: productBriefSynthesisSchema,
      instructions: [
        "You are the product understanding stage of Distribution-OS.",
        "Produce a concise product brief using only the supplied sources.",
        "Every field, the stage, and every suggested objective must cite one or more source labels exactly as written.",
        "Do not turn intent into shipped capability, implementation into customer demand, or public claims into verified outcomes.",
        "Mark fields needsReview when the evidence is ambiguous, aspirational, conflicting, or incomplete.",
        "Objectives must be measurable distribution learning outcomes, not vanity metrics or spam volume.",
      ].join(" "),
      prompt: `Synthesize a founder-reviewable product brief from this bounded evidence.\n\n${sourcePrompt(sources)}`,
    });
    const labels = new Set(sources.map((source) => source.label));
    const stageLabels = generation.output.stage.citations.filter((label) => labels.has(label));
    const citedObjectives = generation.output.suggestedObjectives.filter((objective) => objective.citations.some((label) => labels.has(label)));
    const result: ProductBriefDraft = {
      ...local,
      name: citedFieldValue(generation.output.name, local.name, labels),
      description: citedFieldValue(generation.output.description, local.description, labels),
      audience: citedFieldValue(generation.output.audience, local.audience, labels),
      positioning: citedFieldValue(generation.output.positioning, local.positioning, labels),
      stage: stageLabels.length ? generation.output.stage.value : local.stage,
      suggestedObjectives: citedObjectives.length >= 2 ? citedObjectives.map((objective) => objective.value) : local.suggestedObjectives,
      analysis: { mode: "ai", runId, provider: generation.provider, model: generation.model, warning: "" },
    };
    result.overallConfidence = Math.round((result.name.confidence + result.description.confidence + result.audience.confidence + result.positioning.confidence) / 4);
    database.finishHarnessStep(synthesisStep, "completed", `${generation.provider}/${generation.model} returned a schema-valid, source-cited brief in ${generation.durationMs}ms after ${generation.attempts} attempt${generation.attempts === 1 ? "" : "s"}.`);
    const verifyStep = database.beginHarnessStep(runId, 3, "Verify citations and confidence", "Checking generated claims against supplied source labels.");
    const reviewCount = [result.name, result.description, result.audience, result.positioning].filter((field) => field.needsReview).length;
    database.finishHarnessStep(verifyStep, "completed", `${4 - reviewCount}/4 fields are source-grounded; ${reviewCount} require founder review.`);
    database.finishHarnessRun(runId, "completed", `Cited product brief generated with ${result.overallConfidence}% evidence confidence.`);
    return result;
  } catch (error) {
    const failure = safeHarnessFailure(error, `${descriptor.provider}/${descriptor.model}`);
    database.finishHarnessStep(synthesisStep, "failed", failure.message);
    database.finishHarnessRun(runId, "fallback", "Local extraction returned after AI synthesis failed.", failure.message);
    return { ...local, analysis: { mode: "fallback", runId, provider: descriptor.provider, model: descriptor.model, warning: `AI synthesis was unavailable, so Distribution-OS returned the local evidence extraction. ${failure.message}` } };
  }
}
