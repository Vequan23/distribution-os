import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");

test("marketing preview has a bounded mobile composition", async () => {
  const app = await readFile(join(root, "marketing/src/MarketingApp.vue"), "utf8");
  const styles = await readFile(join(root, "marketing/src/marketing.css"), "utf8");

  assert.match(app, /class="mobile-run-summary"/);
  assert.match(styles, /-webkit-text-size-adjust:\s*100%/);
  assert.match(styles, /\.preview-body > osx-agent-run-status \{ display: none; \}/);
  assert.match(styles, /\.mobile-run-summary \{ display: grid;/);
});

test("marketing ecosystem uses the canonical portfolio URL", async () => {
  const app = await readFile(join(root, "marketing/src/MarketingApp.vue"), "utf8");
  assert.match(app, /href: "https:\/\/vqclark\.vercel\.app\/"/);
  assert.doesNotMatch(app, /vqclark\.vequanclark\.chatgpt\.site/);
});
