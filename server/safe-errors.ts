export type HarnessFailureKind = "authentication" | "timeout" | "invalid-output" | "unavailable" | "execution";

export interface SafeHarnessFailure {
  kind: HarnessFailureKind;
  message: string;
}

export function safeHarnessFailure(error: unknown, engine = "The execution engine"): SafeHarnessFailure {
  const raw = error instanceof Error ? error.message : String(error || "");
  const lower = raw.toLowerCase();
  if (/unauthorized|forbidden|authentication|not authenticated|401|403|login/.test(lower)) {
    return { kind: "authentication", message: `${engine} could not authenticate. Review its credentials and try again.` };
  }
  if (/timed?\s*out|timeout|abort/.test(lower)) {
    return { kind: "timeout", message: `${engine} timed out before returning a complete result.` };
  }
  if (/json|schema|parse|structured|source-cited|citation/.test(lower)) {
    return { kind: "invalid-output", message: `${engine} returned a result that did not satisfy the required evidence schema.` };
  }
  if (/enoent|not found|could not be started|unavailable/.test(lower)) {
    return { kind: "unavailable", message: `${engine} is unavailable. Check its installation and configuration.` };
  }
  return { kind: "execution", message: `${engine} failed before producing a reviewable result.` };
}
