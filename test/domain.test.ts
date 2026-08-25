import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DistributionDatabase } from "../server/database.ts";
import { scoreOpportunity } from "../server/domain.ts";
import { GitHubConnectorService, parseGitHubRepository } from "../server/github-connector.ts";

test("opportunity scoring rewards relevance and usefulness while penalizing promotion risk", () => {
  const strong = scoreOpportunity({ relevance: 96, value: 94, freshness: 88, promotionRisk: 8 });
  const promotional = scoreOpportunity({ relevance: 96, value: 94, freshness: 88, promotionRisk: 90 });
  assert.ok(strong > promotional);
  assert.ok(strong <= 100 && strong >= 0);
});

test("GitHub repository parsing accepts canonical inputs and rejects untrusted hosts", () => {
  assert.equal(parseGitHubRepository("Vequan23/distribution-os").fullName, "Vequan23/distribution-os");
  assert.equal(parseGitHubRepository("https://github.com/Vequan23/distribution-os.git").sourceUrl, "https://github.com/Vequan23/distribution-os");
  assert.throws(() => parseGitHubRepository("https://example.com/Vequan23/distribution-os"), /github\.com/i);
  assert.throws(() => parseGitHubRepository("Vequan23/distribution-os/issues/1"), /owner\/repository/i);
});

test("read-only GitHub sync quarantines issues, filters pull requests, and deduplicates repeated syncs", async () => {
  const directory = mkdtempSync(join(tmpdir(), "distribution-os-github-"));
  const database = new DistributionDatabase(directory);
  const responses = [
    {
      full_name: "Vequan23/distribution-os",
      html_url: "https://github.com/Vequan23/distribution-os",
      private: false,
      has_issues: true,
    },
    [
      { id: 101, number: 12, title: "How do I know which channel is working?", body: "I need a way to connect outcomes to the original contribution.", html_url: "https://github.com/Vequan23/distribution-os/issues/12", state: "open", updated_at: "2026-08-25T10:00:00Z", user: { login: "founder" }, labels: [{ name: "question" }] },
      { id: 102, number: 13, title: "Implementation PR", body: "Not an audience signal.", html_url: "https://github.com/Vequan23/distribution-os/pull/13", state: "open", updated_at: "2026-08-25T10:01:00Z", pull_request: {} },
    ],
    [
      { id: 101, number: 12, title: "How do I know which channel is working?", body: "I need a way to connect outcomes to the original contribution.", html_url: "https://github.com/Vequan23/distribution-os/issues/12", state: "open", updated_at: "2026-08-25T10:00:00Z", user: { login: "founder" }, labels: [{ name: "question" }] },
    ],
  ];
  const fetcher = async (input: string | URL | Request) => {
    assert.match(String(input), /^https:\/\/api\.github\.com\/repos\/Vequan23\/distribution-os/i);
    return new Response(JSON.stringify(responses.shift()), { status: 200, headers: { "content-type": "application/json", "x-ratelimit-remaining": "57" } });
  };
  try {
    const productId = database.onboardProduct({
      name: "Distribution OS", description: "A governed distribution practice for technical founders.", stage: "early",
      audience: "Technical founders", objective: "Learn which contributions create qualified conversations", positioning: "Evidence before reach.", sources: [],
    }, [{ type: "text", label: "Founder brief", sourceUrl: "", summary: "Technical founders need distribution feedback loops.", excerpt: "Technical founders need distribution feedback loops.", classification: "intent", confidence: 52 }]);
    const service = new GitHubConnectorService(database, fetcher);
    const connected = await service.connect(productId, "Vequan23/distribution-os");
    assert.equal(connected.importedCount, 1);
    assert.equal(connected.inspectedCount, 1);
    let dashboard = database.getDashboard();
    assert.equal(dashboard.metrics.connectedSources, 1);
    assert.equal(dashboard.signalInbox.filter((signal) => signal.origin === "github").length, 1);
    assert.equal(dashboard.audienceSignals.length, 0);
    assert.equal(dashboard.connectors[0]?.rateLimitRemaining, 57);

    const repeated = await service.sync(connected.connector.id);
    assert.equal(repeated.importedCount, 0);
    dashboard = database.getDashboard();
    assert.equal(dashboard.signalInbox.filter((signal) => signal.origin === "github").length, 1);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("GitHub sync treats a repository with no issues as an up-to-date source", async () => {
  const directory = mkdtempSync(join(tmpdir(), "distribution-os-github-empty-"));
  const database = new DistributionDatabase(directory);
  const responses = [
    { full_name: "founder/quiet-repo", html_url: "https://github.com/founder/quiet-repo", private: false, has_issues: true },
    [],
  ];
  try {
    const productId = database.onboardProduct({ name: "Quiet Product", description: "A product with no repository issues yet.", stage: "prototype", audience: "Builders", objective: "Verify an empty sync", positioning: "Quiet by design.", sources: [] }, [{ type: "text", label: "Brief", sourceUrl: "", summary: "A bounded product brief.", excerpt: "A bounded product brief.", classification: "intent", confidence: 52 }]);
    const service = new GitHubConnectorService(database, async () => new Response(JSON.stringify(responses.shift()), { status: 200, headers: { "content-type": "application/json" } }));
    const result = await service.connect(productId, "founder/quiet-repo");
    assert.equal(result.inspectedCount, 0);
    assert.equal(result.importedCount, 0);
    assert.equal(result.connector.status, "connected");
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("local database starts honestly and persists an evidence-backed onboarding", () => {
  const directory = mkdtempSync(join(tmpdir(), "distribution-os-test-"));
  const database = new DistributionDatabase(directory);
  try {
    const initial = database.getDashboard();
    assert.equal(initial.storage.mode, "local");
    assert.equal(initial.products.length, 0);
    assert.equal(initial.metrics.readyMoves, 0);
    assert.equal(initial.metrics.newSignals, 0);
    assert.equal(initial.onboarding.required, true);

    database.onboardProduct({
      name: "Proof Product",
      description: "A product that makes distribution recommendations traceable to source evidence.",
      stage: "prototype",
      audience: "Technical founders",
      objective: "Find the first 20 active users",
      positioning: "Distribution decisions with visible proof.",
      sources: [],
    }, [{
      type: "text",
      label: "Founder brief",
      sourceUrl: "",
      summary: "Technical founders need distribution decisions that can be inspected and corrected.",
      excerpt: "Technical founders need distribution decisions that can be inspected and corrected.",
      classification: "intent",
      confidence: 52,
    }]);

    const onboarded = database.getDashboard();
    assert.equal(onboarded.products.length, 1);
    assert.equal(onboarded.onboarding.required, false);
    assert.equal(onboarded.metrics.readyMoves, 1);
    assert.equal(onboarded.metrics.analysisConfidence, 42);
    assert.ok(onboarded.opportunities.every((item) => item.evidence.length > 0));

    const first = onboarded.opportunities[0];
    database.decideOpportunity(first.id, "approve", `${first.draftCopy}\n\nEdited by the founder.`);
    const updated = database.getDashboard();
    const approved = updated.opportunities.find((item) => item.id === first.id);
    assert.equal(approved?.status, "approved");
    assert.match(approved?.draftCopy ?? "", /Edited by the founder/);
    assert.equal(updated.metrics.approvedMoves, 1);
    assert.match(updated.recentEvents[0]?.type ?? "", /opportunity\.approve/);

    database.updateChannelPolicy("linkedin", { mode: "draft", dailyLimit: 3 });
    const configuredChannel = database.getDashboard().channels.find((channel) => channel.id === "linkedin");
    assert.equal(configuredChannel?.mode, "draft");
    assert.equal(configuredChannel?.dailyLimit, 3);
    assert.throws(() => database.updateChannelPolicy("linkedin", { mode: "autopilot", dailyLimit: 101 }), /between 0 and 100/i);
    assert.throws(() => database.onboardProduct({
      name: "Bad stage", description: "Invalid stage test", stage: "growing" as never, audience: "Testers", objective: "Reject bad stages", positioning: "",
      sources: [],
    }, [{ type: "text", label: "Brief", sourceUrl: "", summary: "A valid source for an invalid product stage.", excerpt: "A valid source for an invalid product stage.", classification: "intent", confidence: 52 }]), /supported product stage/i);

    const productId = onboarded.products[0]?.id;
    assert.ok(productId);
    const captured = database.addSignalCandidates(productId, [{
      type: "text", label: "Founder question", sourceUrl: "", summary: "How do I distribute a technical product without spamming people?", excerpt: "How do I distribute a technical product without spamming people?", classification: "intent", confidence: 52,
    }]);
    assert.equal(captured.insertedCount, 1);
    let signalState = database.getDashboard();
    assert.equal(signalState.metrics.newSignals, 1);
    assert.equal(signalState.signalInbox[0]?.kind, "question");
    assert.equal(signalState.audienceSignals.length, 0);
    database.decideSignalCandidate(captured.signalIds[0], "accept");
    signalState = database.getDashboard();
    assert.equal(signalState.metrics.newSignals, 0);
    assert.equal(signalState.signalInbox[0]?.status, "accepted");
    assert.equal(signalState.audienceSignals.length, 1);
    database.decideSignalCandidate(captured.signalIds[0], "accept");
    assert.equal(database.getDashboard().audienceSignals.length, 1);
    assert.throws(() => database.decideSignalCandidate(captured.signalIds[0], "restore"), /cannot be moved back/i);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
