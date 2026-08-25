import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  scoreOpportunity,
  type Channel,
  type DashboardState,
  type DistributionEvent,
  type Evidence,
  type IngestedSource,
  type OnboardProductInput,
  type Opportunity,
  type OpportunityStatus,
  type Product,
} from "./domain.ts";

type Row = Record<string, string | number | null>;

function now(): string {
  return new Date().toISOString();
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

      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        detail TEXT NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}',
        occurred_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS opportunities_status_score_idx
        ON opportunities(status, score DESC, discovered_at DESC);
      CREATE INDEX IF NOT EXISTS evidence_product_idx
        ON evidence(product_id, occurred_at DESC);
      CREATE INDEX IF NOT EXISTS events_recent_idx
        ON events(occurred_at DESC);
    `);

    this.addColumn("products", "audience", "TEXT NOT NULL DEFAULT ''");
    this.addColumn("products", "objective", "TEXT NOT NULL DEFAULT ''");
    this.addColumn("products", "positioning", "TEXT NOT NULL DEFAULT ''");
    this.addColumn("products", "confidence", "INTEGER NOT NULL DEFAULT 0");
    this.addColumn("products", "onboarding_status", "TEXT NOT NULL DEFAULT 'draft'");
    this.addColumn("products", "is_demo", "INTEGER NOT NULL DEFAULT 0");
    this.addColumn("evidence", "source_type", "TEXT NOT NULL DEFAULT 'text'");
    this.addColumn("evidence", "classification", "TEXT NOT NULL DEFAULT 'intent'");
    this.addColumn("evidence", "confidence", "INTEGER NOT NULL DEFAULT 0");
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

    const productId = randomUUID();
    const createdAt = now();
    const sourceTypes = new Set(sources.map((source) => source.type));
    const sourceWeight = { repository: 30, url: 22, document: 16, text: 10 };
    const evidenceCoverage = [...sourceTypes].reduce((total, type) => total + sourceWeight[type], 0);
    const profileCoverage = 24 + (positioning ? 8 : 0);
    const corroboration = sources.length >= 3 ? 12 : sources.length === 2 ? 7 : 0;
    const confidence = Math.min(96, profileCoverage + evidenceCoverage + corroboration);

    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(`
        INSERT INTO products (
          id, name, description, stage, repository_url, website_url, audience, objective,
          positioning, confidence, onboarding_status, is_demo, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', 0, ?)
      `).run(
        productId,
        name,
        description,
        input.stage.trim() || "early",
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
      for (const source of sources) {
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
      const primarySource = sources[0];
      const draft = `${name} helps ${audience}.\n\n${description}\n\nCurrent objective: ${objective}\n\nEvidence to develop: ${primarySource.summary}`;
      this.database.prepare(`
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
        "product.onboarded",
        "product",
        productId,
        `${name} onboarded from ${sources.length} source${sources.length === 1 ? "" : "s"} with ${confidence}% evidence confidence.`,
        { sourceTypes: [...sourceTypes], confidence },
      );
      this.database.exec("COMMIT");
      return productId;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
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
      stage: String(row.stage),
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
        (SELECT COALESCE(ROUND(AVG(confidence)), 0) FROM products WHERE is_demo = 0) AS analysis_confidence,
        (SELECT COUNT(*) FROM channels WHERE connected = 1) AS connected_channels
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

    return {
      generatedAt: now(),
      storage: { mode: "local", location: this.databasePath },
      metrics: {
        readyMoves: Number(metricRow.ready_moves),
        approvedMoves: Number(metricRow.approved_moves),
        evidenceItems: Number(metricRow.evidence_items),
        connectedChannels: Number(metricRow.connected_channels),
        analysisConfidence: Number(metricRow.analysis_confidence),
      },
      onboarding: {
        required: products.length === 0,
        supportedSources: ["text", "url", "document", "repository"],
      },
      products,
      channels,
      opportunities,
      recentEvents,
    };
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
    this.recordEvent(
      `opportunity.${action}`,
      "opportunity",
      id,
      `${String(row.title)} ${action === "approve" ? "approved and queued" : action === "skip" ? "skipped for now" : "returned to the queue"}.`,
      { previousStatus: row.status, nextStatus },
    );
    return nextStatus;
  }

  recordRefresh(): void {
    this.recordEvent("evidence.reloaded", "system", "local", "Local product evidence was reloaded. External signal scouts are not configured yet.");
  }

  private recordEvent(type: string, entityType: string, entityId: string, detail: string, payload: Record<string, unknown> = {}): void {
    this.database.prepare(`
      INSERT INTO events (event_type, entity_type, entity_id, detail, payload_json, occurred_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(type, entityType, entityId || randomUUID(), detail, JSON.stringify(payload), now());
  }
}
