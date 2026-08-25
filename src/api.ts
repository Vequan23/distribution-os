import type { AIControlPlane, DashboardState, ModelProviderId, OnboardProductInput, OnboardingSourceInput, ProductBriefDraft } from "../server/domain.ts";

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

export function refreshSignals(): Promise<DashboardState> {
  return request<DashboardState>("/api/refresh", { method: "POST", body: "{}" });
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
