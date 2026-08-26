import assert from "node:assert/strict";
import test from "node:test";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import {
  DISTRIBUTION_OS_VRAXIS_ADAPTER_STRATEGY,
  generateStructuredWithVraxis,
} from "../server/vraxis-model-executor.ts";
import {
  DISTRIBUTION_OS_VRAXIS_TOOL_ADAPTER_STRATEGY,
  runGovernedAgentWithVraxis,
} from "../server/vraxis-agent-runtime.ts";

test("Vraxis executes and validates Distribution OS structured generations with provenance", async () => {
  const events: Array<{ type: string; scope: { projectId: string; permissions: readonly string[]; dataClassification: string } }> = [];
  const model = new MockLanguageModelV4({
    provider: "test-provider",
    modelId: "test-model",
    doGenerate: {
      content: [{ type: "text", text: JSON.stringify({ summary: "Evidence-grounded output" }) }],
      finishReason: { unified: "stop", raw: undefined },
      usage: {
        inputTokens: { total: 12, noCache: 12, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 7, text: 7, reasoning: 0 },
      },
      warnings: [],
    },
  });

  const result = await generateStructuredWithVraxis({
    model,
    provider: "test-provider",
    modelId: "test-model",
    schema: z.object({ summary: z.string().min(10) }).strict(),
    instructions: "Return only supported claims.",
    prompt: "Summarize the bounded evidence.",
    projectId: "project-1",
    runId: "run-1",
    metadata: { operation: "test" },
    events: { emit: async (event) => { events.push(event); } },
  });

  assert.deepEqual(result.output, { summary: "Evidence-grounded output" });
  assert.equal(result.runId, "run-1");
  assert.equal(result.inputTokens, 12);
  assert.equal(result.outputTokens, 7);
  assert.equal(result.provenance.engineId, "distribution-os-native-structured");
  assert.equal(result.provenance.adapterStrategy, DISTRIBUTION_OS_VRAXIS_ADAPTER_STRATEGY);
  assert.equal(result.provenance.provider, "test-provider");
  assert.equal(result.provenance.model, "test-model");
  assert.equal(result.provenance.runtime, "vercel-ai-sdk");
  assert.equal(result.provenance.runtimeVersion, "7");
  assert.equal(model.doGenerateCalls.length, 1);
  assert.equal(events[0]?.type, "run.started");
  assert.equal(events[0]?.scope.projectId, "project-1");
  assert.deepEqual(events[0]?.scope.permissions, []);
  assert.equal(events[0]?.scope.dataClassification, "confidential");
});

test("Vraxis enforces Distribution OS read phases and returns redacted tool audit evidence", async () => {
  const executed: string[] = [];
  let modelCall = 0;
  const usage = {
    inputTokens: { total: 12, noCache: 12, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 7, text: 7, reasoning: 0 },
  };
  const model = new MockLanguageModelV4({
    provider: "test-provider",
    modelId: "test-model",
    doGenerate: async () => {
      modelCall += 1;
      if (modelCall === 1) {
        return {
          content: [{ type: "tool-call" as const, toolCallId: "call-product", toolName: "readProduct", input: "{}" }],
          finishReason: { unified: "tool-calls" as const, raw: undefined }, usage, warnings: [],
        };
      }
      if (modelCall === 2) {
        return {
          content: [{ type: "tool-call" as const, toolCallId: "call-outcomes", toolName: "readOutcomes", input: "{}" }],
          finishReason: { unified: "tool-calls" as const, raw: undefined }, usage, warnings: [],
        };
      }
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ recommendation: "Use measured outcomes in the next contribution." }) }],
        finishReason: { unified: "stop" as const, raw: undefined }, usage, warnings: [],
      };
    },
  });

  const result = await runGovernedAgentWithVraxis({
    agentId: "test-evidence-agent",
    agentName: "Test evidence agent",
    model,
    provider: "test-provider",
    modelId: "test-model",
    projectId: "project-1",
    runId: "run-2",
    instructions: "Read the required evidence before deciding.",
    prompt: "Recommend one next move.",
    schema: z.object({ recommendation: z.string().min(20) }).strict(),
    tools: [
      {
        name: "readProduct",
        description: "Read product memory.",
        execute() {
          executed.push("readProduct");
          return { privateSummary: "confidential product memory" };
        },
      },
      {
        name: "readOutcomes",
        description: "Read prior measured outcomes.",
        execute() {
          executed.push("readOutcomes");
          return [{ metric: "qualified-replies", value: 3 }];
        },
      },
    ],
    requiredSequence: ["readProduct", "readOutcomes"],
    maxSteps: 3,
  });

  assert.deepEqual(executed, ["readProduct", "readOutcomes"]);
  assert.equal(result.output.recommendation, "Use measured outcomes in the next contribution.");
  assert.equal(result.toolAudit.sequenceSatisfied, true);
  assert.deepEqual(result.toolAudit.observedSequence, ["readProduct", "readOutcomes"]);
  assert.equal(result.provenance.adapterStrategy, DISTRIBUTION_OS_VRAXIS_TOOL_ADAPTER_STRATEGY);
  assert.deepEqual(model.doGenerateCalls.map((call) => call.toolChoice), [
    { type: "tool", toolName: "readProduct" },
    { type: "tool", toolName: "readOutcomes" },
    { type: "none" },
  ]);
  assert.equal(model.doGenerateCalls[2]?.tools?.length ?? 0, 0);
  assert.doesNotMatch(JSON.stringify(result.toolAudit), /confidential product memory/);
});
