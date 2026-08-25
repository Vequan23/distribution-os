import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AIControlPlaneStore, inspectRuntime } from "../server/ai-control-plane.ts";

test("AI control plane persists a native model profile without storing a local-model credential", async () => {
  const directory = mkdtempSync(join(tmpdir(), "distribution-os-ai-"));
  const runner = async (command: string, args: string[]) => ({
    stdout: command === "claude" && args[0] === "auth" ? JSON.stringify({ loggedIn: true }) : `${command} 1.0.0`,
    stderr: "",
  });
  try {
    const store = new AIControlPlaneStore(directory, runner);
    const initial = await store.getPublicState();
    assert.equal(initial.execution.runtimeId, "native");
    assert.equal(initial.profiles.length, 0);
    assert.ok(initial.runtimes.every((runtime) => runtime.available));

    const configured = await store.saveModelProfile({
      provider: "ollama",
      model: "local-model",
      baseUrl: "http://127.0.0.1:11434",
      activate: true,
    });
    assert.equal(configured.profiles[0]?.readiness, "ready");
    assert.equal(configured.profiles[0]?.credentialSource, "none");
    assert.equal(configured.execution.modelProfileId, configured.profiles[0]?.id);

    const external = await store.activateRuntime("opencode");
    assert.equal(external.execution.runtimeId, "opencode");
    assert.equal(external.runtimes.find((runtime) => runtime.id === "opencode")?.ownsModelSelection, true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("runtime discovery distinguishes a missing executable from an available runtime", async () => {
  const missing = Object.assign(new Error("missing"), { code: "ENOENT" });
  const status = await inspectRuntime({
    id: "cursor",
    name: "Cursor Agent",
    command: "cursor-agent",
    ownsModelSelection: true,
    capabilities: ["Repository tools"],
  }, async () => Promise.reject(missing));
  assert.equal(status.available, false);
  assert.equal(status.availability, "missing");
  assert.match(status.detail, /not installed/i);
});
