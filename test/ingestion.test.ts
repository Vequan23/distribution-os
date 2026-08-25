import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ingestSources } from "../server/ingestion.ts";

test("onboarding distinguishes founder context from repository implementation evidence", async () => {
  const directory = mkdtempSync(join(tmpdir(), "distribution-os-source-"));
  try {
    writeFileSync(join(directory, "README.md"), "# Signal Engine\nA local tool that ranks distribution experiments from product evidence.");
    writeFileSync(join(directory, "package.json"), JSON.stringify({ name: "signal-engine", scripts: { test: "node --test" } }));
    const sources = await ingestSources([
      { type: "text", label: "Founder brief", value: "Technical founders need a calmer and more accountable way to practice distribution." },
      { type: "repository", label: "Working repository", value: directory },
    ]);

    assert.equal(sources[0]?.classification, "intent");
    assert.equal(sources[1]?.classification, "implementation");
    assert.match(sources[1]?.summary ?? "", /distribution experiments/i);
    assert.ok((sources[1]?.confidence ?? 0) > (sources[0]?.confidence ?? 0));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
