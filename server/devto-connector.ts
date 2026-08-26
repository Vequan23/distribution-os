import type { DistributionDatabase } from "./database.ts";
import { DevToCredentialStore, type DevToCredentialStoreLike } from "./devto-credential-store.ts";

const DEV_API = "https://dev.to/api";
const ACCEPT = "application/vnd.forem.api-v1+json";
type Fetcher = typeof fetch;

interface DevArticle {
  id: number;
  title: string;
  description?: string;
  url: string;
  published_at?: string;
  published_timestamp?: string;
  comments_count?: number;
  public_reactions_count?: number;
  positive_reactions_count?: number;
  page_views_count?: number;
}

async function devJson<T>(fetcher: Fetcher, path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetcher(`${DEV_API}${path}`, {
    ...options,
    signal: AbortSignal.timeout(15_000),
    headers: {
      accept: ACCEPT,
      "content-type": "application/json",
      "user-agent": "Distribution-OS/0.1 governed-dev-connector",
      ...options.headers,
    },
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`DEV API returned ${response.status}${detail ? `: ${detail}` : ""}`);
  }
  return await response.json() as T;
}

export class DevToConnector {
  private readonly database: DistributionDatabase;
  private readonly fetcher: Fetcher;
  private readonly credentialStore: DevToCredentialStoreLike;

  constructor(
    database: DistributionDatabase,
    fetcher: Fetcher = fetch,
    credentialStore: DevToCredentialStoreLike = new DevToCredentialStore(),
  ) {
    this.database = database;
    this.fetcher = fetcher;
    this.credentialStore = credentialStore;
  }

  private async apiKey(): Promise<string> {
    return process.env.DEVTO_API_KEY?.trim() || await this.credentialStore.read() || "";
  }

  async saveApiKey(value: string): Promise<void> {
    const apiKey = value.trim();
    if (apiKey.length < 12 || apiKey.length > 500) throw new Error("Enter a valid DEV API key.");
    await devJson(this.fetcher, "/users/me", { headers: { "api-key": apiKey } });
    await this.credentialStore.write(apiKey);
    this.database.setDevToCredentialSource("keychain");
  }

  async connectAndSync(productId: string, signalQuery: string, publishTags: string[]): Promise<{ imported: number }> {
    this.database.configureDevToConnection(productId, signalQuery, publishTags);
    return { imported: await this.syncSignals(productId) };
  }

  async syncSignals(productId: string): Promise<number> {
    const { signalQuery } = this.database.getDevToConnection();
    if (!signalQuery) return 0;
    const query = new URLSearchParams({ q: signalQuery, top: "30", per_page: "8" });
    const articles = await devJson<DevArticle[]>(this.fetcher, `/articles/search?${query.toString()}`);
    return this.database.importDevToSignals(productId, articles.map((article) => ({
      id: article.id,
      title: article.title,
      description: article.description || article.title,
      url: article.url,
      publishedAt: article.published_at || article.published_timestamp || new Date().toISOString(),
      reactions: article.public_reactions_count ?? article.positive_reactions_count ?? 0,
      comments: article.comments_count ?? 0,
    })));
  }

  async executeApproved(opportunityId: string): Promise<{ externalId: string; externalUrl: string }> {
    const apiKey = await this.apiKey();
    if (!apiKey) throw new Error("Add and verify a DEV API key in Channels before publishing.");
    const pending = this.database.beginDevToExecution(opportunityId);
    let article: DevArticle;
    try {
      article = await devJson<DevArticle>(this.fetcher, "/articles", {
        method: "POST",
        headers: { "api-key": apiKey },
        body: JSON.stringify({ article: { title: pending.title, body_markdown: pending.bodyMarkdown, published: true, tags: pending.publishTags.join(",") } }),
      });
      if (!article.id || !article.url) throw new Error("DEV returned an incomplete publication receipt.");
    } catch (error) {
      this.database.failDevToExecution(pending.executionId, error instanceof Error ? error.message : String(error));
      throw error;
    }
    this.database.finishDevToExecution(pending.executionId, String(article.id), article.url, { publishedAt: article.published_at || article.published_timestamp || "" });
    this.database.recordConnectorOutcomes(pending.executionId, opportunityId, [
      { metric: "views", value: article.page_views_count ?? 0 },
      { metric: "reactions", value: article.public_reactions_count ?? article.positive_reactions_count ?? 0 },
      { metric: "comments", value: article.comments_count ?? 0 },
    ]);
    return { externalId: String(article.id), externalUrl: article.url };
  }

  async syncOutcomes(): Promise<number> {
    const executions = this.database.getPublishedDevToExecutions();
    if (!executions.length) return 0;
    const apiKey = await this.apiKey();
    const ownArticles = apiKey ? await devJson<DevArticle[]>(this.fetcher, "/articles/me/all?per_page=1000", { headers: { "api-key": apiKey } }) : [];
    for (const execution of executions) {
      const article = ownArticles.find((item) => String(item.id) === execution.externalId)
        ?? await devJson<DevArticle>(this.fetcher, `/articles/${encodeURIComponent(execution.externalId)}`);
      this.database.recordConnectorOutcomes(execution.id, execution.opportunityId, [
        { metric: "views", value: article.page_views_count ?? 0 },
        { metric: "reactions", value: article.public_reactions_count ?? article.positive_reactions_count ?? 0 },
        { metric: "comments", value: article.comments_count ?? 0 },
      ]);
    }
    return executions.length;
  }
}
