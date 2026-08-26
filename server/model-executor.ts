import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogle } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, NoObjectGeneratedError, NoOutputGeneratedError, type LanguageModel } from "ai";
import type { ZodType } from "zod";
import type { JsonObject, RunProvenance } from "@vraxis/agent-v";
import type { ModelProviderId } from "./domain.ts";
import type { AIControlPlaneStore, ResolvedModelExecution } from "./ai-control-plane.ts";
import { generateStructuredWithVraxis } from "./vraxis-model-executor.ts";

export interface StructuredGeneration<T> {
  runId: string;
  output: T;
  provider: ModelProviderId;
  model: string;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  attempts: number;
  provenance: RunProvenance;
}

export interface StructuredGenerationRequest<T> {
  schema: ZodType<T>;
  instructions: string;
  prompt: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  projectId?: string;
  runId?: string;
  metadata?: JsonObject;
}

export type StructuredGenerator = <T>(request: StructuredGenerationRequest<T>) => Promise<StructuredGeneration<T>>;

function compatibleBaseUrl(execution: ResolvedModelExecution): string {
  const value = execution.profile.baseUrl.replace(/\/$/, "");
  if (execution.profile.provider === "ollama" && !value.endsWith("/v1")) return `${value}/v1`;
  return value;
}

function languageModel(execution: ResolvedModelExecution): LanguageModel {
  const { profile, apiKey } = execution;
  if (profile.provider === "openai") {
    return createOpenAI({ apiKey, baseURL: profile.baseUrl })(profile.model);
  }
  if (profile.provider === "anthropic") {
    return createAnthropic({ apiKey, baseURL: profile.baseUrl })(profile.model);
  }
  if (profile.provider === "google") {
    return createGoogle({ apiKey, baseURL: profile.baseUrl })(profile.model);
  }
  const compatible = createOpenAICompatible({
    name: `distribution-os-${profile.provider}`,
    apiKey: apiKey || "local-model",
    baseURL: compatibleBaseUrl(execution),
    includeUsage: true,
    supportsStructuredOutputs: true,
    headers: profile.provider === "openrouter"
      ? { "HTTP-Referer": "https://distribution-os.local", "X-Title": "Distribution-OS" }
      : undefined,
  });
  return compatible(profile.model);
}

export class NativeModelExecutor {
  private readonly controlPlane: AIControlPlaneStore;

  constructor(controlPlane: AIControlPlaneStore) {
    this.controlPlane = controlPlane;
  }

  async available(): Promise<boolean> {
    return Boolean(await this.controlPlane.getConfiguredModelExecution());
  }

  async activeDescriptor(): Promise<{ provider: ModelProviderId; model: string } | null> {
    const execution = await this.controlPlane.getConfiguredModelExecution();
    return execution ? { provider: execution.profile.provider, model: execution.profile.model } : null;
  }

  async activeLanguageModel(): Promise<{ languageModel: LanguageModel; provider: ModelProviderId; model: string } | null> {
    const execution = await this.controlPlane.getActiveModelExecution();
    return execution ? { languageModel: languageModel(execution), provider: execution.profile.provider, model: execution.profile.model } : null;
  }

  async testProfile(profileId: string): Promise<{ provider: ModelProviderId; model: string; durationMs: number }> {
    const execution = await this.controlPlane.getModelExecution(profileId);
    if (!execution) throw new Error("This profile is missing a usable credential or local endpoint configuration.");
    const startedAt = Date.now();
    await generateText({
      model: languageModel(execution),
      prompt: "Reply with READY.",
      maxOutputTokens: 8,
      abortSignal: AbortSignal.timeout(20_000),
    });
    return { provider: execution.profile.provider, model: execution.profile.model, durationMs: Date.now() - startedAt };
  }

  async generateObject<T>(request: StructuredGenerationRequest<T>): Promise<StructuredGeneration<T>> {
    const execution = await this.controlPlane.getConfiguredModelExecution();
    if (!execution) throw new Error("Select a ready model profile before running AI synthesis.");
    const startedAt = Date.now();
    let previousError: unknown;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const result = await generateStructuredWithVraxis({
          model: languageModel(execution),
          provider: execution.profile.provider,
          modelId: execution.profile.model,
          instructions: `${request.instructions}${attempt === 2 ? " The previous response failed schema validation. Return a complete object matching the schema exactly." : ""}`,
          prompt: request.prompt.slice(0, 90_000),
          schema: request.schema,
          projectId: request.projectId || "distribution-os",
          runId: request.runId ? `${request.runId}:structured:${attempt}` : undefined,
          metadata: { ...request.metadata, attempt, operation: "structured-generation" },
          abortSignal: request.signal
            ? AbortSignal.any([request.signal, AbortSignal.timeout(request.timeoutMs ?? 60_000)])
            : AbortSignal.timeout(request.timeoutMs ?? 60_000),
        });
        return {
          runId: result.runId,
          output: result.output,
          provider: execution.profile.provider,
          model: execution.profile.model,
          durationMs: Date.now() - startedAt,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          attempts: attempt,
          provenance: result.provenance,
        };
      } catch (error) {
        previousError = error;
        if (attempt === 2 || (!NoObjectGeneratedError.isInstance(error) && !NoOutputGeneratedError.isInstance(error))) throw error;
      }
    }
    throw previousError;
  }
}
