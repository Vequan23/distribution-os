import type { DashboardState } from "../server/domain.ts";

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
