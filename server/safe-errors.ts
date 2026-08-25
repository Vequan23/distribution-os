export type HarnessFailureKind = "authentication" | "timeout" | "invalid-output" | "unavailable" | "execution";

export interface SafeHarnessFailure {
  kind: HarnessFailureKind;
  message: string;
  diagnostic: string;
}

function schemaDiagnostic(error: unknown): string {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && !seen.has(current)) {
    seen.add(current);
    const record = current as { issues?: unknown; cause?: unknown; name?: unknown };
    if (Array.isArray(record.issues)) {
      const paths = record.issues.slice(0, 5).map((issue) => {
        const item = issue as { path?: unknown; code?: unknown };
        const path = Array.isArray(item.path) ? item.path.map(String).join(".") : "output";
        const code = typeof item.code === "string" ? item.code : "invalid";
        return `${path || "output"} (${code})`;
      });
      return `Schema validation failed at ${paths.join(", ")}.`;
    }
    current = record.cause;
  }
  const name = error instanceof Error ? error.name : "";
  if (name === "SyntaxError") return "The returned JSON was incomplete or malformed.";
  return "No private provider output was retained.";
}

export function safeHarnessFailure(error: unknown, engine = "The execution engine"): SafeHarnessFailure {
  const raw = error instanceof Error ? error.message : String(error || "");
  const lower = raw.toLowerCase();
  if (/unauthorized|forbidden|authentication|not authenticated|401|403|login/.test(lower)) {
    return { kind: "authentication", message: `${engine} could not authenticate. Review its credentials and try again.`, diagnostic: "The provider rejected the configured credential." };
  }
  if (/timed?\s*out|timeout|abort/.test(lower)) {
    return { kind: "timeout", message: `${engine} timed out before returning a complete result.`, diagnostic: "The bounded execution deadline was reached." };
  }
  if (/json|schema|parse|structured|source-cited|citation|no object|no output/.test(lower)) {
    return { kind: "invalid-output", message: `${engine} returned a result that did not satisfy the required evidence schema.`, diagnostic: schemaDiagnostic(error) };
  }
  if (/enoent|not found|could not be started|unavailable/.test(lower)) {
    return { kind: "unavailable", message: `${engine} is unavailable. Check its installation and configuration.`, diagnostic: "The configured executable could not be started." };
  }
  return { kind: "execution", message: `${engine} failed before producing a reviewable result.`, diagnostic: "No private provider output was retained." };
}
