import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildProductBrief, ingestSources, isPrivateAddress, resolvePublicAddress, safeRemoteUrl } from "../server/ingestion.ts";

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

test("repository evidence prioritizes product documentation over governance files", async () => {
  const directory = mkdtempSync(join(tmpdir(), "distribution-os-evidence-order-"));
  try {
    writeFileSync(join(directory, "CODE_OF_CONDUCT.md"), "# Community rules\nBe respectful and report unacceptable behavior.");
    writeFileSync(join(directory, "README.md"), "# Aperta\nAperta helps developers verify and understand AI-generated code through local evidence and ownership sessions.");
    const [source] = await ingestSources([{ type: "repository", label: "Aperta repository", value: directory }]);
    assert.match(source?.summary ?? "", /verify and understand AI-generated code/i);
    assert.doesNotMatch(source?.summary ?? "", /unacceptable behavior/i);
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

test("pasted context infers a named product instead of using the generic source label", async () => {
  const sources = await ingestSources([{
    type: "text",
    label: "Paste context",
    value: "Signal Garden helps independent technical founders turn product evidence into a calm distribution practice.",
  }]);
  const brief = buildProductBrief(sources);
  assert.equal(brief.name.value, "Signal Garden");
  assert.equal(brief.name.needsReview, false);
});

test("web imports reject direct and DNS-resolved private network targets", async () => {
  assert.throws(() => safeRemoteUrl("http://127.0.0.1:4190/api/health"), /private-network/i);
  assert.equal(isPrivateAddress("8.8.8.8"), false);
  assert.equal(isPrivateAddress("::ffff:8.8.8.8"), false);
  assert.equal(isPrivateAddress("::ffff:7f00:1"), true);
  assert.equal(isPrivateAddress("fc00::1"), true);
  assert.deepEqual(
    await resolvePublicAddress("github.com", async () => [{ address: "140.82.113.4", family: 4 }]),
    { address: "140.82.113.4", family: 4 },
  );
  await assert.rejects(
    resolvePublicAddress("public-looking.example", async () => [{ address: "127.0.0.1", family: 4 }]),
    /private-network/i,
  );
  await assert.rejects(
    resolvePublicAddress("mixed.example", async () => [{ address: "203.0.113.10", family: 4 }, { address: "10.0.0.2", family: 4 }]),
    /private-network/i,
  );
});
