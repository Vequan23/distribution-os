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
    this.seed();
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
  }

  private seed(): void {
    const count = this.database.prepare("SELECT COUNT(*) AS count FROM products").get() as Row;
    if (Number(count.count) > 0) return;

    const createdAt = now();
    const insertProduct = this.database.prepare(`
      INSERT INTO products (id, name, description, stage, repository_url, website_url, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insertProduct.run(
      "osx-components",
      "OSX Components",
      "Accessible Vue-authored web components for distinctive product and agent interfaces.",
      "open-source",
      "https://github.com/Vequan23/osx-components",
      "https://osx-components.vercel.app/",
      createdAt,
    );
    insertProduct.run(
      "aperta",
      "Aperta",
      "A model-agnostic comprehension and ownership harness for AI-generated code.",
      "public-beta",
      "https://github.com/Vequan23/aperta",
      "https://aperta-six.vercel.app/",
      createdAt,
    );

    const insertEvidence = this.database.prepare(`
      INSERT INTO evidence (id, product_id, kind, title, summary, source_url, occurred_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const evidenceRows = [
      ["osx-agent-primitives", "osx-components", "release", "Agent-native UI primitives", "Thinking, plan, artifact, citation, source panel, and streaming Markdown components now form a coherent agent UI layer.", "https://github.com/Vequan23/osx-components", createdAt],
      ["osx-vue-elements", "osx-components", "architecture", "Vue-authored, framework-neutral", "The library uses Vue custom elements so React, Svelte, Astro, and plain HTML consumers share the same accessible implementation.", "https://osx-components.vercel.app/components", createdAt],
      ["aperta-proof-graph", "aperta", "capability", "Evidence-backed comprehension", "Aperta connects code changes, verification, ownership reviews, and retained understanding in a local proof graph.", "https://github.com/Vequan23/aperta", createdAt],
      ["aperta-beta-two", "aperta", "release", "Beta harness reliability upgrade", "The current beta improves local storage, initialization feedback, syntax coverage, adjustable ownership panes, and icon consistency.", "https://www.npmjs.com/package/aperta-cli", createdAt],
    ];
    for (const row of evidenceRows) insertEvidence.run(...row);

    const insertChannel = this.database.prepare(`
      INSERT INTO channels (id, name, handle, mode, status, daily_limit, connected, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertChannel.run("linkedin", "LinkedIn", "Personal profile", "approval", "manual", 1, 0, createdAt);
    insertChannel.run("bluesky", "Bluesky", "Not connected", "approval", "planned", 2, 0, createdAt);
    insertChannel.run("x", "X", "Not connected", "approval", "planned", 2, 0, createdAt);
    insertChannel.run("devto", "Dev.to", "Draft export", "draft", "manual", 1, 0, createdAt);

    const insertOpportunity = this.database.prepare(`
      INSERT INTO opportunities (
        id, product_id, channel_id, type, title, context, why_now, suggested_angle, audience,
        source_url, draft_copy, relevance_score, value_score, freshness_score, promotion_risk,
        score, status, discovered_at, evidence_ids_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?)
    `);

    const opportunities = [
      {
        id: "agent-ui-primitives",
        productId: "osx-components",
        channelId: "linkedin",
        type: "owned-post",
        title: "Explain why agent interfaces need primitives beyond chat bubbles",
        context: "OSX Components now includes a complete set of agent-native primitives, creating a concrete technical story rather than a generic release announcement.",
        whyNow: "The component set has crossed the threshold from individual controls into a coherent agent application layer.",
        angle: "Teach the interface architecture: reasoning disclosure, plans, tool activity, artifacts, sources, and approval gates are separate interaction contracts.",
        audience: "Frontend engineers, design-system teams, and AI product builders",
        sourceUrl: "https://osx-components.vercel.app/components",
        draft: "Chat bubbles are not an agent interface.\n\nA capable agent UI needs distinct contracts for reasoning summaries, plans, tool activity, approvals, artifacts, citations, and streaming output. We built those contracts as framework-neutral web components—authored in Vue, usable anywhere.\n\nThe interesting design problem is not making AI look busy. It is making autonomy legible enough for a person to understand and control.",
        relevance: 96,
        value: 92,
        freshness: 98,
        risk: 12,
        evidenceIds: ["osx-agent-primitives", "osx-vue-elements"],
      },
      {
        id: "comprehension-bottleneck",
        productId: "aperta",
        channelId: "bluesky",
        type: "owned-post",
        title: "Make the case that comprehension is the next AI coding bottleneck",
        context: "Aperta has enough working harness behavior to support a grounded point of view about code ownership after generation.",
        whyNow: "The beta release provides current evidence and a public installation path.",
        angle: "Lead with the problem engineers feel after code generation, then show the proof-and-ownership loop without turning the post into a launch pitch.",
        audience: "Developers using coding agents and maintainers reviewing AI-authored changes",
        sourceUrl: "https://aperta-six.vercel.app/",
        draft: "AI coding is making generation cheap. The next bottleneck is knowing whether anyone actually understands what was generated.\n\nTests prove behavior. They do not prove that the person shipping the change can trace it, debug it, or explain its risks.\n\nThat gap—between working code and owned code—is where the next generation of developer tooling has to operate.",
        relevance: 93,
        value: 91,
        freshness: 94,
        risk: 9,
        evidenceIds: ["aperta-proof-graph", "aperta-beta-two"],
      },
      {
        id: "streaming-markdown-guide",
        productId: "osx-components",
        channelId: "devto",
        type: "durable-content",
        title: "Publish a practical guide to streaming-safe agent Markdown",
        context: "The Markdown component solves a difficult implementation problem with code blocks, tables, partial syntax, copying, and injection safety.",
        whyNow: "The implementation and component explorer provide enough detail for a durable technical article with working examples.",
        angle: "Explain the failure modes first, then present a component contract and framework-neutral implementation strategy.",
        audience: "Engineers building chat and agent interfaces",
        sourceUrl: "https://osx-components.vercel.app/components#story-osx-markdown",
        draft: "# Streaming Markdown is a state machine, not a formatting pass\n\nMost Markdown renderers assume the document is complete. Agent output violates that assumption on every token. A useful renderer must tolerate unfinished fences, partial tables, unsafe HTML, and code blocks whose copy action should remain stable while text is still arriving...",
        relevance: 89,
        value: 96,
        freshness: 87,
        risk: 5,
        evidenceIds: ["osx-agent-primitives"],
      },
    ];

    for (const opportunity of opportunities) {
      const score = scoreOpportunity({
        relevance: opportunity.relevance,
        value: opportunity.value,
        freshness: opportunity.freshness,
        promotionRisk: opportunity.risk,
      });
      insertOpportunity.run(
        opportunity.id,
        opportunity.productId,
        opportunity.channelId,
        opportunity.type,
        opportunity.title,
        opportunity.context,
        opportunity.whyNow,
        opportunity.angle,
        opportunity.audience,
        opportunity.sourceUrl,
        opportunity.draft,
        opportunity.relevance,
        opportunity.value,
        opportunity.freshness,
        opportunity.risk,
        score,
        createdAt,
        JSON.stringify(opportunity.evidenceIds),
      );
    }

    this.recordEvent("system.initialized", "system", "local", "Local distribution ledger initialized with two products and three evidence-backed moves.");
  }

  getDashboard(): DashboardState {
    const productRows = this.database.prepare(`
      SELECT p.*, COUNT(e.id) AS evidence_count
      FROM products p LEFT JOIN evidence e ON e.product_id = p.id
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
      ORDER BY CASE o.status WHEN 'ready' THEN 0 WHEN 'approved' THEN 1 WHEN 'published' THEN 2 ELSE 3 END,
               o.score DESC, o.discovered_at DESC
    `).all() as Row[];

    const evidenceStatement = this.database.prepare(`
      SELECT id, kind, title, summary, source_url, occurred_at FROM evidence WHERE id = ?
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
        (SELECT COUNT(*) FROM opportunities WHERE status = 'ready') AS ready_moves,
        (SELECT COUNT(*) FROM opportunities WHERE status = 'approved') AS approved_moves,
        (SELECT COUNT(*) FROM evidence) AS evidence_items,
        (SELECT COUNT(*) FROM channels WHERE connected = 1) AS connected_channels
    `).get() as Row;

    const eventRows = this.database.prepare("SELECT * FROM events ORDER BY occurred_at DESC, id DESC LIMIT 8").all() as Row[];
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
    this.recordEvent("signals.refreshed", "system", "scout", "Product evidence and opportunity signals refreshed locally.");
  }

  private recordEvent(type: string, entityType: string, entityId: string, detail: string, payload: Record<string, unknown> = {}): void {
    this.database.prepare(`
      INSERT INTO events (event_type, entity_type, entity_id, detail, payload_json, occurred_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(type, entityType, entityId || randomUUID(), detail, JSON.stringify(payload), now());
  }
}
