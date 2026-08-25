import { randomUUID } from "node:crypto";
import type { DistributionDatabase } from "./database.ts";
import {
  evaluateActionPolicy,
  type ActionCapability,
  type ActionDecision,
  type ActionIntent,
} from "../packages/action-fabric/src/index.ts";

export interface ActionPolicyPreviewInput {
  adapterId: string;
  capability: ActionCapability;
  productId?: string;
  evidenceRefs?: string[];
  approved?: boolean;
  dryRun?: boolean;
  budgetUsed?: number;
  budgetLimit?: number;
  purpose?: string;
}

export class DistributionActionFabric {
  private readonly database: DistributionDatabase;

  constructor(database: DistributionDatabase) {
    this.database = database;
  }

  evaluate(input: ActionPolicyPreviewInput): ActionDecision {
    const adapter = this.database.getActionAdapters().find((item) => item.id === input.adapterId);
    const intent: ActionIntent = {
      id: randomUUID(),
      adapterId: input.adapterId,
      capability: input.capability,
      actorId: "local-user",
      resourceId: input.productId || "policy-preview",
      purpose: input.purpose?.trim() || "Evaluate this capability against the local host policy.",
      evidenceRefs: [...new Set(input.evidenceRefs || [])],
      idempotencyKey: `policy:${input.adapterId}:${input.capability}:${input.productId || "preview"}`,
      requestedAt: new Date().toISOString(),
      approved: input.approved === true,
      dryRun: input.dryRun === true,
      budget: {
        used: Number.isFinite(input.budgetUsed) ? Math.max(0, Number(input.budgetUsed)) : 0,
        limit: Number.isFinite(input.budgetLimit) ? Math.max(0, Number(input.budgetLimit)) : 1,
      },
    };
    return evaluateActionPolicy(adapter, intent);
  }
}
