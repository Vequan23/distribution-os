import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DistributionDatabase } from "../server/database.ts";
import { scoreOpportunity } from "../server/domain.ts";

test("opportunity scoring rewards relevance and usefulness while penalizing promotion risk", () => {
  const strong = scoreOpportunity({ relevance: 96, value: 94, freshness: 88, promotionRisk: 8 });
  const promotional = scoreOpportunity({ relevance: 96, value: 94, freshness: 88, promotionRisk: 90 });
  assert.ok(strong > promotional);
  assert.ok(strong <= 100 && strong >= 0);
});

test("local database seeds evidence-backed moves and persists human decisions", () => {
  const directory = mkdtempSync(join(tmpdir(), "distribution-os-test-"));
  const database = new DistributionDatabase(directory);
  try {
    const initial = database.getDashboard();
    assert.equal(initial.storage.mode, "local");
    assert.equal(initial.products.length, 2);
    assert.equal(initial.metrics.readyMoves, 3);
    assert.ok(initial.opportunities.every((item) => item.evidence.length > 0));

    const first = initial.opportunities[0];
    database.decideOpportunity(first.id, "approve", `${first.draftCopy}\n\nEdited by the founder.`);
    const updated = database.getDashboard();
    const approved = updated.opportunities.find((item) => item.id === first.id);
    assert.equal(approved?.status, "approved");
    assert.match(approved?.draftCopy ?? "", /Edited by the founder/);
    assert.equal(updated.metrics.approvedMoves, 1);
    assert.match(updated.recentEvents[0]?.type ?? "", /opportunity\.approve/);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
