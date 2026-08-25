import { randomUUID } from "node:crypto";
import type { DistributionDatabase } from "./database.ts";
import type { AutomationRun, AutomationTriggerKind, ContributionDraftResult, DistributionPlan, PlanApplication } from "./domain.ts";
import { safeHarnessFailure } from "./safe-errors.ts";
import type { DistributionActionFabric } from "./action-fabric.ts";

interface AutomationDependencies {
  syncConnector: (id: string) => Promise<{ importedCount: number; inspectedCount: number }>;
  generatePlan: (productId: string, maxMoves: number) => Promise<{ plan: DistributionPlan; application: PlanApplication }>;
  writeDraft: (opportunityId: string) => Promise<ContributionDraftResult>;
  actionFabric?: DistributionActionFabric;
}

export class AutomationKernel {
  private ticking = false;
  private readonly database: DistributionDatabase;
  private readonly dependencies: AutomationDependencies;

  constructor(database: DistributionDatabase, dependencies: AutomationDependencies) {
    this.database = database;
    this.dependencies = dependencies;
  }

  async tickDuePlaybooks(): Promise<AutomationRun[]> {
    if (this.ticking) return [];
    this.ticking = true;
    const runs: AutomationRun[] = [];
    try {
      for (const playbook of this.database.getDueAutomationPlaybooks()) {
        const key = `schedule:${playbook.id}:${playbook.nextRunAt}`;
        runs.push(await this.runPlaybook(playbook.id, "schedule", key));
      }
      return runs;
    } finally {
      this.ticking = false;
    }
  }

  async runPlaybook(playbookId: string, trigger: AutomationTriggerKind = "manual", idempotencyKey = `manual:${playbookId}:${randomUUID()}`): Promise<AutomationRun> {
    const playbook = this.database.getAutomationPlaybook(playbookId);
    const started = this.database.beginAutomationRun(playbookId, trigger, idempotencyKey);
    if (!started.created) return started.run;

    const runId = started.run.id;
    let currentStep = "";
    this.database.startAutomationRun(runId);
    try {
      const evidenceRefs = this.database.getProductContext(playbook.productId).evidence.map((item) => item.id);
      const observeDecision = this.dependencies.actionFabric?.evaluate({
        adapterId: "github-observer", capability: "observe", productId: playbook.productId,
        evidenceRefs, purpose: "Refresh bounded public signals for this product.", budgetLimit: playbook.maxActionsPerRun,
      });
      if (observeDecision?.status === "blocked") throw new Error(observeDecision.reasons.join(" "));
      currentStep = this.database.beginAutomationStep(runId, 1, "Observe connected sources", "Refreshing read-only sources. Candidates remain quarantined until founder review.");
      const connectors = this.database.getDashboard().connectors.filter((connector) => connector.productId === playbook.productId);
      let importedCount = 0;
      let inspectedCount = 0;
      let failedSources = 0;
      for (const connector of connectors) {
        try {
          const result = await this.dependencies.syncConnector(connector.id);
          importedCount += result.importedCount;
          inspectedCount += result.inspectedCount;
        } catch {
          failedSources += 1;
        }
      }
      this.database.finishAutomationStep(
        currentStep,
        failedSources === connectors.length && connectors.length > 0 ? "failed" : connectors.length ? "completed" : "skipped",
        connectors.length
          ? `${inspectedCount} bounded signal${inspectedCount === 1 ? "" : "s"} inspected; ${importedCount} candidate${importedCount === 1 ? "" : "s"} added for review${failedSources ? `; ${failedSources} source${failedSources === 1 ? "" : "s"} need attention` : ""}.`
          : "No read-only source connector is attached. Planning will use existing approved evidence.",
      );
      currentStep = "";

      const prepareDecision = this.dependencies.actionFabric?.evaluate({
        adapterId: "ai-preparation", capability: "prepare", productId: playbook.productId,
        evidenceRefs, purpose: "Prepare evidence-cited distribution moves in the private ledger.", budgetLimit: playbook.maxActionsPerRun,
      });
      if (prepareDecision?.status === "blocked") throw new Error(prepareDecision.reasons.join(" "));
      currentStep = this.database.beginAutomationStep(runId, 2, "Plan the next useful actions", `Preparing no more than ${playbook.maxActionsPerRun} evidence-cited move${playbook.maxActionsPerRun === 1 ? "" : "s"}.`);
      const result = await this.dependencies.generatePlan(playbook.productId, playbook.maxActionsPerRun);
      const opportunityIds = result.application.opportunityIds.slice(0, playbook.maxActionsPerRun);
      this.database.finishAutomationStep(currentStep, "completed", opportunityIds.length
        ? `${opportunityIds.length} new move${opportunityIds.length === 1 ? "" : "s"} entered the private review queue.`
        : "The plan matched existing work, so no duplicate move was created.");
      currentStep = "";

      currentStep = this.database.beginAutomationStep(runId, 3, "Prepare founder-editable contributions", "Writing is bounded by the selected opportunity and its exact supporting evidence.");
      let drafted = 0;
      for (const opportunityId of opportunityIds) {
        await this.dependencies.writeDraft(opportunityId);
        drafted += 1;
      }
      this.database.finishAutomationStep(currentStep, opportunityIds.length ? "completed" : "skipped", opportunityIds.length
        ? `${drafted} source-cited draft${drafted === 1 ? "" : "s"} prepared. No public action was taken.`
        : "No new move required a draft.");
      currentStep = "";

      currentStep = this.database.beginAutomationStep(runId, 4, "Stop at the human approval boundary", "Identity-bearing actions cannot cross this boundary automatically.");
      if (opportunityIds.length) {
        const handoffDecision = this.dependencies.actionFabric?.evaluate({
          adapterId: "human-handoff", capability: "execute", productId: playbook.productId,
          evidenceRefs, purpose: "Hand approved context to the founder for an identity-bearing public action.", budgetLimit: playbook.maxActionsPerRun,
        });
        if (handoffDecision && handoffDecision.status !== "approval-required") throw new Error("The public-action policy boundary did not require approval.");
        this.database.finishAutomationStep(currentStep, "completed", `${opportunityIds.length} prepared move${opportunityIds.length === 1 ? " is" : "s are"} waiting for founder review. Action Fabric verdict: approval required.`);
        this.database.finishAutomationRun(runId, "waiting-approval", `${opportunityIds.length} useful action${opportunityIds.length === 1 ? " is" : "s are"} prepared and waiting for human judgment.`, "", opportunityIds);
      } else {
        this.database.finishAutomationStep(currentStep, "skipped", "No new action reached the approval boundary.");
        this.database.finishAutomationRun(runId, "completed", "The loop completed without manufacturing new work.");
      }
      return this.database.getAutomationRun(runId);
    } catch (error) {
      const failure = safeHarnessFailure(error, "The automation loop");
      if (currentStep) this.database.finishAutomationStep(currentStep, "failed", failure.message);
      this.database.finishAutomationRun(runId, "failed", "The automation loop stopped safely before any public action.", failure.message);
      return this.database.getAutomationRun(runId);
    }
  }
}
