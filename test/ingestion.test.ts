import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildProductBrief, ingestSources } from "../server/ingestion.ts";

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

test("repository folder bundles generate an editable, source-cited product brief", async () => {
  const repositoryBundle = Buffer.from(`
--- signal-garden/package.json ---
{"name":"signal-garden","description":"An evidence-backed distribution workspace built for independent technical founders."}
--- signal-garden/README.md ---
# Signal Garden
Signal Garden helps independent technical founders turn product evidence into measurable distribution experiments.
  `).toString("base64");

  const sources = await ingestSources([{
    type: "repository",
    label: "signal-garden",
    filename: "signal-garden-repository.txt",
    mimeType: "text/plain",
    contentBase64: repositoryBundle,
  }]);
  const brief = buildProductBrief(sources);

  assert.equal(sources[0]?.classification, "implementation");
  assert.equal(brief.name.value, "Signal Garden");
  assert.match(brief.description.value, /evidence-backed distribution/i);
  assert.match(brief.audience.value, /independent technical founders/i);
  assert.equal(brief.stage, "early");
  assert.ok(brief.name.sourceLabels.includes("signal-garden"));
});
