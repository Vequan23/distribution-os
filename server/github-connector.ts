import type { DistributionDatabase } from "./database.ts";
import type { IngestedSource, SourceConnector } from "./domain.ts";

const GITHUB_API_VERSION = "2026-03-10";
const MAX_RESPONSE_BYTES = 4_000_000;

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface GitHubRepository {
  full_name: string;
  html_url: string;
  private: boolean;
  has_issues: boolean;
}

interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  body: string | null;
  body_text?: string | null;
  html_url: string;
  state: "open" | "closed";
  updated_at: string;
  pull_request?: unknown;
  user?: { login?: string };
  labels?: Array<string | { name?: string }>;
}

export interface GitHubRepositoryReference {
  owner: string;
  repo: string;
  fullName: string;
  sourceUrl: string;
}

export interface GitHubSyncResult {
  connector: SourceConnector;
  importedCount: number;
  inspectedCount: number;
}

function compact(value: string, limit: number): string {
  const normalized = value.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return normalized.length <= limit ? normalized : `${normalized.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

export function parseGitHubRepository(value: string): GitHubRepositoryReference {
  const input = value.trim();
  if (!input) throw new Error("Enter a GitHub repository URL or owner/repository.");
  let path = input;
  if (/^https?:\/\//i.test(input)) {
    const url = new URL(input);
    if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com") {
      throw new Error("Use an https://github.com repository URL.");
    }
    path = url.pathname;
  }
  const parts = path.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "").split("/");
  if (parts.length !== 2 || parts.some((part) => !/^[A-Za-z0-9_.-]+$/.test(part))) {
    throw new Error("GitHub repositories must use the owner/repository format.");
  }
  const [owner, repo] = parts;
  const fullName = `${owner}/${repo}`;
  return { owner, repo, fullName, sourceUrl: `https://github.com/${fullName}` };
}

async function readJson<T>(response: Response): Promise<T> {
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > MAX_RESPONSE_BYTES) throw new Error("GitHub returned more data than the connector can safely inspect.");
  const body = await response.text();
  if (Buffer.byteLength(body, "utf8") > MAX_RESPONSE_BYTES) throw new Error("GitHub returned more data than the connector can safely inspect.");
  if (!response.ok) {
    let detail = "";
    try { detail = String((JSON.parse(body) as { message?: string }).message || ""); } catch { detail = body; }
    if (response.status === 404) throw new Error("GitHub repository not found. Check the URL or configure GITHUB_TOKEN for a private repository.");
    if (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0") throw new Error("GitHub rate limit reached. Configure GITHUB_TOKEN or sync again after the reset window.");
    throw new Error(`GitHub request failed (${response.status})${detail ? `: ${compact(detail, 180)}` : "."}`);
  }
  return JSON.parse(body) as T;
}

function labels(issue: GitHubIssue): string {
  return (issue.labels || []).map((label) => typeof label === "string" ? label : label.name || "").filter(Boolean).slice(0, 4).join(", ");
}

export class GitHubConnectorService {
  private readonly database: DistributionDatabase;
  private readonly fetcher: Fetcher;

  constructor(
    database: DistributionDatabase,
    fetcher: Fetcher = fetch,
  ) {
    this.database = database;
    this.fetcher = fetcher;
  }

  private headers(): Record<string, string> {
    const token = process.env.GITHUB_TOKEN?.trim();
    return {
      accept: "application/vnd.github.full+json",
      "user-agent": "distribution-os-local-connector",
      "x-github-api-version": GITHUB_API_VERSION,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    };
  }

  private async request<T>(path: string): Promise<{ value: T; rateLimitRemaining: number | null }> {
    const response = await this.fetcher(`https://api.github.com${path}`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(12_000),
      redirect: "follow",
    });
    const value = await readJson<T>(response);
    const remaining = response.headers.get("x-ratelimit-remaining");
    return { value, rateLimitRemaining: remaining === null ? null : Number(remaining) };
  }

  async connect(productId: string, repositoryInput: string): Promise<GitHubSyncResult> {
    this.database.getProductContext(productId);
    const reference = parseGitHubRepository(repositoryInput);
    const repositoryResponse = await this.request<GitHubRepository>(`/repos/${encodeURIComponent(reference.owner)}/${encodeURIComponent(reference.repo)}`);
    const repository = repositoryResponse.value;
    if (repository.private && !process.env.GITHUB_TOKEN?.trim()) {
      throw new Error("Private GitHub repositories require GITHUB_TOKEN in the Distribution-OS service environment.");
    }
    const connector = this.database.upsertSourceConnector({
      productId,
      kind: "github",
      name: repository.full_name,
      externalId: repository.full_name.toLowerCase(),
      sourceUrl: repository.html_url,
    });
    if (!repository.has_issues) {
      return { connector: this.database.finishSourceSync(connector.id, 0, repositoryResponse.rateLimitRemaining), importedCount: 0, inspectedCount: 0 };
    }
    return this.sync(connector.id);
  }

  async sync(connectorId: string): Promise<GitHubSyncResult> {
    const connector = this.database.getSourceConnector(connectorId);
    const reference = parseGitHubRepository(connector.externalId);
    let rateLimitRemaining: number | null = null;
    try {
      const response = await this.request<GitHubIssue[]>(
        `/repos/${encodeURIComponent(reference.owner)}/${encodeURIComponent(reference.repo)}/issues?state=all&sort=updated&direction=desc&per_page=30`,
      );
      rateLimitRemaining = response.rateLimitRemaining;
      const issues = response.value.filter((issue) => !issue.pull_request).slice(0, 12);
      const sources: IngestedSource[] = issues.map((issue) => {
        const body = compact(issue.body_text || issue.body || "No issue body was provided.", 1_200);
        const metadata = [`#${issue.number}`, issue.state, issue.user?.login ? `by ${issue.user.login}` : "", labels(issue)].filter(Boolean).join(" · ");
        return {
          type: "url",
          label: `GitHub issue #${issue.number}: ${compact(issue.title, 160)}`,
          sourceUrl: issue.html_url,
          summary: compact(`${issue.title}. ${body}`, 620),
          excerpt: `${metadata}\nUpdated ${issue.updated_at}\n\n${body}`,
          classification: "audience-signal",
          confidence: issue.body ? 72 : 58,
        };
      });
      const result = sources.length
        ? this.database.addSignalCandidates(connector.productId, sources, {
          origin: "github",
          externalIds: issues.map((issue) => String(issue.id)),
        })
        : { insertedCount: 0, signalIds: [] };
      return {
        connector: this.database.finishSourceSync(connectorId, result.insertedCount, rateLimitRemaining),
        importedCount: result.insertedCount,
        inspectedCount: issues.length,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "GitHub sync failed.";
      this.database.failSourceSync(connectorId, message, rateLimitRemaining);
      throw error;
    }
  }
}
