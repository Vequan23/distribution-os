const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function hostname(value: string): string {
  try { return new URL(`http://${value}`).hostname.toLowerCase(); } catch { return ""; }
}

export function isTrustedLocalRequest(input: { method?: string; host?: string; origin?: string; secFetchSite?: string }): boolean {
  if (!LOCAL_HOSTS.has(hostname(input.host || ""))) return false;
  const method = (input.method || "GET").toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;
  if ((input.secFetchSite || "").toLowerCase() === "cross-site") return false;
  if (!input.origin) return true;
  try {
    return LOCAL_HOSTS.has(new URL(input.origin).hostname.toLowerCase());
  } catch {
    return false;
  }
}
