import type { ActionAdapter, ActionAdapterDescriptor, ActionDecision, ActionIntent, ActionResult } from "./contracts.ts";
import { evaluateActionPolicy } from "./policy.ts";

export class ActionFabricRegistry {
  private readonly adapters = new Map<string, ActionAdapter>();
  private readonly completed = new Map<string, { fingerprint: string; result: ActionResult }>();

  private fingerprint(intent: ActionIntent): string {
    return JSON.stringify({
      adapterId: intent.adapterId,
      capability: intent.capability,
      actorId: intent.actorId,
      resourceId: intent.resourceId,
      purpose: intent.purpose.trim(),
      evidenceRefs: [...new Set(intent.evidenceRefs.map((value) => value.trim()).filter(Boolean))].sort(),
      dryRun: intent.dryRun,
    });
  }

  register(adapter: ActionAdapter): void {
    if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(adapter.descriptor.id)) throw new Error("Action adapter IDs must use lowercase letters, numbers, and hyphens.");
    if (this.adapters.has(adapter.descriptor.id)) throw new Error(`Action adapter ${adapter.descriptor.id} is already registered.`);
    this.adapters.set(adapter.descriptor.id, adapter);
  }

  descriptors(): ActionAdapterDescriptor[] {
    return [...this.adapters.values()].map((adapter) => structuredClone(adapter.descriptor)).sort((a, b) => a.name.localeCompare(b.name));
  }

  evaluate(intent: ActionIntent): ActionDecision {
    return evaluateActionPolicy(this.adapters.get(intent.adapterId)?.descriptor, intent);
  }

  async execute(intent: ActionIntent, signal?: AbortSignal): Promise<{ decision: ActionDecision; result?: ActionResult }> {
    const prior = this.completed.get(intent.idempotencyKey);
    const fingerprint = this.fingerprint(intent);
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw new Error("Idempotency key is already bound to a different action intent.");
      return { decision: this.evaluate(intent), result: structuredClone(prior.result) };
    }
    const adapter = this.adapters.get(intent.adapterId);
    const decision = evaluateActionPolicy(adapter?.descriptor, intent);
    if (decision.status !== "allowed" || !adapter) return { decision };
    const result = await adapter.execute(intent, signal);
    if (result.status === "completed") this.completed.set(intent.idempotencyKey, { fingerprint, result: structuredClone(result) });
    return { decision, result };
  }
}
