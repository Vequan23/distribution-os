import type { AIControlPlane, AutomationPlaybook, AutomationRun, ChannelMode, ContributionDraftResult, DashboardState, DistributionPlan, ModelProviderId, OnboardProductInput, OnboardingSourceInput, PlanApplication, ProductBriefDraft, SourceConnector } from "../server/domain.ts";
import type { ActionAdapterDescriptor, ActionCapability, ActionDecision, ActionExecutionRecord, ActionTransport } from "../packages/action-fabric/src/index.ts";

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...options?.headers,
    },
  });
  const value = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(value.error || `Request failed with ${response.status}`);
  return value;
}

export function loadDashboard(): Promise<DashboardState> {
  return request<DashboardState>("/api/dashboard");
}

export function refreshWorkspace(): Promise<DashboardState> {
  return request<DashboardState>("/api/refresh", { method: "POST", body: "{}" });
}

export function setAutomationPaused(paused: boolean): Promise<{ dashboard: DashboardState }> {
  return request<{ dashboard: DashboardState }>("/api/automation/control", { method: "POST", body: JSON.stringify({ paused }) });
}

export function createAutomationPlaybook(input: { productId: string; name?: string; intervalMinutes: number; maxActionsPerRun: number }): Promise<{ playbook: AutomationPlaybook; dashboard: DashboardState }> {
  return request<{ playbook: AutomationPlaybook; dashboard: DashboardState }>("/api/automation/playbooks", { method: "POST", body: JSON.stringify(input) });
}

export function updateAutomationPlaybook(id: string, input: { enabled: boolean; intervalMinutes: number; maxActionsPerRun: number }): Promise<{ playbook: AutomationPlaybook; dashboard: DashboardState }> {
  return request<{ playbook: AutomationPlaybook; dashboard: DashboardState }>(`/api/automation/playbooks/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(input) });
}

export function runAutomationPlaybook(id: string): Promise<{ run: AutomationRun; dashboard: DashboardState }> {
  return request<{ run: AutomationRun; dashboard: DashboardState }>(`/api/automation/playbooks/${encodeURIComponent(id)}/run`, { method: "POST", body: "{}" });
}

export function createActionAdapter(input: {
  name: string;
  transport: Exclude<ActionTransport, "direct-api">;
  capabilities: ActionCapability[];
  endpoint?: string;
  command?: string;
  gateway?: string;
  connectionRef?: string;
  credentialEnv?: string;
}): Promise<{ adapter: ActionAdapterDescriptor; dashboard: DashboardState }> {
  return request<{ adapter: ActionAdapterDescriptor; dashboard: DashboardState }>("/api/action-fabric/adapters", { method: "POST", body: JSON.stringify(input) });
}

export function setActionAdapterEnabled(id: string, enabled: boolean): Promise<{ adapter: ActionAdapterDescriptor; dashboard: DashboardState }> {
  return request<{ adapter: ActionAdapterDescriptor; dashboard: DashboardState }>(`/api/action-fabric/adapters/${encodeURIComponent(id)}/state`, { method: "POST", body: JSON.stringify({ enabled }) });
}

export function probeActionAdapter(id: string): Promise<{ adapter: ActionAdapterDescriptor; dashboard: DashboardState }> {
  return request<{ adapter: ActionAdapterDescriptor; dashboard: DashboardState }>(`/api/action-fabric/adapters/${encodeURIComponent(id)}/probe`, { method: "POST", body: "{}" });
}

export function requestActionExecution(input: {
  adapterId: string;
  capability: ActionCapability;
  toolName: string;
  purpose: string;
  evidenceRefs: string[];
  arguments: Record<string, unknown>;
  idempotencyKey: string;
  dryRun?: boolean;
}): Promise<{ record: ActionExecutionRecord; dashboard: DashboardState }> {
  return request<{ record: ActionExecutionRecord; dashboard: DashboardState }>("/api/action-fabric/actions", { method: "POST", body: JSON.stringify(input) });
}

export function approveActionExecution(id: string): Promise<{ record: ActionExecutionRecord; dashboard: DashboardState }> {
  return request<{ record: ActionExecutionRecord; dashboard: DashboardState }>(`/api/action-fabric/actions/${encodeURIComponent(id)}/approve`, { method: "POST", body: "{}" });
}

export function previewActionPolicy(input: {
  adapterId: string;
  capability: ActionCapability;
  productId?: string;
  evidenceRefs?: string[];
  purpose?: string;
  dryRun?: boolean;
  budgetUsed?: number;
  budgetLimit?: number;
}): Promise<ActionDecision> {
  return request<ActionDecision>("/api/action-fabric/evaluate", { method: "POST", body: JSON.stringify(input) });
}

export function loadAIControlPlane(): Promise<AIControlPlane> {
  return request<AIControlPlane>("/api/ai/control-plane");
}

export function discoverAIRuntimes(): Promise<AIControlPlane> {
  return request<AIControlPlane>("/api/ai/discover", { method: "POST", body: "{}" });
}

export function saveModelProfile(input: {
  name?: string;
  provider: ModelProviderId;
  model: string;
  baseUrl: string;
  apiKey?: string;
  activate?: boolean;
}): Promise<AIControlPlane> {
  return request<AIControlPlane>("/api/ai/profiles", { method: "POST", body: JSON.stringify(input) });
}

export function activateModelProfile(id: string): Promise<AIControlPlane> {
  return request<AIControlPlane>(`/api/ai/profiles/${encodeURIComponent(id)}/activate`, { method: "POST", body: "{}" });
}

export function testModelProfile(id: string): Promise<{ ok: boolean; provider: string; model: string; durationMs: number }> {
  return request<{ ok: boolean; provider: string; model: string; durationMs: number }>(`/api/ai/profiles/${encodeURIComponent(id)}/test`, { method: "POST", body: "{}" });
}

export function activateAgentRuntime(runtimeId: string, model = ""): Promise<AIControlPlane> {
  return request<AIControlPlane>("/api/ai/runtime", { method: "POST", body: JSON.stringify({ runtimeId, model }) });
}

export function onboardProduct(input: OnboardProductInput): Promise<{ productId: string; dashboard: DashboardState }> {
  return request<{ productId: string; dashboard: DashboardState }>("/api/products/onboard", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function analyzeProduct(sources: OnboardingSourceInput[]): Promise<{ brief: ProductBriefDraft }> {
  return request<{ brief: ProductBriefDraft }>("/api/products/analyze", {
    method: "POST",
    body: JSON.stringify({ sources }),
  });
}

export function generateProductPlan(productId: string): Promise<{ plan: DistributionPlan; application: PlanApplication; dashboard: DashboardState }> {
  return request<{ plan: DistributionPlan; application: PlanApplication; dashboard: DashboardState }>(`/api/products/${encodeURIComponent(productId)}/plan`, {
    method: "POST",
    body: "{}",
  });
}

export function updateChannelPolicy(id: string, input: { mode: ChannelMode; dailyLimit: number }): Promise<DashboardState> {
  return request<DashboardState>(`/api/channels/${encodeURIComponent(id)}/policy`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function addProductAudienceSignals(productId: string, sources: OnboardingSourceInput[]): Promise<{ count: number; dashboard: DashboardState }> {
  return request<{ count: number; dashboard: DashboardState }>(`/api/products/${encodeURIComponent(productId)}/signals`, {
    method: "POST",
    body: JSON.stringify({ sources }),
  });
}

export function captureProductSignals(productId: string, sources: OnboardingSourceInput[]): Promise<{ insertedCount: number; signalIds: string[]; dashboard: DashboardState }> {
  return request<{ insertedCount: number; signalIds: string[]; dashboard: DashboardState }>(`/api/products/${encodeURIComponent(productId)}/signals/inbox`, {
    method: "POST",
    body: JSON.stringify({ sources }),
  });
}

export function decideSignal(id: string, action: "accept" | "dismiss" | "restore"): Promise<DashboardState> {
  return request<DashboardState>(`/api/signals/${encodeURIComponent(id)}/decision`, {
    method: "POST",
    body: JSON.stringify({ action }),
  });
}

export function connectGitHubSource(productId: string, repository: string): Promise<{ connector: SourceConnector; importedCount: number; inspectedCount: number; dashboard: DashboardState }> {
  return request<{ connector: SourceConnector; importedCount: number; inspectedCount: number; dashboard: DashboardState }>("/api/connectors/github", {
    method: "POST",
    body: JSON.stringify({ productId, repository }),
  });
}

export function syncSourceConnector(id: string): Promise<{ connector: SourceConnector; importedCount: number; inspectedCount: number; dashboard: DashboardState }> {
  return request<{ connector: SourceConnector; importedCount: number; inspectedCount: number; dashboard: DashboardState }>(`/api/connectors/${encodeURIComponent(id)}/sync`, {
    method: "POST",
    body: "{}",
  });
}

export function disconnectSourceConnector(id: string): Promise<DashboardState> {
  return request<DashboardState>(`/api/connectors/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function writeOpportunityDraft(id: string): Promise<{ result: ContributionDraftResult; dashboard: DashboardState }> {
  return request<{ result: ContributionDraftResult; dashboard: DashboardState }>(`/api/opportunities/${encodeURIComponent(id)}/draft`, {
    method: "POST",
    body: "{}",
  });
}

export function decideOpportunity(
  id: string,
  action: "approve" | "skip" | "restore",
  draftCopy?: string,
): Promise<DashboardState> {
  return request<DashboardState>(`/api/opportunities/${encodeURIComponent(id)}/decision`, {
    method: "POST",
    body: JSON.stringify({ action, draftCopy }),
  });
}

export function recordOpportunityOutcome(id: string, input: { metric: string; value: number; note: string }): Promise<DashboardState> {
  return request<DashboardState>(`/api/opportunities/${encodeURIComponent(id)}/outcomes`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}
