import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  isProductStage,
  scoreOpportunity,
  type AudienceSignal,
  type AutomationPlaybook,
  type AutomationRun,
  type AutomationRunStatus,
  type AutomationState,
  type AutomationStepStatus,
  type AutomationTriggerKind,
  type Channel,
  type ChannelMode,
  type ChannelPolicyInput,
  type DashboardState,
  type DistributionEvent,
  type DistributionPlan,
  type Evidence,
  type HarnessRun,
  type HarnessRunKind,
  type HarnessRunStatus,
  type HarnessStepStatus,
  type IngestedSource,
  type OnboardProductInput,
  type Opportunity,
  type OpportunityStatus,
  type PlanApplication,
  type Product,
  type SignalCandidate,
  type SignalKind,
  type SignalOrigin,
  type SourceConnector,
} from "./domain.ts";
import {
  ACTION_CAPABILITIES,
  ACTION_FABRIC_ETHOS,
  ACTION_TRANSPORT_CATALOG,
  ACTION_TRANSPORTS,
  type ActionAdapterDescriptor,
  type ActionCapability,
  type ActionDecision,
  type ActionExecutionRecord,
  type ActionExecutionStatus,
  type ActionRisk,
  type ActionToolDescriptor,
  type ActionTransport,
} from "../packages/action-fabric/src/index.ts";

type Row = Record<string, string | number | null>;

function now(): string {
  return new Date().toISOString();
}

function stableJson(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === "object") return Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, normalize(child)]));
    return item;
  };
  return JSON.stringify(normalize(value));
}

function normalizedIdentityUrl(value: string | undefined): string {
  return (value || "").trim().toLowerCase().replace(/\.git$/i, "").replace(/\/+$/, "");
}

function cleanSentence(value: string): string {
  return value.trim().replace(/[.!?]+$/g, "");
}

function inferSignalKind(text: string): SignalKind {
  const value = text.toLowerCase();
  if (text.includes("?")) return "question";
  if (/\b(problem|pain|hard|difficult|frustrat|struggl|broken|issue|cannot|can't)\b/.test(value)) return "pain";
  if (/\b(need|wish|want|request|looking for|would like)\b/.test(value)) return "request";
  if (/\b(mention|recommend|using|tried|saw)\b/.test(value)) return "mention";
  return "unknown";
}

function signalRelevance(product: Product, source: IngestedSource, kind: SignalKind): number {
  const ignored = new Set(["about", "after", "again", "also", "been", "being", "from", "have", "into", "more", "that", "their", "there", "these", "they", "this", "with", "would"]);
  const terms = (value: string) => new Set(
    value.toLowerCase().match(/[a-z0-9]{4,}/g)?.filter((word) => !ignored.has(word)) || [],
  );
  const productTerms = terms([product.name, product.description, product.audience, product.objective, product.positioning].join(" "));
  const signalTerms = terms(`${source.label} ${source.summary} ${source.excerpt}`);
  const overlap = [...signalTerms].filter((term) => productTerms.has(term)).length;
  const sourceTrust = source.type === "url" ? 8 : 3;
  const actionable = kind === "question" || kind === "pain" || kind === "request" ? 10 : 2;
  return Math.max(25, Math.min(95, 30 + overlap * 7 + sourceTrust + actionable));
}

export class DistributionDatabase {
  readonly dataDirectory: string;
  readonly databasePath: string;
  private readonly database: DatabaseSync;

  constructor(dataDirectory = process.env.DISTRIBUTION_OS_DATA_DIR?.trim() || join(homedir(), ".distribution-os")) {
    this.dataDirectory = resolve(dataDirectory);
    mkdirSync(this.dataDirectory, { recursive: true, mode: 0o700 });
    this.databasePath = join(this.dataDirectory, "distribution-os.sqlite");
    this.database = new DatabaseSync(this.databasePath);
    this.database.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.migrate();
    this.seedChannels();
    this.markLegacyDemoData();
    this.recoverInterruptedAutomationRuns();
    this.recoverInterruptedActionExecutions();
  }

  close(): void {
    this.database.close();
  }

  private migrate(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        stage TEXT NOT NULL,
        repository_url TEXT NOT NULL DEFAULT '',
        website_url TEXT NOT NULL DEFAULT '',
        audience TEXT NOT NULL DEFAULT '',
        objective TEXT NOT NULL DEFAULT '',
        positioning TEXT NOT NULL DEFAULT '',
        confidence INTEGER NOT NULL DEFAULT 0,
        onboarding_status TEXT NOT NULL DEFAULT 'draft',
        is_demo INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS evidence (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        source_url TEXT NOT NULL DEFAULT '',
        occurred_at TEXT NOT NULL,
        source_type TEXT NOT NULL DEFAULT 'text',
        classification TEXT NOT NULL DEFAULT 'intent',
        confidence INTEGER NOT NULL DEFAULT 0,
        payload_json TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS channels (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        handle TEXT NOT NULL DEFAULT '',
        mode TEXT NOT NULL CHECK(mode IN ('draft', 'approval', 'autopilot')),
        status TEXT NOT NULL CHECK(status IN ('connected', 'manual', 'planned')),
        daily_limit INTEGER NOT NULL DEFAULT 1,
        connected INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS opportunities (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        context TEXT NOT NULL,
        why_now TEXT NOT NULL,
        suggested_angle TEXT NOT NULL,
        audience TEXT NOT NULL,
        source_url TEXT NOT NULL DEFAULT '',
        draft_copy TEXT NOT NULL,
        relevance_score INTEGER NOT NULL,
        value_score INTEGER NOT NULL,
        freshness_score INTEGER NOT NULL,
        promotion_risk INTEGER NOT NULL,
        score INTEGER NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('ready', 'approved', 'skipped', 'published')),
        discovered_at TEXT NOT NULL,
        scheduled_for TEXT,
        evidence_ids_json TEXT NOT NULL DEFAULT '[]'
      );

      CREATE TABLE IF NOT EXISTS outcomes (
        id TEXT PRIMARY KEY,
        opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
        metric TEXT NOT NULL,
        value REAL NOT NULL,
        captured_at TEXT NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS signal_candidates (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        kind TEXT NOT NULL DEFAULT 'unknown',
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        excerpt TEXT NOT NULL,
        source_url TEXT NOT NULL DEFAULT '',
        source_type TEXT NOT NULL CHECK(source_type IN ('text', 'url')),
        confidence INTEGER NOT NULL DEFAULT 0,
        relevance INTEGER NOT NULL DEFAULT 0,
        reason TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL CHECK(status IN ('new', 'accepted', 'dismissed')),
        evidence_id TEXT REFERENCES evidence(id) ON DELETE SET NULL,
        captured_at TEXT NOT NULL,
        decided_at TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS source_connectors (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK(kind IN ('github')),
        name TEXT NOT NULL,
        external_id TEXT NOT NULL,
        source_url TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('connected', 'error')),
        last_synced_at TEXT NOT NULL DEFAULT '',
        last_error TEXT NOT NULL DEFAULT '',
        imported_count INTEGER NOT NULL DEFAULT 0,
        rate_limit_remaining INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(product_id, kind, external_id)
      );

      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        detail TEXT NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}',
        occurred_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS harness_runs (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        product_id TEXT NOT NULL DEFAULT '',
        runtime_id TEXT NOT NULL,
        provider TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        error TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        completed_at TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS harness_steps (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES harness_runs(id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL,
        name TEXT NOT NULL,
        status TEXT NOT NULL,
        detail TEXT NOT NULL DEFAULT '',
        started_at TEXT NOT NULL,
        completed_at TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS automation_control (
        id TEXT PRIMARY KEY CHECK(id = 'global'),
        paused INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS automation_playbooks (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        interval_minutes INTEGER NOT NULL,
        max_actions_per_run INTEGER NOT NULL DEFAULT 1,
        require_approval INTEGER NOT NULL DEFAULT 1,
        last_run_at TEXT NOT NULL DEFAULT '',
        next_run_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS automation_runs (
        id TEXT PRIMARY KEY,
        playbook_id TEXT NOT NULL REFERENCES automation_playbooks(id) ON DELETE CASCADE,
        product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        trigger_kind TEXT NOT NULL CHECK(trigger_kind IN ('manual', 'schedule')),
        status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'waiting-approval', 'completed', 'failed', 'cancelled')),
        idempotency_key TEXT NOT NULL UNIQUE,
        summary TEXT NOT NULL DEFAULT '',
        error TEXT NOT NULL DEFAULT '',
        created_opportunity_ids_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        completed_at TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS automation_steps (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES automation_runs(id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL,
        name TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'completed', 'failed', 'skipped')),
        detail TEXT NOT NULL DEFAULT '',
        started_at TEXT NOT NULL,
        completed_at TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS action_adapters (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        transport TEXT NOT NULL CHECK(transport IN ('mcp', 'cli', 'managed-gateway', 'manual')),
        capabilities_json TEXT NOT NULL,
        risk TEXT NOT NULL CHECK(risk IN ('read-only', 'private-write', 'identity-bearing', 'irreversible')),
        approval TEXT NOT NULL CHECK(approval IN ('none', 'first-use', 'every-time')),
        state TEXT NOT NULL CHECK(state IN ('available', 'setup-required', 'disabled')),
        public_side_effect INTEGER NOT NULL DEFAULT 0,
        config_json TEXT NOT NULL DEFAULT '{}',
        config_summary TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS action_executions (
        id TEXT PRIMARY KEY,
        adapter_id TEXT NOT NULL,
        capability TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('approval-required', 'running', 'completed', 'failed', 'blocked', 'cancelled')),
        purpose TEXT NOT NULL,
        evidence_refs_json TEXT NOT NULL DEFAULT '[]',
        arguments_json TEXT NOT NULL DEFAULT '{}',
        argument_keys_json TEXT NOT NULL DEFAULT '[]',
        decision_json TEXT NOT NULL DEFAULT '{}',
        summary TEXT NOT NULL DEFAULT '',
        error TEXT NOT NULL DEFAULT '',
        external_id TEXT NOT NULL DEFAULT '',
        external_url TEXT NOT NULL DEFAULT '',
        idempotency_key TEXT NOT NULL UNIQUE,
        dry_run INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        approved_at TEXT NOT NULL DEFAULT '',
        completed_at TEXT NOT NULL DEFAULT ''
      );

      CREATE INDEX IF NOT EXISTS opportunities_status_score_idx
        ON opportunities(status, score DESC, discovered_at DESC);
      CREATE INDEX IF NOT EXISTS evidence_product_idx
        ON evidence(product_id, occurred_at DESC);
      CREATE INDEX IF NOT EXISTS events_recent_idx
        ON events(occurred_at DESC);
      CREATE INDEX IF NOT EXISTS harness_runs_recent_idx
        ON harness_runs(created_at DESC);
      CREATE INDEX IF NOT EXISTS harness_steps_run_idx
        ON harness_steps(run_id, sequence);
      CREATE INDEX IF NOT EXISTS signal_candidates_status_idx
        ON signal_candidates(status, captured_at DESC);
      CREATE INDEX IF NOT EXISTS source_connectors_product_idx
        ON source_connectors(product_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS automation_playbooks_due_idx
        ON automation_playbooks(enabled, next_run_at);
      CREATE INDEX IF NOT EXISTS automation_runs_recent_idx
        ON automation_runs(created_at DESC);
      CREATE INDEX IF NOT EXISTS automation_steps_run_idx
        ON automation_steps(run_id, sequence);
      CREATE INDEX IF NOT EXISTS action_adapters_transport_idx
        ON action_adapters(transport, updated_at DESC);
      CREATE INDEX IF NOT EXISTS action_executions_recent_idx
        ON action_executions(created_at DESC);
    `);

    this.database.prepare("INSERT OR IGNORE INTO automation_control (id, paused, updated_at) VALUES ('global', 0, ?)").run(now());

    this.addColumn("products", "audience", "TEXT NOT NULL DEFAULT ''");
    this.addColumn("products", "objective", "TEXT NOT NULL DEFAULT ''");
    this.addColumn("products", "positioning", "TEXT NOT NULL DEFAULT ''");
    this.addColumn("products", "confidence", "INTEGER NOT NULL DEFAULT 0");
    this.addColumn("products", "onboarding_status", "TEXT NOT NULL DEFAULT 'draft'");
    this.addColumn("products", "is_demo", "INTEGER NOT NULL DEFAULT 0");
    this.addColumn("evidence", "source_type", "TEXT NOT NULL DEFAULT 'text'");
    this.addColumn("evidence", "classification", "TEXT NOT NULL DEFAULT 'intent'");
    this.addColumn("evidence", "confidence", "INTEGER NOT NULL DEFAULT 0");
    this.addColumn("signal_candidates", "origin", "TEXT NOT NULL DEFAULT 'manual'");
    this.addColumn("signal_candidates", "external_id", "TEXT NOT NULL DEFAULT ''");
    this.addColumn("action_adapters", "credential_env", "TEXT NOT NULL DEFAULT ''");
    this.addColumn("action_adapters", "last_checked_at", "TEXT NOT NULL DEFAULT ''");
    this.addColumn("action_adapters", "last_error", "TEXT NOT NULL DEFAULT ''");
    this.addColumn("action_adapters", "discovered_tools_json", "TEXT NOT NULL DEFAULT '[]'");
    this.addColumn("action_executions", "approved_at", "TEXT NOT NULL DEFAULT ''");
    this.addColumn("action_executions", "dry_run", "INTEGER NOT NULL DEFAULT 0");
  }

  private addColumn(table: string, column: string, definition: string): void {
    const columns = this.database.prepare(`PRAGMA table_info(${table})`).all() as Row[];
    if (!columns.some((row) => String(row.name) === column)) {
      this.database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  private seedChannels(): void {
    const count = this.database.prepare("SELECT COUNT(*) AS count FROM channels").get() as Row;
    if (Number(count.count) > 0) return;
    const createdAt = now();
    const insertChannel = this.database.prepare(`
      INSERT INTO channels (id, name, handle, mode, status, daily_limit, connected, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertChannel.run("linkedin", "LinkedIn", "Personal profile", "approval", "manual", 1, 0, createdAt);
    insertChannel.run("bluesky", "Bluesky", "Not connected", "approval", "planned", 2, 0, createdAt);
    insertChannel.run("x", "X", "Not connected", "approval", "planned", 2, 0, createdAt);
    insertChannel.run("devto", "Dev.to", "Draft export", "draft", "manual", 1, 0, createdAt);
  }

  private markLegacyDemoData(): void {
    this.database.prepare("UPDATE products SET is_demo = 1 WHERE id IN ('osx-components', 'aperta') AND audience = ''").run();
  }

  private recoverInterruptedAutomationRuns(): void {
    const rows = this.database.prepare("SELECT id, playbook_id FROM automation_runs WHERE status IN ('queued', 'running')").all() as Row[];
    if (!rows.length) return;
    const recoveredAt = now();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      for (const row of rows) {
        this.database.prepare(`
          UPDATE automation_runs
          SET status = 'failed', summary = ?, error = ?, completed_at = ? WHERE id = ?
        `).run("The prior local service stopped before this automation cycle completed.", "The interrupted cycle was closed safely and will be eligible to run again. No public action was taken.", recoveredAt, row.id);
        this.database.prepare("UPDATE automation_playbooks SET next_run_at = ?, updated_at = ? WHERE id = ?").run(recoveredAt, recoveredAt, row.playbook_id);
        this.recordEvent("automation.run.recovered", "automation-run", String(row.id), "An interrupted automation cycle was closed safely and returned to the schedule.");
      }
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  private recoverInterruptedActionExecutions(): void {
    const rows = this.database.prepare("SELECT id FROM action_executions WHERE status = 'running'").all() as Row[];
    if (!rows.length) return;
    const recoveredAt = now();
    for (const row of rows) {
      this.database.prepare("UPDATE action_executions SET status = 'failed', summary = ?, error = ?, completed_at = ? WHERE id = ?")
        .run("The prior local service stopped before the connection returned a confirmed result.", "The interrupted action was closed as failed. Its idempotency key will not be executed again automatically.", recoveredAt, row.id);
      this.recordEvent("action-fabric.execution.recovered", "action-execution", String(row.id), "An interrupted connection action was closed as failed without claiming external success.");
    }
  }

  private matchingProduct(input: OnboardProductInput, sources: IngestedSource[] = []): Row | undefined {
    const candidates = this.database.prepare(`
      SELECT * FROM products WHERE is_demo = 0 AND lower(trim(name)) = ? ORDER BY created_at DESC
    `).all(input.name.trim().toLowerCase()) as Row[];
    const suppliedIdentities = new Set(
      [input.repositoryUrl, input.websiteUrl, ...sources.map((source) => source.sourceUrl)]
        .map(normalizedIdentityUrl)
        .filter(Boolean),
    );
    for (const row of candidates) {
      const evidenceRows = this.database.prepare("SELECT source_url FROM evidence WHERE product_id = ? AND source_url <> ''").all(row.id) as Row[];
      const existingIdentities = new Set(
        [String(row.repository_url || ""), String(row.website_url || ""), ...evidenceRows.map((evidence) => String(evidence.source_url || ""))]
          .map(normalizedIdentityUrl)
          .filter(Boolean),
      );
      if ([...suppliedIdentities].some((identity) => existingIdentities.has(identity))) return row;
    }
    const compatible = candidates.filter((row) => {
      const repository = normalizedIdentityUrl(input.repositoryUrl);
      const website = normalizedIdentityUrl(input.websiteUrl);
      const existingRepository = normalizedIdentityUrl(String(row.repository_url || ""));
      const existingWebsite = normalizedIdentityUrl(String(row.website_url || ""));
      if (repository && existingRepository && repository !== existingRepository) return false;
      if (website && existingWebsite && website !== existingWebsite) return false;
      return true;
    });
    return candidates.length === 1 && compatible.length === 1 ? compatible[0] : undefined;
  }

  findMatchingProductId(input: OnboardProductInput, sources: IngestedSource[] = []): string | null {
    const match = this.matchingProduct(input, sources);
    return match ? String(match.id) : null;
  }

  onboardProduct(input: OnboardProductInput, sources: IngestedSource[]): string {
    const name = input.name.trim();
    const description = input.description.trim();
    const audience = input.audience.trim();
    const objective = input.objective.trim();
    const positioning = input.positioning.trim();
    if (!name || !description || !audience || !objective) {
      throw new Error("Name, description, audience, and objective are required.");
    }
    if (!sources.length) throw new Error("At least one readable source is required.");
    if (!isProductStage(input.stage)) throw new Error("Choose a supported product stage.");

    const existing = this.matchingProduct(input, sources);
    const productId = existing ? String(existing.id) : randomUUID();
    const createdAt = now();
    const sourceTypes = new Set(sources.map((source) => source.type));
    const sourceWeight = { repository: 30, url: 22, document: 16, text: 10 };
    const evidenceCoverage = [...sourceTypes].reduce((total, type) => total + sourceWeight[type], 0);
    const profileCoverage = 24 + (positioning ? 8 : 0);
    const corroboration = sources.length >= 3 ? 12 : sources.length === 2 ? 7 : 0;
    const confidence = Math.min(96, profileCoverage + evidenceCoverage + corroboration);

    this.database.exec("BEGIN IMMEDIATE");
    try {
      if (existing) {
        this.database.prepare(`
          UPDATE products SET name = ?, description = ?, stage = ?, repository_url = ?, website_url = ?,
            audience = ?, objective = ?, positioning = ?, confidence = ?, onboarding_status = 'ready'
          WHERE id = ?
        `).run(
          name, description, input.stage,
          input.repositoryUrl?.trim() || String(existing.repository_url || ""),
          input.websiteUrl?.trim() || String(existing.website_url || ""),
          audience, objective, positioning, Math.max(confidence, Number(existing.confidence || 0)), productId,
        );
      } else this.database.prepare(`
        INSERT INTO products (
          id, name, description, stage, repository_url, website_url, audience, objective,
          positioning, confidence, onboarding_status, is_demo, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', 0, ?)
      `).run(
        productId,
        name,
        description,
        input.stage,
        input.repositoryUrl?.trim() || "",
        input.websiteUrl?.trim() || "",
        audience,
        objective,
        positioning,
        confidence,
        createdAt,
      );

      const evidenceIds: string[] = [];
      const insertEvidence = this.database.prepare(`
        INSERT INTO evidence (
          id, product_id, kind, title, summary, source_url, occurred_at,
          source_type, classification, confidence, payload_json
        ) VALUES (?, ?, 'onboarding-source', ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const findEvidence = this.database.prepare(`
        SELECT id FROM evidence WHERE product_id = ? AND lower(title) = lower(?) AND source_url = ? AND lower(summary) = lower(?) LIMIT 1
      `);
      for (const source of sources) {
        const prior = findEvidence.get(productId, source.label, source.sourceUrl, source.summary) as Row | undefined;
        if (prior) {
          evidenceIds.push(String(prior.id));
          continue;
        }
        const id = randomUUID();
        evidenceIds.push(id);
        insertEvidence.run(
          id,
          productId,
          source.label,
          source.summary,
          source.sourceUrl,
          createdAt,
          source.type,
          source.classification,
          source.confidence,
          JSON.stringify({ excerpt: source.excerpt }),
        );
      }

      const relevance = Math.max(55, confidence);
      const value = objective.toLowerCase().includes("user") || objective.toLowerCase().includes("revenue") ? 82 : 72;
      const freshness = 92;
      const promotionRisk = sourceTypes.has("repository") || sourceTypes.has("url") ? 16 : 30;
      const score = scoreOpportunity({ relevance, value, freshness, promotionRisk });
      const primarySource = sources.slice().sort((left, right) => right.confidence - left.confidence)[0];
      const draft = `${cleanSentence(description)}.\n\nI am testing this with ${cleanSentence(audience).toLowerCase()}. The immediate learning goal is to ${cleanSentence(objective).replace(/^to\s+/i, "")}.\n\nWhere does this problem become most expensive or frustrating in practice?`;
      const opportunityCount = Number((this.database.prepare("SELECT COUNT(*) AS count FROM opportunities WHERE product_id = ?").get(productId) as Row).count);
      if (opportunityCount === 0) this.database.prepare(`
        INSERT INTO opportunities (
          id, product_id, channel_id, type, title, context, why_now, suggested_angle, audience,
          source_url, draft_copy, relevance_score, value_score, freshness_score, promotion_risk,
          score, status, discovered_at, evidence_ids_json
        ) VALUES (?, ?, 'linkedin', 'owned-post', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?)
      `).run(
        randomUUID(),
        productId,
        `Clarify the problem ${name} is built to solve`,
        `${description} This first move is derived from ${sources.length} onboarding source${sources.length === 1 ? "" : "s"}, not an external audience signal.`,
        "The product profile has just been established and needs a founder-verified public narrative before channel discovery begins.",
        positioning || `Explain the problem, the affected audience, and the evidence behind ${name} without making unsupported claims.`,
        audience,
        primarySource.sourceUrl,
        draft,
        relevance,
        value,
        freshness,
        promotionRisk,
        score,
        createdAt,
        JSON.stringify(evidenceIds),
      );

      this.recordEvent(
        existing ? "product.updated" : "product.onboarded",
        "product",
        productId,
        `${name} ${existing ? "updated" : "onboarded"} from ${sources.length} source${sources.length === 1 ? "" : "s"} with ${confidence}% evidence confidence.`,
        { sourceTypes: [...sourceTypes], confidence },
      );
      this.database.exec("COMMIT");
      return productId;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  getProductContext(productId: string): { product: Product; evidence: Evidence[]; channels: Channel[] } {
    const row = this.database.prepare(`
      SELECT p.*, COUNT(e.id) AS evidence_count
      FROM products p LEFT JOIN evidence e ON e.product_id = p.id
      WHERE p.id = ? AND p.is_demo = 0 GROUP BY p.id
    `).get(productId) as Row | undefined;
    if (!row) throw new Error("Product not found");
    const product: Product = {
      id: String(row.id), name: String(row.name), description: String(row.description), stage: String(row.stage) as Product["stage"],
      repositoryUrl: String(row.repository_url), websiteUrl: String(row.website_url), evidenceCount: Number(row.evidence_count),
      audience: String(row.audience), objective: String(row.objective), positioning: String(row.positioning),
      confidence: Number(row.confidence), onboardingStatus: String(row.onboarding_status) as Product["onboardingStatus"],
    };
    const evidence = (this.database.prepare(`
      SELECT id, kind, title, summary, source_url, occurred_at, source_type, classification, confidence
      FROM evidence WHERE product_id = ? ORDER BY occurred_at DESC
    `).all(productId) as Row[]).map((item): Evidence => ({
      id: String(item.id), kind: String(item.kind), title: String(item.title), summary: String(item.summary),
      sourceUrl: String(item.source_url), occurredAt: String(item.occurred_at), sourceType: String(item.source_type) as Evidence["sourceType"],
      classification: String(item.classification) as Evidence["classification"], confidence: Number(item.confidence),
    }));
    const channels = (this.database.prepare("SELECT * FROM channels ORDER BY connected DESC, name").all() as Row[]).map((item): Channel => ({
      id: String(item.id), name: String(item.name), handle: String(item.handle), mode: String(item.mode) as Channel["mode"],
      status: String(item.status) as Channel["status"], dailyLimit: Number(item.daily_limit), connected: Boolean(item.connected),
    }));
    return { product, evidence, channels };
  }

  addAudienceSignals(productId: string, sources: IngestedSource[]): number {
    const context = this.getProductContext(productId);
    if (!sources.length) throw new Error("Add at least one audience signal.");
    const capturedAt = now();
    const insert = this.database.prepare(`
      INSERT INTO evidence (
        id, product_id, kind, title, summary, source_url, occurred_at,
        source_type, classification, confidence, payload_json
      ) VALUES (?, ?, 'audience-signal', ?, ?, ?, ?, ?, 'audience-signal', ?, ?)
    `);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      for (const source of sources.slice(0, 8)) {
        insert.run(
          randomUUID(), productId, source.label, source.summary, source.sourceUrl, capturedAt,
          source.type, source.type === "url" ? Math.max(60, source.confidence) : Math.min(55, source.confidence),
          JSON.stringify({ excerpt: source.excerpt }),
        );
      }
      this.recordEvent("audience.signal.added", "product", productId, `${sources.length} audience signal${sources.length === 1 ? "" : "s"} added to ${context.product.name}.`, { labels: sources.map((source) => source.label) });
      this.database.exec("COMMIT");
      return sources.length;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  addSignalCandidates(
    productId: string,
    sources: IngestedSource[],
    metadata: { origin?: SignalOrigin; externalIds?: string[] } = {},
  ): { insertedCount: number; signalIds: string[] } {
    const context = this.getProductContext(productId);
    if (!sources.length) throw new Error("Add at least one signal candidate.");
    const capturedAt = now();
    const insert = this.database.prepare(`
      INSERT INTO signal_candidates (
        id, product_id, kind, title, summary, excerpt, source_url, source_type,
        confidence, relevance, reason, status, captured_at, origin, external_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?)
    `);
    const duplicate = this.database.prepare(`
      SELECT id FROM signal_candidates
      WHERE product_id = ? AND lower(title) = lower(?) AND source_url = ? AND lower(summary) = lower(?)
      LIMIT 1
    `);
    const signalIds: string[] = [];
    this.database.exec("BEGIN IMMEDIATE");
    try {
      for (const [index, source] of sources.slice(0, 12).entries()) {
        if (source.type !== "text" && source.type !== "url") continue;
        const existing = duplicate.get(productId, source.label, source.sourceUrl, source.summary) as Row | undefined;
        if (existing) continue;
        const id = randomUUID();
        const content = `${source.summary}\n${source.excerpt}`;
        const kind = inferSignalKind(content);
        const relevance = signalRelevance(context.product, source, kind);
        const origin = metadata.origin ?? "manual";
        const reason = origin === "github"
          ? "Imported read-only from a GitHub issue. Inspect the source before promoting this observation into audience evidence."
          : source.type === "url"
          ? "Captured from a public URL. Review the excerpt before promoting it into audience evidence."
          : "Founder-supplied observation. Accept only if the context is specific enough to influence a distribution decision.";
        insert.run(
          id, productId, kind, source.label, source.summary, source.excerpt, source.sourceUrl,
          source.type, source.confidence, relevance, reason, capturedAt, origin, metadata.externalIds?.[index] || "",
        );
        signalIds.push(id);
      }
      this.recordEvent(
        "signal.candidates.captured",
        "product",
        productId,
        `${signalIds.length} signal candidate${signalIds.length === 1 ? "" : "s"} captured for ${context.product.name}.`,
        { signalIds },
      );
      this.database.exec("COMMIT");
      return { insertedCount: signalIds.length, signalIds };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  upsertSourceConnector(input: {
    productId: string;
    kind: "github";
    name: string;
    externalId: string;
    sourceUrl: string;
  }): SourceConnector {
    const product = this.getProductContext(input.productId).product;
    const timestamp = now();
    const existing = this.database.prepare(
      "SELECT id, created_at FROM source_connectors WHERE product_id = ? AND kind = ? AND external_id = ?",
    ).get(input.productId, input.kind, input.externalId) as Row | undefined;
    const id = existing ? String(existing.id) : randomUUID();
    this.database.prepare(`
      INSERT INTO source_connectors (
        id, product_id, kind, name, external_id, source_url, status,
        last_synced_at, last_error, imported_count, rate_limit_remaining, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'connected', '', '', 0, NULL, ?, ?)
      ON CONFLICT(product_id, kind, external_id) DO UPDATE SET
        name = excluded.name,
        source_url = excluded.source_url,
        status = 'connected',
        last_error = '',
        updated_at = excluded.updated_at
    `).run(id, input.productId, input.kind, input.name, input.externalId, input.sourceUrl, existing ? String(existing.created_at) : timestamp, timestamp);
    this.recordEvent("connector.connected", "connector", id, `${input.name} connected to ${product.name} as a read-only signal source.`, { kind: input.kind, externalId: input.externalId });
    return this.getSourceConnector(id);
  }

  getSourceConnector(id: string): SourceConnector {
    const row = this.database.prepare(`
      SELECT c.*, p.name AS product_name
      FROM source_connectors c JOIN products p ON p.id = c.product_id
      WHERE c.id = ? AND p.is_demo = 0
    `).get(id) as Row | undefined;
    if (!row) throw new Error("Source connector not found");
    return this.mapSourceConnector(row);
  }

  finishSourceSync(id: string, importedCount: number, rateLimitRemaining: number | null): SourceConnector {
    const timestamp = now();
    this.database.prepare(`
      UPDATE source_connectors
      SET status = 'connected', last_synced_at = ?, last_error = '', imported_count = imported_count + ?,
          rate_limit_remaining = ?, updated_at = ?
      WHERE id = ?
    `).run(timestamp, importedCount, rateLimitRemaining, timestamp, id);
    this.recordEvent("connector.synced", "connector", id, `${importedCount} new signal candidate${importedCount === 1 ? "" : "s"} imported for review.`, { importedCount });
    return this.getSourceConnector(id);
  }

  failSourceSync(id: string, message: string, rateLimitRemaining: number | null = null): SourceConnector {
    const safeMessage = message.trim().slice(0, 280) || "GitHub sync failed.";
    this.database.prepare(`
      UPDATE source_connectors
      SET status = 'error', last_error = ?, rate_limit_remaining = ?, updated_at = ?
      WHERE id = ?
    `).run(safeMessage, rateLimitRemaining, now(), id);
    return this.getSourceConnector(id);
  }

  disconnectSourceConnector(id: string): void {
    const connector = this.getSourceConnector(id);
    this.database.prepare("DELETE FROM source_connectors WHERE id = ?").run(id);
    this.recordEvent("connector.disconnected", "connector", id, `${connector.name} disconnected. Previously imported evidence and decisions were preserved.`, { kind: connector.kind });
  }

  private mapSourceConnector(row: Row): SourceConnector {
    return {
      id: String(row.id), productId: String(row.product_id), productName: String(row.product_name),
      kind: String(row.kind) as SourceConnector["kind"], name: String(row.name), externalId: String(row.external_id),
      sourceUrl: String(row.source_url), status: String(row.status) as SourceConnector["status"],
      lastSyncedAt: String(row.last_synced_at), lastError: String(row.last_error), importedCount: Number(row.imported_count),
      rateLimitRemaining: row.rate_limit_remaining === null ? null : Number(row.rate_limit_remaining), createdAt: String(row.created_at),
    };
  }

  decideSignalCandidate(id: string, action: "accept" | "dismiss" | "restore"): void {
    const row = this.database.prepare(`
      SELECT s.*, p.name AS product_name
      FROM signal_candidates s JOIN products p ON p.id = s.product_id
      WHERE s.id = ? AND p.is_demo = 0
    `).get(id) as Row | undefined;
    if (!row) throw new Error("Signal candidate not found");
    if (action !== "accept" && row.evidence_id) throw new Error("Accepted evidence cannot be moved back into the review inbox.");

    const decidedAt = now();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      if (action === "accept") {
        let evidenceId = String(row.evidence_id || "");
        if (!evidenceId) {
          evidenceId = randomUUID();
          this.database.prepare(`
            INSERT INTO evidence (
              id, product_id, kind, title, summary, source_url, occurred_at,
              source_type, classification, confidence, payload_json
            ) VALUES (?, ?, 'audience-signal', ?, ?, ?, ?, ?, 'audience-signal', ?, ?)
          `).run(
            evidenceId, row.product_id, row.title, row.summary, row.source_url, decidedAt,
            row.source_type, row.confidence,
            JSON.stringify({ excerpt: row.excerpt, signalCandidateId: id }),
          );
        }
        this.database.prepare("UPDATE signal_candidates SET status = 'accepted', evidence_id = ?, decided_at = ? WHERE id = ?")
          .run(evidenceId, decidedAt, id);
      } else {
        const status = action === "restore" ? "new" : "dismissed";
        this.database.prepare("UPDATE signal_candidates SET status = ?, decided_at = ? WHERE id = ?")
          .run(status, action === "restore" ? "" : decidedAt, id);
      }
      this.recordEvent(
        `signal.${action}`,
        "signal",
        id,
        `${String(row.title)} ${action === "accept" ? "accepted as audience evidence" : action === "dismiss" ? "dismissed" : "returned to the inbox"}.`,
        { productId: row.product_id, previousStatus: row.status },
      );
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  beginHarnessRun(input: { kind: HarnessRunKind; productId?: string; runtimeId: string; provider?: string; model?: string }): string {
    const id = randomUUID();
    this.database.prepare(`
      INSERT INTO harness_runs (id, kind, product_id, runtime_id, provider, model, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'running', ?)
    `).run(id, input.kind, input.productId || "", input.runtimeId, input.provider || "", input.model || "", now());
    return id;
  }

  beginHarnessStep(runId: string, sequence: number, name: string, detail = ""): string {
    const id = randomUUID();
    this.database.prepare(`
      INSERT INTO harness_steps (id, run_id, sequence, name, status, detail, started_at)
      VALUES (?, ?, ?, ?, 'running', ?, ?)
    `).run(id, runId, sequence, name, detail, now());
    return id;
  }

  finishHarnessStep(stepId: string, status: Exclude<HarnessStepStatus, "pending" | "running">, detail = ""): void {
    this.database.prepare("UPDATE harness_steps SET status = ?, detail = ?, completed_at = ? WHERE id = ?")
      .run(status, detail, now(), stepId);
  }

  finishHarnessRun(runId: string, status: Exclude<HarnessRunStatus, "running">, summary = "", error = ""): void {
    this.database.prepare("UPDATE harness_runs SET status = ?, summary = ?, error = ?, completed_at = ? WHERE id = ?")
      .run(status, summary, error, now(), runId);
  }

  getHarnessRun(runId: string): HarnessRun {
    const row = this.database.prepare("SELECT * FROM harness_runs WHERE id = ?").get(runId) as Row | undefined;
    if (!row) throw new Error("Harness run not found");
    const steps = (this.database.prepare("SELECT * FROM harness_steps WHERE run_id = ? ORDER BY sequence, started_at").all(runId) as Row[]).map((step) => ({
      id: String(step.id), runId: String(step.run_id), sequence: Number(step.sequence), name: String(step.name),
      status: String(step.status) as HarnessStepStatus, detail: String(step.detail), startedAt: String(step.started_at), completedAt: String(step.completed_at),
    }));
    return {
      id: String(row.id), kind: String(row.kind) as HarnessRunKind, productId: String(row.product_id),
      runtimeId: String(row.runtime_id) as HarnessRun["runtimeId"], provider: String(row.provider), model: String(row.model),
      status: String(row.status) as HarnessRunStatus, summary: String(row.summary), error: String(row.error),
      createdAt: String(row.created_at), completedAt: String(row.completed_at), steps,
    };
  }

  getRecentHarnessRuns(limit = 12): HarnessRun[] {
    const rows = this.database.prepare("SELECT id FROM harness_runs ORDER BY created_at DESC LIMIT ?").all(Math.max(1, Math.min(50, limit))) as Row[];
    return rows.map((row) => this.getHarnessRun(String(row.id)));
  }

  createAutomationPlaybook(input: { productId: string; name?: string; intervalMinutes: number; maxActionsPerRun: number }): AutomationPlaybook {
    const product = this.database.prepare("SELECT name FROM products WHERE id = ? AND is_demo = 0").get(input.productId) as Row | undefined;
    if (!product) throw new Error("Choose an onboarded product for this automation.");
    this.validateAutomationLimits(input.intervalMinutes, input.maxActionsPerRun);
    const id = randomUUID();
    const createdAt = now();
    const nextRunAt = new Date(Date.now() + input.intervalMinutes * 60_000).toISOString();
    const name = input.name?.trim().slice(0, 120) || `${String(product.name)} evidence loop`;
    this.database.prepare(`
      INSERT INTO automation_playbooks (
        id, product_id, name, enabled, interval_minutes, max_actions_per_run,
        require_approval, next_run_at, created_at, updated_at
      ) VALUES (?, ?, ?, 1, ?, ?, 1, ?, ?, ?)
    `).run(id, input.productId, name, input.intervalMinutes, input.maxActionsPerRun, nextRunAt, createdAt, createdAt);
    this.recordEvent("automation.playbook.created", "automation-playbook", id, `${name} created with a permanent human approval boundary.`, { productId: input.productId, intervalMinutes: input.intervalMinutes, maxActionsPerRun: input.maxActionsPerRun });
    return this.getAutomationPlaybook(id);
  }

  updateAutomationPlaybook(id: string, input: { enabled: boolean; intervalMinutes: number; maxActionsPerRun: number }): AutomationPlaybook {
    const row = this.database.prepare("SELECT id, name FROM automation_playbooks WHERE id = ?").get(id) as Row | undefined;
    if (!row) throw new Error("Automation playbook not found");
    this.validateAutomationLimits(input.intervalMinutes, input.maxActionsPerRun);
    const updatedAt = now();
    const nextRunAt = new Date(Date.now() + input.intervalMinutes * 60_000).toISOString();
    this.database.prepare(`
      UPDATE automation_playbooks
      SET enabled = ?, interval_minutes = ?, max_actions_per_run = ?, require_approval = 1,
          next_run_at = ?, updated_at = ?
      WHERE id = ?
    `).run(input.enabled ? 1 : 0, input.intervalMinutes, input.maxActionsPerRun, nextRunAt, updatedAt, id);
    this.recordEvent("automation.playbook.updated", "automation-playbook", id, `${String(row.name)} ${input.enabled ? "enabled" : "paused"}; public execution still requires approval.`, { intervalMinutes: input.intervalMinutes, maxActionsPerRun: input.maxActionsPerRun });
    return this.getAutomationPlaybook(id);
  }

  setAutomationPaused(paused: boolean): AutomationState {
    this.database.prepare("UPDATE automation_control SET paused = ?, updated_at = ? WHERE id = 'global'").run(paused ? 1 : 0, now());
    this.recordEvent(paused ? "automation.paused" : "automation.resumed", "automation-control", "global", paused ? "All automated sensing and preparation paused." : "Automated sensing and preparation resumed. Public actions still require approval.");
    return this.getAutomationState();
  }

  getAutomationPlaybook(id: string): AutomationPlaybook {
    const row = this.database.prepare(`
      SELECT a.*, p.name AS product_name FROM automation_playbooks a
      JOIN products p ON p.id = a.product_id WHERE a.id = ? AND p.is_demo = 0
    `).get(id) as Row | undefined;
    if (!row) throw new Error("Automation playbook not found");
    return this.mapAutomationPlaybook(row);
  }

  getDueAutomationPlaybooks(referenceTime = now()): AutomationPlaybook[] {
    const control = this.database.prepare("SELECT paused FROM automation_control WHERE id = 'global'").get() as Row;
    if (Boolean(control.paused)) return [];
    return (this.database.prepare(`
      SELECT a.*, p.name AS product_name FROM automation_playbooks a
      JOIN products p ON p.id = a.product_id
      WHERE a.enabled = 1 AND p.is_demo = 0 AND a.next_run_at <= ?
      ORDER BY a.next_run_at LIMIT 10
    `).all(referenceTime) as Row[]).map((row) => this.mapAutomationPlaybook(row));
  }

  beginAutomationRun(playbookId: string, trigger: AutomationTriggerKind, idempotencyKey: string): { run: AutomationRun; created: boolean } {
    const control = this.database.prepare("SELECT paused FROM automation_control WHERE id = 'global'").get() as Row;
    if (Boolean(control.paused)) throw new Error("Automation is paused. Resume it before starting a run.");
    const playbook = this.getAutomationPlaybook(playbookId);
    if (!playbook.enabled) throw new Error("This automation playbook is paused.");
    const existing = this.database.prepare("SELECT id FROM automation_runs WHERE idempotency_key = ?").get(idempotencyKey) as Row | undefined;
    if (existing) return { run: this.getAutomationRun(String(existing.id)), created: false };
    const active = this.database.prepare("SELECT id FROM automation_runs WHERE playbook_id = ? AND status IN ('queued', 'running') LIMIT 1").get(playbookId) as Row | undefined;
    if (active) return { run: this.getAutomationRun(String(active.id)), created: false };
    const id = randomUUID();
    this.database.prepare(`
      INSERT INTO automation_runs (id, playbook_id, product_id, trigger_kind, status, idempotency_key, created_at)
      VALUES (?, ?, ?, ?, 'queued', ?, ?)
    `).run(id, playbookId, playbook.productId, trigger, idempotencyKey, now());
    this.recordEvent("automation.run.queued", "automation-run", id, `${playbook.name} queued from a ${trigger} trigger.`, { playbookId });
    return { run: this.getAutomationRun(id), created: true };
  }

  startAutomationRun(id: string): void {
    this.database.prepare("UPDATE automation_runs SET status = 'running' WHERE id = ? AND status = 'queued'").run(id);
  }

  beginAutomationStep(runId: string, sequence: number, name: string, detail = ""): string {
    const id = randomUUID();
    this.database.prepare(`
      INSERT INTO automation_steps (id, run_id, sequence, name, status, detail, started_at)
      VALUES (?, ?, ?, ?, 'running', ?, ?)
    `).run(id, runId, sequence, name, detail, now());
    return id;
  }

  finishAutomationStep(id: string, status: Exclude<AutomationStepStatus, "pending" | "running">, detail = ""): void {
    this.database.prepare("UPDATE automation_steps SET status = ?, detail = ?, completed_at = ? WHERE id = ?").run(status, detail.slice(0, 1_000), now(), id);
  }

  finishAutomationRun(id: string, status: Exclude<AutomationRunStatus, "queued" | "running">, summary: string, error = "", opportunityIds: string[] = []): void {
    this.database.prepare(`
      UPDATE automation_runs SET status = ?, summary = ?, error = ?, created_opportunity_ids_json = ?, completed_at = ? WHERE id = ?
    `).run(status, summary.slice(0, 1_000), error.slice(0, 1_000), JSON.stringify([...new Set(opportunityIds)]), now(), id);
    const run = this.getAutomationRun(id);
    const playbook = this.getAutomationPlaybook(run.playbookId);
    const nextRunAt = new Date(Date.now() + playbook.intervalMinutes * 60_000).toISOString();
    this.database.prepare("UPDATE automation_playbooks SET last_run_at = ?, next_run_at = ?, updated_at = ? WHERE id = ?").run(now(), nextRunAt, now(), run.playbookId);
    this.recordEvent(`automation.run.${status}`, "automation-run", id, summary, { playbookId: run.playbookId, opportunityCount: opportunityIds.length });
  }

  getAutomationRun(id: string): AutomationRun {
    const row = this.database.prepare(`
      SELECT r.*, a.name AS playbook_name, p.name AS product_name FROM automation_runs r
      JOIN automation_playbooks a ON a.id = r.playbook_id
      JOIN products p ON p.id = r.product_id WHERE r.id = ?
    `).get(id) as Row | undefined;
    if (!row) throw new Error("Automation run not found");
    const steps = (this.database.prepare("SELECT * FROM automation_steps WHERE run_id = ? ORDER BY sequence, started_at").all(id) as Row[]).map((step) => ({
      id: String(step.id), runId: String(step.run_id), sequence: Number(step.sequence), name: String(step.name),
      status: String(step.status) as AutomationStepStatus, detail: String(step.detail), startedAt: String(step.started_at), completedAt: String(step.completed_at),
    }));
    let createdOpportunityIds: string[] = [];
    try { createdOpportunityIds = JSON.parse(String(row.created_opportunity_ids_json)) as string[]; } catch { createdOpportunityIds = []; }
    return {
      id: String(row.id), playbookId: String(row.playbook_id), playbookName: String(row.playbook_name),
      productId: String(row.product_id), productName: String(row.product_name), trigger: String(row.trigger_kind) as AutomationTriggerKind,
      status: String(row.status) as AutomationRunStatus, idempotencyKey: String(row.idempotency_key), summary: String(row.summary), error: String(row.error),
      createdOpportunityIds, createdAt: String(row.created_at), completedAt: String(row.completed_at), steps,
    };
  }

  getAutomationState(): AutomationState {
    const controlRow = this.database.prepare("SELECT * FROM automation_control WHERE id = 'global'").get() as Row;
    const playbooks = (this.database.prepare(`
      SELECT a.*, p.name AS product_name FROM automation_playbooks a JOIN products p ON p.id = a.product_id
      WHERE p.is_demo = 0 ORDER BY a.enabled DESC, a.updated_at DESC
    `).all() as Row[]).map((row) => this.mapAutomationPlaybook(row));
    const runs = (this.database.prepare(`
      SELECT r.id FROM automation_runs r JOIN products p ON p.id = r.product_id
      WHERE p.is_demo = 0 ORDER BY r.created_at DESC LIMIT 20
    `).all() as Row[]).map((row) => this.getAutomationRun(String(row.id)));
    const adapters = this.getActionAdapters();
    return {
      control: { paused: Boolean(controlRow.paused), publicExecutionEnabled: false, approvalBoundary: "always", updatedAt: String(controlRow.updated_at) },
      playbooks,
      runs,
      adapters,
      actionFabric: {
        version: 1,
        ethos: ACTION_FABRIC_ETHOS,
        transports: ACTION_TRANSPORT_CATALOG,
        adapters,
        executions: this.getActionExecutions(),
        policy: { identityBearingApproval: "every-time", arbitraryShell: "forbidden", secretPersistence: "forbidden", publicAutopilot: false },
      },
    };
  }

  getActionAdapters(): ActionAdapterDescriptor[] {
    const connectedGitHub = Number((this.database.prepare("SELECT COUNT(*) AS count FROM source_connectors WHERE kind = 'github' AND status = 'connected'").get() as Row).count);
    const core: ActionAdapterDescriptor[] = [
      {
        id: "github-observer", name: "GitHub signal observer", version: "1.0.0",
        description: "Reads bounded issue metadata and quarantines candidates for review.", transport: "direct-api",
        capabilities: ["observe", "search", "read"], risk: "read-only", approval: "none",
        state: connectedGitHub ? "available" : "setup-required", publicSideEffect: false, origin: "core", configSummary: connectedGitHub ? `${connectedGitHub} connected source${connectedGitHub === 1 ? "" : "s"}` : "Connect a repository to activate",
        connection: { lastCheckedAt: "", lastError: "", credentialSource: connectedGitHub ? "environment" : "none", tools: connectedGitHub ? [
          { name: "sync-issues", description: "Read recent issue metadata into the quarantined Signal Inbox.", capabilities: ["observe", "search", "read"], risk: "read-only", publicSideEffect: false },
        ] : [] },
      },
      {
        id: "ai-preparation", name: "Evidence-grounded preparation", version: "1.0.0",
        description: "Creates cited plans and founder-editable drafts inside the private ledger.", transport: "direct-api",
        capabilities: ["read", "prepare"], risk: "private-write", approval: "none",
        state: "available", publicSideEffect: false, origin: "core", configSummary: "Uses the active model or agent runtime",
        connection: { lastCheckedAt: "", lastError: "", credentialSource: "external-runtime", tools: [
          { name: "prepare-cited-work", description: "Prepare a cited plan or draft inside the private ledger.", capabilities: ["read", "prepare"], risk: "private-write", publicSideEffect: false },
        ] },
      },
      {
        id: "human-handoff", name: "Founder-owned public handoff", version: "1.0.0",
        description: "Packages approved context for a human to publish or reply without impersonation.", transport: "manual",
        capabilities: ["execute", "measure"], risk: "identity-bearing", approval: "every-time",
        state: "available", publicSideEffect: true, origin: "core", configSummary: "Approval required for every action",
        connection: { lastCheckedAt: "", lastError: "", credentialSource: "none", tools: [
          { name: "human-handoff", description: "Give approved context to the founder for manual execution.", capabilities: ["execute", "measure"], risk: "identity-bearing", publicSideEffect: true },
        ] },
      },
    ];
    const configured = (this.database.prepare("SELECT * FROM action_adapters ORDER BY updated_at DESC, name").all() as Row[]).map((row): ActionAdapterDescriptor => {
      let capabilities: ActionCapability[] = [];
      let tools: ActionToolDescriptor[] = [];
      try { capabilities = JSON.parse(String(row.capabilities_json)) as ActionCapability[]; } catch { capabilities = []; }
      try { tools = JSON.parse(String(row.discovered_tools_json)) as ActionToolDescriptor[]; } catch { tools = []; }
      return {
        id: String(row.id), name: String(row.name), version: "1.0.0", description: this.adapterDescription(String(row.transport) as ActionTransport),
        transport: String(row.transport) as ActionTransport, capabilities, risk: String(row.risk) as ActionRisk,
        approval: String(row.approval) as ActionAdapterDescriptor["approval"], state: String(row.state) as ActionAdapterDescriptor["state"],
        publicSideEffect: Boolean(row.public_side_effect), origin: "user", configSummary: String(row.config_summary),
        connection: {
          lastCheckedAt: String(row.last_checked_at), lastError: String(row.last_error),
          credentialSource: String(row.credential_env) ? "environment" : String(row.transport) === "cli" ? "external-runtime" : "none",
          tools,
        },
      };
    });
    return [...core, ...configured];
  }

  createActionAdapter(input: { name: string; transport: string; capabilities: string[]; endpoint?: string; command?: string; gateway?: string; connectionRef?: string; credentialEnv?: string }): ActionAdapterDescriptor {
    const name = input.name.trim().slice(0, 80);
    if (!name) throw new Error("Give this capability adapter a name.");
    if (!ACTION_TRANSPORTS.includes(input.transport as ActionTransport) || input.transport === "direct-api") throw new Error("Choose MCP, local CLI, managed gateway, or human handoff.");
    const transport = input.transport as Exclude<ActionTransport, "direct-api">;
    const capabilities = [...new Set(input.capabilities)].filter((value): value is ActionCapability => ACTION_CAPABILITIES.includes(value as ActionCapability));
    if (!capabilities.length) throw new Error("Declare at least one capability.");
    const execute = capabilities.includes("execute");
    const config: Record<string, string> = {};
    let summary = "No credentials stored";
    let state: ActionAdapterDescriptor["state"] = "setup-required";
    const credentialEnv = (input.credentialEnv || "").trim();
    if (credentialEnv && !/^[A-Z][A-Z0-9_]{2,80}$/.test(credentialEnv)) throw new Error("Credential environment variables must use uppercase letters, numbers, and underscores.");
    if (credentialEnv && transport !== "mcp" && transport !== "managed-gateway") throw new Error("Credential environment references are only supported by MCP and managed gateway adapters.");

    if (transport === "cli" && capabilities.some((capability) => !new Set<ActionCapability>(["observe", "search", "read"]).has(capability))) {
      throw new Error("The GitHub CLI adapter is read-only and may only declare observe, search, and read capabilities.");
    }
    if (transport === "manual" && capabilities.some((capability) => !new Set<ActionCapability>(["execute", "measure"]).has(capability))) {
      throw new Error("Human handoff adapters may only declare execute and measure capabilities.");
    }

    if (transport === "mcp") {
      const endpoint = this.validateAdapterEndpoint(input.endpoint || "");
      config.endpoint = endpoint;
      summary = new URL(endpoint).host;
      state = "setup-required";
    } else if (transport === "cli") {
      const command = (input.command || "").trim();
      const allowed = new Set(["gh"]);
      if (!allowed.has(command) || /[;&|`$<>\\\n\r]/.test(command)) throw new Error("Choose a supported executable. Arbitrary shell commands are forbidden.");
      config.command = command;
      summary = `${command} (no shell)`;
      state = "setup-required";
    } else if (transport === "managed-gateway") {
      const gateway = (input.gateway || "").trim().toLowerCase();
      if (gateway !== "composio") throw new Error("Composio is the only managed gateway recipe currently recognized.");
      const connectionRef = (input.connectionRef || "").trim();
      if (connectionRef && (!/^[a-zA-Z0-9_.:-]{1,160}$/.test(connectionRef) || /^(?:sk-|npm_|ghp_|github_pat_|bearer)/i.test(connectionRef))) throw new Error("Connection references may not contain secrets or executable content.");
      config.gateway = gateway;
      if (connectionRef) config.connectionRef = connectionRef;
      const endpoint = this.validateAdapterEndpoint(input.endpoint || "");
      config.endpoint = endpoint;
      summary = connectionRef ? `Composio · ${connectionRef}` : `Composio · ${new URL(endpoint).host}`;
    } else {
      summary = "Human performs the external action";
      state = "setup-required";
    }

    const risk: ActionRisk = execute ? "identity-bearing" : capabilities.includes("prepare") ? "private-write" : "read-only";
    const approval = execute ? "every-time" : capabilities.includes("prepare") ? "first-use" : "none";
    const id = `adapter-${randomUUID()}`;
    const createdAt = now();
    this.database.prepare(`
      INSERT INTO action_adapters (id, name, transport, capabilities_json, risk, approval, state, public_side_effect, config_json, config_summary, credential_env, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, transport, JSON.stringify(capabilities), risk, approval, state, execute ? 1 : 0, JSON.stringify(config), summary, credentialEnv, createdAt, createdAt);
    this.recordEvent("action-fabric.adapter.registered", "action-adapter", id, `${name} registered as a ${transport} adapter. It cannot exceed its declared capabilities.`, { transport, capabilities, risk, approval });
    return this.getActionAdapters().find((adapter) => adapter.id === id)!;
  }

  setActionAdapterEnabled(id: string, enabled: boolean): ActionAdapterDescriptor {
    const row = this.database.prepare("SELECT id, name, state FROM action_adapters WHERE id = ?").get(id) as Row | undefined;
    if (!row) throw new Error("Only user-configured adapters can be changed.");
    const nextState = enabled ? "setup-required" : "disabled";
    this.database.prepare("UPDATE action_adapters SET state = ?, updated_at = ? WHERE id = ?").run(nextState, now(), id);
    this.recordEvent(enabled ? "action-fabric.adapter.enabled" : "action-fabric.adapter.disabled", "action-adapter", id, `${String(row.name)} ${enabled ? "returned to setup" : "was disabled"}.`);
    return this.getActionAdapters().find((adapter) => adapter.id === id)!;
  }

  getActionAdapterConnection(id: string): { descriptor: ActionAdapterDescriptor; config: Record<string, string>; credentialEnv: string } {
    const row = this.database.prepare("SELECT config_json, credential_env FROM action_adapters WHERE id = ?").get(id) as Row | undefined;
    if (!row) throw new Error("Only user-configured adapters have a connection manifest.");
    let config: Record<string, string> = {};
    try { config = JSON.parse(String(row.config_json)) as Record<string, string>; } catch { config = {}; }
    const descriptor = this.getActionAdapters().find((adapter) => adapter.id === id);
    if (!descriptor) throw new Error("Action adapter not found.");
    return { descriptor, config, credentialEnv: String(row.credential_env) };
  }

  recordActionAdapterProbe(id: string, tools: ActionToolDescriptor[], error = ""): ActionAdapterDescriptor {
    const row = this.database.prepare("SELECT name, state FROM action_adapters WHERE id = ?").get(id) as Row | undefined;
    if (!row) throw new Error("Action adapter not found.");
    const checkedAt = now();
    const state = error ? "setup-required" : "available";
    this.database.prepare("UPDATE action_adapters SET state = ?, discovered_tools_json = ?, last_checked_at = ?, last_error = ?, updated_at = ? WHERE id = ?")
      .run(state, JSON.stringify(tools.slice(0, 100)), checkedAt, error.slice(0, 500), checkedAt, id);
    this.recordEvent(error ? "action-fabric.adapter.probe-failed" : "action-fabric.adapter.connected", "action-adapter", id, error ? `${String(row.name)} could not be verified.` : `${String(row.name)} verified ${tools.length} bounded tool${tools.length === 1 ? "" : "s"}.`, { toolCount: tools.length });
    return this.getActionAdapters().find((adapter) => adapter.id === id)!;
  }

  createActionExecution(input: { adapterId: string; capability: ActionCapability; toolName: string; status: ActionExecutionStatus; purpose: string; evidenceRefs: string[]; arguments: Record<string, unknown>; decision: ActionDecision; idempotencyKey: string; dryRun?: boolean }): { record: ActionExecutionRecord; created: boolean } {
    const purpose = input.purpose.trim().slice(0, 500);
    const idempotencyKey = input.idempotencyKey.trim();
    if (!purpose) throw new Error("Describe why this action is useful before requesting it.");
    if (!/^[A-Za-z0-9_.:-]{8,200}$/.test(idempotencyKey)) throw new Error("Use a stable idempotency key with at least 8 safe characters.");
    if (!input.toolName.trim()) throw new Error("Choose a verified tool before requesting an action.");
    const evidenceRefs = [...new Set(input.evidenceRefs.map((value) => value.trim()).filter(Boolean))].sort().slice(0, 100);
    const argumentsJson = stableJson(input.arguments);
    const existing = this.database.prepare("SELECT * FROM action_executions WHERE idempotency_key = ?").get(idempotencyKey) as Row | undefined;
    if (existing) {
      let existingEvidence: unknown = [];
      let existingArguments: unknown = {};
      try { existingEvidence = JSON.parse(String(existing.evidence_refs_json)); } catch { existingEvidence = []; }
      try { existingArguments = JSON.parse(String(existing.arguments_json)); } catch { existingArguments = {}; }
      const normalizedExistingEvidence = Array.isArray(existingEvidence) ? [...new Set(existingEvidence.map(String))].sort().slice(0, 100) : [];
      const sameRequest = String(existing.adapter_id) === input.adapterId
        && String(existing.capability) === input.capability
        && String(existing.tool_name) === input.toolName.trim()
        && String(existing.purpose) === purpose
        && stableJson(normalizedExistingEvidence) === stableJson(evidenceRefs)
        && stableJson(existingArguments) === argumentsJson
        && Boolean(existing.dry_run) === Boolean(input.dryRun);
      if (!sameRequest) throw new Error("Idempotency key is already bound to a different action request.");
      return { record: this.getActionExecution(String(existing.id)), created: false };
    }
    const id = randomUUID();
    const createdAt = now();
    this.database.prepare(`
      INSERT INTO action_executions (id, adapter_id, capability, tool_name, status, purpose, evidence_refs_json, arguments_json, argument_keys_json, decision_json, idempotency_key, dry_run, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.adapterId, input.capability, input.toolName.trim(), input.status, purpose, stableJson(evidenceRefs), argumentsJson, JSON.stringify(Object.keys(input.arguments).sort()), JSON.stringify(input.decision), idempotencyKey, input.dryRun ? 1 : 0, createdAt);
    this.recordEvent("action-fabric.execution.requested", "action-execution", id, `${input.toolName} evaluated as ${input.status}.`, { adapterId: input.adapterId, capability: input.capability });
    return { record: this.getActionExecution(id), created: true };
  }

  updateActionExecution(id: string, status: ActionExecutionStatus, summary = "", error = "", externalId = "", externalUrl = ""): ActionExecutionRecord {
    if (externalUrl) {
      try {
        const url = new URL(externalUrl);
        if (url.protocol !== "http:" && url.protocol !== "https:") externalUrl = "";
      } catch { externalUrl = ""; }
    }
    const completedAt = new Set<ActionExecutionStatus>(["completed", "failed", "blocked", "cancelled"]).has(status) ? now() : "";
    this.database.prepare("UPDATE action_executions SET status = ?, summary = ?, error = ?, external_id = ?, external_url = ?, completed_at = ? WHERE id = ?")
      .run(status, summary.slice(0, 2_000), error.slice(0, 1_000), externalId.slice(0, 500), externalUrl.slice(0, 1_000), completedAt, id);
    const record = this.getActionExecution(id);
    this.recordEvent(`action-fabric.execution.${status}`, "action-execution", id, summary || error || `Connection action moved to ${status}.`, { adapterId: record.adapterId, capability: record.capability, toolName: record.toolName });
    return record;
  }

  markActionExecutionApproved(id: string): { record: ActionExecutionRecord; claimed: boolean } {
    const approvedAt = now();
    const result = this.database.prepare("UPDATE action_executions SET status = 'running', approved_at = ? WHERE id = ? AND status = 'approval-required'").run(approvedAt, id);
    const claimed = Number(result.changes) === 1;
    const record = this.getActionExecution(id);
    if (claimed) this.recordEvent("action-fabric.execution.approved", "action-execution", id, "A human approved this exact bounded action payload for one connection call.", { adapterId: record.adapterId, capability: record.capability, toolName: record.toolName });
    return { record, claimed };
  }

  getActionExecution(id: string): ActionExecutionRecord {
    const row = this.database.prepare("SELECT * FROM action_executions WHERE id = ?").get(id) as Row | undefined;
    if (!row) throw new Error("Action execution not found.");
    const adapter = this.getActionAdapters().find((item) => item.id === String(row.adapter_id));
    let evidenceRefs: string[] = []; let argumentKeys: string[] = []; let argumentPayload: Record<string, unknown> = {}; let decision = {} as ActionDecision;
    try { evidenceRefs = JSON.parse(String(row.evidence_refs_json)) as string[]; } catch { evidenceRefs = []; }
    try { argumentKeys = JSON.parse(String(row.argument_keys_json)) as string[]; } catch { argumentKeys = []; }
    try { argumentPayload = JSON.parse(String(row.arguments_json)) as Record<string, unknown>; } catch { argumentPayload = {}; }
    try { decision = JSON.parse(String(row.decision_json)) as ActionDecision; } catch { decision = { status: "blocked", reasons: ["Stored policy decision was unreadable."], adapterId: String(row.adapter_id), capability: String(row.capability) as ActionCapability, approval: "every-time", publicSideEffect: true, evaluatedAt: String(row.created_at) }; }
    return {
      id: String(row.id), adapterId: String(row.adapter_id), adapterName: adapter?.name || "Unavailable adapter", capability: String(row.capability) as ActionCapability,
      toolName: String(row.tool_name), status: String(row.status) as ActionExecutionStatus, purpose: String(row.purpose), evidenceRefs, argumentKeys,
      argumentPreview: JSON.stringify(argumentPayload, null, 2).slice(0, 8_000), decision,
      summary: String(row.summary), error: String(row.error), externalId: String(row.external_id), externalUrl: String(row.external_url), idempotencyKey: String(row.idempotency_key),
      dryRun: Boolean(row.dry_run), createdAt: String(row.created_at), approvedAt: String(row.approved_at), completedAt: String(row.completed_at),
    };
  }

  getActionExecutionPayload(id: string): Record<string, unknown> {
    const row = this.database.prepare("SELECT arguments_json FROM action_executions WHERE id = ?").get(id) as Row | undefined;
    if (!row) throw new Error("Action execution not found.");
    try { return JSON.parse(String(row.arguments_json)) as Record<string, unknown>; } catch { return {}; }
  }

  getActionExecutions(limit = 30): ActionExecutionRecord[] {
    const rows = this.database.prepare("SELECT id FROM action_executions ORDER BY created_at DESC LIMIT ?").all(Math.max(1, Math.min(100, limit))) as Row[];
    return rows.map((row) => this.getActionExecution(String(row.id)));
  }

  private validateAdapterEndpoint(value: string): string {
    let url: URL;
    try { url = new URL(value); } catch { throw new Error("Enter a valid MCP HTTP endpoint."); }
    if (!new Set(["http:", "https:"]).has(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("MCP endpoints must use HTTP(S) and may not embed credentials or query parameters.");
    if (url.protocol !== "https:" && !new Set(["127.0.0.1", "localhost", "[::1]"]).has(url.hostname)) throw new Error("Remote MCP endpoints must use HTTPS.");
    return url.toString();
  }

  private adapterDescription(transport: ActionTransport): string {
    return ACTION_TRANSPORT_CATALOG.find((item) => item.id === transport)?.description || "Declared capability adapter.";
  }

  private mapAutomationPlaybook(row: Row): AutomationPlaybook {
    return {
      id: String(row.id), productId: String(row.product_id), productName: String(row.product_name), name: String(row.name),
      enabled: Boolean(row.enabled), intervalMinutes: Number(row.interval_minutes), maxActionsPerRun: Number(row.max_actions_per_run),
      requireApproval: true, lastRunAt: String(row.last_run_at), nextRunAt: String(row.next_run_at), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    };
  }

  private validateAutomationLimits(intervalMinutes: number, maxActionsPerRun: number): void {
    if (!Number.isInteger(intervalMinutes) || intervalMinutes < 15 || intervalMinutes > 10_080) throw new Error("Automation interval must be between 15 minutes and 7 days.");
    if (!Number.isInteger(maxActionsPerRun) || maxActionsPerRun < 1 || maxActionsPerRun > 5) throw new Error("Action budget must be between 1 and 5 prepared moves per run.");
  }

  applyDistributionPlan(plan: DistributionPlan): PlanApplication {
    const context = this.getProductContext(plan.productId);
    const evidenceByLabel = new Map<string, string[]>();
    for (const item of context.evidence) {
      const key = item.title.toLowerCase();
      evidenceByLabel.set(key, [...(evidenceByLabel.get(key) || []), item.id]);
    }
    const channelIds = new Set(context.channels.map((channel) => channel.id));
    const createdAt = now();
    const statement = this.database.prepare(`
      INSERT INTO opportunities (
        id, product_id, channel_id, type, title, context, why_now, suggested_angle, audience,
        source_url, draft_copy, relevance_score, value_score, freshness_score, promotion_risk,
        score, status, discovered_at, evidence_ids_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?)
    `);
    const existingStatement = this.database.prepare("SELECT id FROM opportunities WHERE product_id = ? AND channel_id = ? AND lower(title) = lower(?) LIMIT 1");
    let inserted = 0;
    const opportunityIds: string[] = [];
    this.database.exec("BEGIN IMMEDIATE");
    try {
      for (const move of plan.moves.slice(0, 5)) {
        if (!channelIds.has(move.channelId)) continue;
        if (existingStatement.get(plan.productId, move.channelId, move.title)) continue;
        const evidenceIds = move.citationLabels.flatMap((label) => {
          const exact = evidenceByLabel.get(label.toLowerCase());
          if (exact) return exact;
          return context.evidence
            .filter((item) => item.title.toLowerCase().includes(label.toLowerCase()) || label.toLowerCase().includes(item.title.toLowerCase()))
            .map((item) => item.id);
        });
        if (!evidenceIds.length) continue;
        const opportunityId = randomUUID();
        statement.run(
          opportunityId, plan.productId, move.channelId, move.type, move.title,
          `Generated by harness run ${plan.runId}. ${plan.summary}`, move.whyNow, move.suggestedAngle,
          context.product.audience, context.evidence.find((item) => evidenceIds.includes(item.id))?.sourceUrl || "", move.draftCopy,
          move.relevanceScore, move.valueScore, move.freshnessScore, move.promotionRisk,
          scoreOpportunity({ relevance: move.relevanceScore, value: move.valueScore, freshness: move.freshnessScore, promotionRisk: move.promotionRisk }),
          createdAt, JSON.stringify([...new Set(evidenceIds)]),
        );
        inserted += 1;
        opportunityIds.push(opportunityId);
      }
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    this.recordEvent("distribution.plan.generated", "product", plan.productId, `${inserted} cited distribution move${inserted === 1 ? "" : "s"} generated.`, { runId: plan.runId, mode: plan.mode });
    return { insertedCount: inserted, opportunityIds };
  }

  updateChannelPolicy(channelId: string, input: ChannelPolicyInput): void {
    const modes = new Set<ChannelMode>(["draft", "approval", "autopilot"]);
    if (!modes.has(input.mode)) throw new Error("Choose a supported channel execution mode.");
    if (!Number.isInteger(input.dailyLimit) || input.dailyLimit < 0 || input.dailyLimit > 100) {
      throw new Error("Daily channel limit must be a whole number between 0 and 100.");
    }
    const channel = this.database.prepare("SELECT name FROM channels WHERE id = ?").get(channelId) as Row | undefined;
    if (!channel) throw new Error("Channel not found");
    this.database.prepare("UPDATE channels SET mode = ?, daily_limit = ? WHERE id = ?").run(input.mode, input.dailyLimit, channelId);
    this.recordEvent("channel.policy.updated", "channel", channelId, `${String(channel.name)} policy updated to ${input.mode} with a daily limit of ${input.dailyLimit}.`, { ...input });
  }

  getDashboard(): DashboardState {
    const productRows = this.database.prepare(`
      SELECT p.*, COUNT(e.id) AS evidence_count
      FROM products p LEFT JOIN evidence e ON e.product_id = p.id
      WHERE p.is_demo = 0
      GROUP BY p.id ORDER BY p.name
    `).all() as Row[];
    const products: Product[] = productRows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      description: String(row.description),
      stage: String(row.stage) as Product["stage"],
      repositoryUrl: String(row.repository_url),
      websiteUrl: String(row.website_url),
      evidenceCount: Number(row.evidence_count),
      audience: String(row.audience),
      objective: String(row.objective),
      positioning: String(row.positioning),
      confidence: Number(row.confidence),
      onboardingStatus: String(row.onboarding_status) as Product["onboardingStatus"],
    }));

    const channelRows = this.database.prepare("SELECT * FROM channels ORDER BY connected DESC, name").all() as Row[];
    const channels: Channel[] = channelRows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      handle: String(row.handle),
      mode: String(row.mode) as Channel["mode"],
      status: String(row.status) as Channel["status"],
      dailyLimit: Number(row.daily_limit),
      connected: Boolean(row.connected),
    }));

    const opportunityRows = this.database.prepare(`
      SELECT o.*, p.name AS product_name, c.name AS channel_name, c.mode AS channel_mode
      FROM opportunities o
      JOIN products p ON p.id = o.product_id
      JOIN channels c ON c.id = o.channel_id
      WHERE p.is_demo = 0
      ORDER BY CASE o.status WHEN 'ready' THEN 0 WHEN 'approved' THEN 1 WHEN 'published' THEN 2 ELSE 3 END,
               o.score DESC, o.discovered_at DESC
    `).all() as Row[];

    const evidenceStatement = this.database.prepare(`
      SELECT id, kind, title, summary, source_url, occurred_at, source_type, classification, confidence FROM evidence WHERE id = ?
    `);
    const opportunities: Opportunity[] = opportunityRows.map((row) => {
      const evidenceIds = JSON.parse(String(row.evidence_ids_json)) as string[];
      const evidence = evidenceIds.flatMap((id): Evidence[] => {
        const evidenceRow = evidenceStatement.get(id) as Row | undefined;
        if (!evidenceRow) return [];
        return [{
          id: String(evidenceRow.id),
          kind: String(evidenceRow.kind),
          title: String(evidenceRow.title),
          summary: String(evidenceRow.summary),
          sourceUrl: String(evidenceRow.source_url),
          occurredAt: String(evidenceRow.occurred_at),
          sourceType: String(evidenceRow.source_type) as Evidence["sourceType"],
          classification: String(evidenceRow.classification) as Evidence["classification"],
          confidence: Number(evidenceRow.confidence),
        }];
      });
      return {
        id: String(row.id),
        productId: String(row.product_id),
        productName: String(row.product_name),
        channelId: String(row.channel_id),
        channelName: String(row.channel_name),
        channelMode: String(row.channel_mode) as Opportunity["channelMode"],
        type: String(row.type) as Opportunity["type"],
        title: String(row.title),
        context: String(row.context),
        whyNow: String(row.why_now),
        suggestedAngle: String(row.suggested_angle),
        audience: String(row.audience),
        sourceUrl: String(row.source_url),
        draftCopy: String(row.draft_copy),
        relevanceScore: Number(row.relevance_score),
        valueScore: Number(row.value_score),
        freshnessScore: Number(row.freshness_score),
        promotionRisk: Number(row.promotion_risk),
        score: Number(row.score),
        status: String(row.status) as OpportunityStatus,
        discoveredAt: String(row.discovered_at),
        evidence,
      };
    });

    const metricRow = this.database.prepare(`
      SELECT
        (SELECT COUNT(*) FROM opportunities o JOIN products p ON p.id = o.product_id WHERE o.status = 'ready' AND p.is_demo = 0) AS ready_moves,
        (SELECT COUNT(*) FROM opportunities o JOIN products p ON p.id = o.product_id WHERE o.status = 'approved' AND p.is_demo = 0) AS approved_moves,
        (SELECT COUNT(*) FROM evidence e JOIN products p ON p.id = e.product_id WHERE p.is_demo = 0) AS evidence_items,
        (SELECT COUNT(*) FROM signal_candidates s JOIN products p ON p.id = s.product_id WHERE s.status = 'new' AND p.is_demo = 0) AS new_signals,
        (SELECT COALESCE(ROUND(AVG(confidence)), 0) FROM products WHERE is_demo = 0) AS analysis_confidence,
        (SELECT COUNT(*) FROM channels WHERE connected = 1) AS connected_channels,
        (SELECT COUNT(*) FROM source_connectors c JOIN products p ON p.id = c.product_id WHERE c.status = 'connected' AND p.is_demo = 0) AS connected_sources
    `).get() as Row;

    const eventRows = this.database.prepare(`
      SELECT * FROM events
      WHERE NOT (event_type = 'system.initialized' AND detail LIKE 'Local distribution ledger initialized with two products%')
      ORDER BY occurred_at DESC, id DESC LIMIT 8
    `).all() as Row[];
    const recentEvents: DistributionEvent[] = eventRows.map((row) => ({
      id: Number(row.id),
      type: String(row.event_type),
      entityType: String(row.entity_type),
      entityId: String(row.entity_id),
      detail: String(row.detail),
      occurredAt: String(row.occurred_at),
    }));

    const audienceSignals = (this.database.prepare(`
      SELECT e.id, e.kind, e.title, e.summary, e.source_url, e.occurred_at, e.source_type,
             e.classification, e.confidence, e.product_id, p.name AS product_name
      FROM evidence e JOIN products p ON p.id = e.product_id
      WHERE e.kind = 'audience-signal' AND p.is_demo = 0
      ORDER BY e.occurred_at DESC
    `).all() as Row[]).map((row): AudienceSignal => ({
      id: String(row.id), kind: String(row.kind), title: String(row.title), summary: String(row.summary),
      sourceUrl: String(row.source_url), occurredAt: String(row.occurred_at), sourceType: String(row.source_type) as AudienceSignal["sourceType"],
      classification: String(row.classification) as AudienceSignal["classification"], confidence: Number(row.confidence),
      productId: String(row.product_id), productName: String(row.product_name),
    }));

    const signalInbox = (this.database.prepare(`
      SELECT s.*, p.name AS product_name
      FROM signal_candidates s JOIN products p ON p.id = s.product_id
      WHERE p.is_demo = 0
      ORDER BY CASE s.status WHEN 'new' THEN 0 WHEN 'accepted' THEN 1 ELSE 2 END,
               s.captured_at DESC
    `).all() as Row[]).map((row): SignalCandidate => ({
      id: String(row.id), productId: String(row.product_id), productName: String(row.product_name),
      kind: String(row.kind) as SignalCandidate["kind"], title: String(row.title), summary: String(row.summary),
      excerpt: String(row.excerpt), sourceUrl: String(row.source_url), sourceType: String(row.source_type) as SignalCandidate["sourceType"],
      confidence: Number(row.confidence), relevance: Number(row.relevance), reason: String(row.reason),
      status: String(row.status) as SignalCandidate["status"], capturedAt: String(row.captured_at), decidedAt: String(row.decided_at),
      origin: String(row.origin) as SignalCandidate["origin"], externalId: String(row.external_id),
    }));

    const connectors = (this.database.prepare(`
      SELECT c.*, p.name AS product_name
      FROM source_connectors c JOIN products p ON p.id = c.product_id
      WHERE p.is_demo = 0
      ORDER BY c.updated_at DESC, c.name
    `).all() as Row[]).map((row) => this.mapSourceConnector(row));

    return {
      generatedAt: now(),
      storage: { mode: "local", location: this.databasePath },
      metrics: {
        readyMoves: Number(metricRow.ready_moves),
        approvedMoves: Number(metricRow.approved_moves),
        evidenceItems: Number(metricRow.evidence_items),
        newSignals: Number(metricRow.new_signals),
        connectedChannels: Number(metricRow.connected_channels),
        connectedSources: Number(metricRow.connected_sources),
        analysisConfidence: Number(metricRow.analysis_confidence),
      },
      onboarding: {
        required: products.length === 0,
        supportedSources: ["text", "url", "document", "repository"],
      },
      products,
      channels,
      opportunities,
      signalInbox,
      connectors,
      audienceSignals,
      recentEvents,
      harnessRuns: this.getRecentHarnessRuns(),
      automation: this.getAutomationState(),
    };
  }

  getOpportunityDraftContext(id: string): { opportunity: Opportunity; product: Product; channel: Channel; evidence: Evidence[] } {
    const dashboard = this.getDashboard();
    const opportunity = dashboard.opportunities.find((item) => item.id === id);
    if (!opportunity) throw new Error("Opportunity not found");
    const product = dashboard.products.find((item) => item.id === opportunity.productId);
    const channel = dashboard.channels.find((item) => item.id === opportunity.channelId);
    if (!product || !channel) throw new Error("Opportunity context is incomplete");
    return { opportunity, product, channel, evidence: opportunity.evidence };
  }

  updateOpportunityDraft(id: string, draftCopy: string): void {
    const value = draftCopy.trim();
    if (value.length < 20 || value.length > 4_000) throw new Error("Contribution draft must contain between 20 and 4,000 characters.");
    const row = this.database.prepare("SELECT title FROM opportunities WHERE id = ?").get(id) as Row | undefined;
    if (!row) throw new Error("Opportunity not found");
    this.database.prepare("UPDATE opportunities SET draft_copy = ? WHERE id = ?").run(value, id);
    this.recordEvent("opportunity.draft.written", "opportunity", id, `A source-cited contribution draft was written for ${String(row.title)}.`);
  }

  decideOpportunity(id: string, action: "approve" | "skip" | "restore", draftCopy?: string): OpportunityStatus {
    const row = this.database.prepare("SELECT title, status FROM opportunities WHERE id = ?").get(id) as Row | undefined;
    if (!row) throw new Error("Opportunity not found");

    const nextStatus: OpportunityStatus = action === "approve" ? "approved" : action === "skip" ? "skipped" : "ready";
    this.database.prepare(`
      UPDATE opportunities
      SET status = ?, draft_copy = COALESCE(?, draft_copy), scheduled_for = CASE WHEN ? = 'approved' THEN datetime('now', '+1 day') ELSE NULL END
      WHERE id = ?
    `).run(nextStatus, draftCopy?.trim() || null, nextStatus, id);
    this.reconcileAutomationApprovalState(id);
    this.recordEvent(
      `opportunity.${action}`,
      "opportunity",
      id,
      `${String(row.title)} ${action === "approve" ? "approved and queued" : action === "skip" ? "skipped for now" : "returned to the queue"}.`,
      { previousStatus: row.status, nextStatus },
    );
    return nextStatus;
  }

  private reconcileAutomationApprovalState(opportunityId: string): void {
    const rows = this.database.prepare(`
      SELECT id, status, created_opportunity_ids_json FROM automation_runs
      WHERE created_opportunity_ids_json LIKE ?
    `).all(`%${opportunityId}%`) as Row[];
    for (const row of rows) {
      let ids: string[] = [];
      try { ids = JSON.parse(String(row.created_opportunity_ids_json)) as string[]; } catch { ids = []; }
      if (!ids.includes(opportunityId) || !ids.length) continue;
      const placeholders = ids.map(() => "?").join(",");
      const statuses = (this.database.prepare(`SELECT status FROM opportunities WHERE id IN (${placeholders})`).all(...ids) as Row[]).map((item) => String(item.status));
      const awaiting = statuses.filter((status) => status === "ready").length;
      const nextStatus = awaiting ? "waiting-approval" : "completed";
      if (String(row.status) === nextStatus) continue;
      const summary = awaiting
        ? `${awaiting} prepared action${awaiting === 1 ? " is" : "s are"} waiting for human judgment.`
        : `${ids.length} prepared action${ids.length === 1 ? " received" : "s received"} human decisions.`;
      this.database.prepare("UPDATE automation_runs SET status = ?, summary = ?, completed_at = ? WHERE id = ?")
        .run(nextStatus, summary, awaiting ? "" : now(), row.id);
      this.recordEvent(`automation.run.${nextStatus}`, "automation-run", String(row.id), summary, { opportunityId });
    }
  }

  recordOutcome(opportunityId: string, metric: string, value: number, note = ""): void {
    const allowed = new Set(["qualified-visits", "replies", "conversations", "signups", "stars", "revenue"]);
    if (!allowed.has(metric)) throw new Error("Choose a supported outcome metric.");
    if (!Number.isFinite(value) || value < 0 || value > 1_000_000_000) throw new Error("Outcome value must be a non-negative number.");
    const opportunity = this.database.prepare("SELECT id, product_id, channel_id, title FROM opportunities WHERE id = ?").get(opportunityId) as Row | undefined;
    if (!opportunity) throw new Error("Opportunity not found");
    const capturedAt = now();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare("INSERT INTO outcomes (id, opportunity_id, metric, value, captured_at, payload_json) VALUES (?, ?, ?, ?, ?, ?)")
        .run(randomUUID(), opportunityId, metric, value, capturedAt, JSON.stringify({ note: note.trim().slice(0, 500) }));
      this.database.prepare("UPDATE opportunities SET status = 'published' WHERE id = ?").run(opportunityId);
      this.recordEvent("outcome.recorded", "opportunity", opportunityId, `${metric} outcome recorded for ${String(opportunity.title)}: ${value}.`, { metric, value, channelId: opportunity.channel_id, note: note.trim().slice(0, 500) });
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  getOutcomeMemory(productId: string): Array<{ channelId: string; metric: string; observations: number; total: number; average: number }> {
    return (this.database.prepare(`
      SELECT o.channel_id, r.metric, COUNT(*) AS observations, SUM(r.value) AS total, AVG(r.value) AS average
      FROM outcomes r JOIN opportunities o ON o.id = r.opportunity_id
      WHERE o.product_id = ? GROUP BY o.channel_id, r.metric ORDER BY observations DESC, total DESC
    `).all(productId) as Row[]).map((row) => ({
      channelId: String(row.channel_id), metric: String(row.metric), observations: Number(row.observations), total: Number(row.total), average: Number(row.average),
    }));
  }

  private recordEvent(type: string, entityType: string, entityId: string, detail: string, payload: Record<string, unknown> = {}): void {
    this.database.prepare(`
      INSERT INTO events (event_type, entity_type, entity_id, detail, payload_json, occurred_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(type, entityType, entityId || randomUUID(), detail, JSON.stringify(payload), now());
  }
}
