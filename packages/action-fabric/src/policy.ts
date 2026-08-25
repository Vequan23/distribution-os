import type { ActionAdapterDescriptor, ActionDecision, ActionIntent } from "./contracts.ts";

export function evaluateActionPolicy(adapter: ActionAdapterDescriptor | undefined, intent: ActionIntent): ActionDecision {
  const reasons: string[] = [];
  const evaluatedAt = new Date().toISOString();
  if (!adapter) {
    return {
      status: "blocked",
      reasons: ["The requested adapter is not registered with this host."],
      adapterId: intent.adapterId,
      capability: intent.capability,
      approval: "every-time",
      publicSideEffect: false,
      evaluatedAt,
    };
  }

  if (adapter.state === "disabled" || adapter.state === "planned" || adapter.state === "setup-required") {
    reasons.push(`The adapter is ${adapter.state.replace("-", " ")}.`);
  }
  if (!adapter.capabilities.includes(intent.capability)) {
    reasons.push(`The adapter did not declare the ${intent.capability} capability.`);
  }
  if (!intent.purpose.trim()) reasons.push("Every action needs a human-readable purpose.");
  if (!intent.idempotencyKey.trim()) reasons.push("Every action needs an idempotency key.");
  if (!Number.isInteger(intent.budget.limit) || !Number.isInteger(intent.budget.used) || intent.budget.limit < 1 || intent.budget.used < 0 || intent.budget.used >= intent.budget.limit) reasons.push("The action budget has been exhausted or is invalid.");
  if ((intent.capability === "prepare" || intent.capability === "execute") && !intent.evidenceRefs.some((value) => value.trim())) {
    reasons.push("Preparation and execution must cite at least one evidence record.");
  }

  const publicOrIdentityBearing = adapter.publicSideEffect || adapter.risk === "identity-bearing" || adapter.risk === "irreversible";
  const approval = publicOrIdentityBearing ? "every-time" : adapter.approval;
  if (reasons.length) {
    return { status: "blocked", reasons, adapterId: adapter.id, capability: intent.capability, approval, publicSideEffect: adapter.publicSideEffect, evaluatedAt };
  }
  if (!intent.dryRun && approval === "every-time" && !intent.approved) {
    return {
      status: "approval-required",
      reasons: ["This action can represent the user publicly or create an irreversible side effect."],
      adapterId: adapter.id,
      capability: intent.capability,
      approval,
      publicSideEffect: adapter.publicSideEffect,
      evaluatedAt,
    };
  }
  if (!intent.dryRun && approval === "first-use" && !intent.approved) {
    return {
      status: "approval-required",
      reasons: ["This adapter requires consent before its first live use."],
      adapterId: adapter.id,
      capability: intent.capability,
      approval,
      publicSideEffect: adapter.publicSideEffect,
      evaluatedAt,
    };
  }
  return {
    status: "allowed",
    reasons: [intent.dryRun ? "Dry-run evaluation cannot create an external side effect." : "The action satisfies the adapter contract and host policy."],
    adapterId: adapter.id,
    capability: intent.capability,
    approval,
    publicSideEffect: adapter.publicSideEffect,
    evaluatedAt,
  };
}
