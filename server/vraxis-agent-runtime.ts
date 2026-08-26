import {
  AgentV,
  defineAgent,
  defineExtension,
  defineOutput,
  defineTool,
  EngineRegistry,
  ExtensionRegistry,
  localExecutionScope,
  type JsonObject,
  type JsonValue,
  type RunProvenance,
  type ToolExecutionAudit,
} from "@vraxis/agent-v";
import { AiSdkToolAgentEngine } from "@vraxis/agent-v/ai-sdk";
import type { LanguageModel } from "ai";
import { z, type ZodType } from "zod";

export const DISTRIBUTION_OS_VRAXIS_TOOL_ADAPTER_STRATEGY = "distribution-os-vraxis-ai-sdk-v7-tool-agent-v1";

export interface DistributionReadTool {
  name: string;
  description: string;
  execute(): unknown | Promise<unknown>;
}

export interface GovernedAgentRequest<T> {
  agentId: string;
  agentName: string;
  model: LanguageModel;
  provider: string;
  modelId: string;
  projectId: string;
  runId: string;
  instructions: string;
  prompt: string;
  schema: ZodType<T>;
  tools: readonly DistributionReadTool[];
  requiredSequence: readonly string[];
  maxSteps: number;
  abortSignal?: AbortSignal;
  metadata?: JsonObject;
}

export interface GovernedAgentResult<T> {
  output: T;
  steps: number;
  durationMs: number;
  provenance: RunProvenance;
  toolAudit: ToolExecutionAudit;
}

function toJsonValue(value: unknown): JsonValue {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError("A Distribution OS read tool returned a non-JSON value.");
  return JSON.parse(serialized) as JsonValue;
}

function readTool(definition: DistributionReadTool) {
  return defineTool({
    name: definition.name,
    version: "1.0.0",
    description: definition.description,
    input: defineOutput({
      name: `${definition.name}-input`,
      jsonSchema: { type: "object", additionalProperties: false },
      parse(value) {
        if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length) {
          throw new TypeError(`${definition.name} does not accept input.`);
        }
        return {};
      },
    }),
    output: defineOutput<JsonValue>({
      name: `${definition.name}-output`,
      jsonSchema: {},
      parse: toJsonValue,
    }),
    requiresApproval: false,
    risk: "read",
    sideEffect: "none",
    requiredPermissions: [],
    timeoutMs: 10_000,
    async execute() {
      return toJsonValue(await definition.execute());
    },
  });
}

/**
 * Runs one Distribution OS read/decide loop through the portable Vraxis agent
 * contract. Product evidence policy and post-generation validation stay local.
 */
export async function runGovernedAgentWithVraxis<T>(
  request: GovernedAgentRequest<T>,
): Promise<GovernedAgentResult<T>> {
  const engineId = "distribution-os-native-tool-agent";
  const engine = new AiSdkToolAgentEngine({
    id: engineId,
    name: "Distribution OS governed agent",
    model: request.model,
    provider: request.provider,
    modelId: request.modelId,
    adapterStrategy: DISTRIBUTION_OS_VRAXIS_TOOL_ADAPTER_STRATEGY,
    runtime: "vercel-ai-sdk",
    runtimeVersion: "7",
  });
  const tools = request.tools.map(readTool);
  const extensions = new ExtensionRegistry().use(defineExtension({
    id: `${request.agentId}-tools`,
    version: "1.0.0",
    tools,
  }));
  const agent = new AgentV({
    engines: new EngineRegistry().register(engine),
    extensions,
  });
  const blueprint = defineAgent({
    id: request.agentId,
    name: request.agentName,
    engineId,
    instructions: request.instructions,
    skills: [],
    tools: tools.map((tool) => tool.name),
    requiredCapabilities: ["structured-output", "tools", "tool-filtering", "tool-sequencing", "tool-audit"],
    maxSteps: request.maxSteps,
    toolPolicy: {
      requiredSequence: request.requiredSequence,
      afterRequired: "disable",
    },
  });
  const scope = {
    ...localExecutionScope(request.projectId),
    permissions: [],
    dataClassification: "confidential" as const,
  };
  const result = await agent.run<T>(blueprint, {
    runId: request.runId,
    scope,
    abortSignal: request.abortSignal,
    metadata: request.metadata,
    input: { prompt: request.prompt },
    output: defineOutput({
      name: `${request.agentId}-output`,
      description: "Schema-bound output validated by the Distribution OS domain contract.",
      jsonSchema: z.toJSONSchema(request.schema) as JsonObject,
      parse: (value) => request.schema.parse(value),
    }),
  });
  return {
    output: result.output,
    steps: result.steps,
    durationMs: result.durationMs,
    provenance: result.provenance,
    toolAudit: result.toolAudit,
  };
}
