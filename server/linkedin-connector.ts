import type { DistributionDatabase } from "./database.ts";
import type { ChannelPublication, ChannelPublisher } from "./channel-publisher.ts";
import { LinkedInCredentialStore, type LinkedInCredentialStoreLike } from "./linkedin-credential-store.ts";
import { accessTokenFromSecret, decodeOAuthCredential } from "../packages/connection-broker/src/index.ts";
import { legacyLinkedInCredential, verifyLinkedInCredential } from "./linkedin-oauth.ts";

const LINKEDIN_API = "https://api.linkedin.com";
const LINKEDIN_VERSION = process.env.LINKEDIN_API_VERSION?.trim() || "202608";
type Fetcher = typeof fetch;

interface LinkedInSocialActions {
  likesSummary?: { totalLikes?: number };
  commentsSummary?: { totalFirstLevelComments?: number; aggregatedTotalComments?: number };
}

async function linkedInRequest(fetcher: Fetcher, token: string, path: string, options: RequestInit = {}): Promise<Response> {
  const response = await fetcher(`${LINKEDIN_API}${path}`, {
    ...options,
    signal: AbortSignal.timeout(15_000),
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json",
      "content-type": "application/json",
      "linkedin-version": LINKEDIN_VERSION,
      "x-restli-protocol-version": "2.0.0",
      "user-agent": "Distribution-OS/0.1 governed-linkedin-connector",
      ...options.headers,
    },
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`LinkedIn API returned ${response.status}${detail ? `: ${detail}` : ""}`);
  }
  return response;
}

export class LinkedInConnector implements ChannelPublisher {
  readonly channelId = "linkedin";
  private readonly database: DistributionDatabase;
  private readonly fetcher: Fetcher;
  private readonly credentialStore: LinkedInCredentialStoreLike;

  constructor(
    database: DistributionDatabase,
    fetcher: Fetcher = fetch,
    credentialStore: LinkedInCredentialStoreLike = new LinkedInCredentialStore(),
  ) {
    this.database = database;
    this.fetcher = fetcher;
    this.credentialStore = credentialStore;
  }

  private async accessToken(): Promise<string> {
    const stored = await this.credentialStore.read();
    const oauthCredential = stored ? decodeOAuthCredential(stored) : null;
    if (!process.env.LINKEDIN_ACCESS_TOKEN?.trim() && oauthCredential?.expiresAt && Date.parse(oauthCredential.expiresAt) <= Date.now()) {
      throw new Error("The LinkedIn connection expired. Reconnect it in Channels before publishing.");
    }
    const token = process.env.LINKEDIN_ACCESS_TOKEN?.trim() || (stored ? accessTokenFromSecret(stored) : "");
    if (!token) throw new Error("Connect and verify LinkedIn in Channels before publishing.");
    return token;
  }

  async saveAccessToken(value: string): Promise<void> {
    const token = value.trim();
    if (token.length < 20 || token.length > 4_000) throw new Error("Enter a valid LinkedIn access token.");
    const identity = await verifyLinkedInCredential(legacyLinkedInCredential(token), this.fetcher);
    await this.credentialStore.write(token);
    this.database.configureLinkedInIdentity(identity.accountId, identity.accountName, "keychain");
  }

  async executeApproved(opportunityId: string): Promise<ChannelPublication> {
    const token = await this.accessToken();
    if (!this.database.getLinkedInConnection().accountId) {
      const identity = await verifyLinkedInCredential(legacyLinkedInCredential(token), this.fetcher);
      this.database.configureLinkedInIdentity(identity.accountId, identity.accountName, "environment");
    }
    const pending = this.database.beginChannelExecution(opportunityId, this.channelId);
    let externalId = "";
    try {
      if ([...pending.draftCopy].length > 3_000) throw new Error("LinkedIn text posts must be 3,000 characters or fewer. Shorten the approved draft and approve it again.");
      const response = await linkedInRequest(this.fetcher, token, "/rest/posts", {
        method: "POST",
        body: JSON.stringify({
          author: pending.accountId,
          commentary: pending.draftCopy,
          visibility: "PUBLIC",
          distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
          lifecycleState: "PUBLISHED",
          isReshareDisabledByAuthor: false,
        }),
      });
      externalId = response.headers.get("x-restli-id")?.trim() || "";
      if (!externalId) throw new Error("LinkedIn returned no publication identifier, so Distribution OS cannot prove the post was published.");
    } catch (error) {
      this.database.failChannelExecution(pending.executionId, this.channelId, error instanceof Error ? error.message : String(error));
      throw error;
    }
    const externalUrl = `https://www.linkedin.com/feed/update/${externalId}/`;
    this.database.finishChannelExecution(pending.executionId, this.channelId, externalId, externalUrl, { apiVersion: LINKEDIN_VERSION });
    await this.captureOutcomes(token, pending.executionId, opportunityId, externalId);
    return { externalId, externalUrl };
  }

  async syncOutcomes(): Promise<number> {
    const executions = this.database.getPublishedChannelExecutions(this.channelId);
    if (!executions.length) return 0;
    const token = await this.accessToken();
    for (const execution of executions) await this.captureOutcomes(token, execution.id, execution.opportunityId, execution.externalId);
    return executions.length;
  }

  private async captureOutcomes(token: string, executionId: string, opportunityId: string, externalId: string): Promise<void> {
    try {
      const response = await linkedInRequest(this.fetcher, token, `/rest/socialActions/${encodeURIComponent(externalId)}`);
      const actions = await response.json() as LinkedInSocialActions;
      this.database.recordConnectorOutcomes(executionId, opportunityId, this.channelId, [
        { metric: "reactions", value: actions.likesSummary?.totalLikes ?? 0 },
        { metric: "comments", value: actions.commentsSummary?.aggregatedTotalComments ?? actions.commentsSummary?.totalFirstLevelComments ?? 0 },
      ]);
    } catch (error) {
      this.database.recordOutcomeSyncFailure(executionId, this.channelId, error instanceof Error ? error.message : String(error));
    }
  }
}
