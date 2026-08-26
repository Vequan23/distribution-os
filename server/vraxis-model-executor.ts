import { defineOutput, localExecutionScope, type EventSink, type JsonObject, type RunProvenance } from "@vraxis/agent-v";
import { AiSdkStructuredModelEngine } from "@vraxis/agent-v/ai-sdk";
import type { LanguageModel } from "ai";
import { z, type ZodType } from "zod";

export const DISTRIBUTION_OS_VRAXIS_ADAPTER_STRATEGY = "distribution-os-vraxis-ai-sdk-v7-structured-v1";

export interface VraxisStructuredGenerationRequest<T> {
  model: LanguageModel;
  provider: string;
  modelId: string;
  schema: ZodType<T>;
  instructions: string;
  prompt: string;
  projectId: string;
  runId?: string;
  abortSignal?: AbortSignal;
  metadata?: JsonObject;
  events?: EventSink;
}

export interface VraxisStructuredGeneration<T> {
  runId: string;
  output: T;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  provenance: RunProvenance;
}

/**
 * Distribution OS owns product evidence and provider credentials. Vraxis owns
 * the provider-neutral structured execution contract and auditable provenance.
 */
export async function generateStructuredWithVraxis<T>(
  request: VraxisStructuredGenerationRequest<T>,
): Promise<VraxisStructuredGeneration<T>> {
  const engine = new AiSdkStructuredModelEngine({
    id: "distribution-os-native-structured",
    name: "Distribution OS structured model",
    model: request.model,
    provider: request.provider,
    modelId: request.modelId,
    adapterStrategy: DISTRIBUTION_OS_VRAXIS_ADAPTER_STRATEGY,
    runtime: "vercel-ai-sdk",
    runtimeVersion: "7",
  });
  const scope = {
    ...localExecutionScope(request.projectId),
    permissions: [],
    dataClassification: "confidential" as const,
  };
  const result = await engine.generate({
    runId: request.runId,
    scope,
    abortSignal: request.abortSignal,
    metadata: request.metadata,
    input: {
      instructions: request.instructions,
      prompt: request.prompt,
    },
    output: defineOutput({
      name: "distribution-os-structured-output",
      description: "Schema-bound output validated by the Distribution OS domain contract.",
      jsonSchema: z.toJSONSchema(request.schema) as JsonObject,
      parse: (value) => request.schema.parse(value),
    }),
  }, request.events);
  return {
    runId: result.runId,
    output: result.output,
    durationMs: result.durationMs,
    inputTokens: result.usage?.input ?? 0,
    outputTokens: result.usage?.output ?? 0,
    provenance: result.provenance,
  };
}
