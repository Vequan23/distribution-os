import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import * as client from "openid-client";
import type { OAuthConnectionBrokerOptions, OAuthCredential, OAuthProviderDefinition, OAuthSessionSnapshot } from "./contracts.ts";
import { decodeOAuthCredential, encodeOAuthCredential } from "./credential.ts";

interface PendingSession {
  snapshot: OAuthSessionSnapshot;
  provider: OAuthProviderDefinition;
  configuration: client.Configuration;
  codeVerifier: string;
  state: string;
  redirectUri: string;
  clientId: string;
  server: Server;
  expiryTimer: NodeJS.Timeout;
  inFlight: boolean;
}

const LOOPBACK_HOST = "127.0.0.1";
const CALLBACK_PREFIX = "/oauth/callback/";

function publicSnapshot(session: PendingSession): OAuthSessionSnapshot {
  return structuredClone(session.snapshot);
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/(access_token|refresh_token|client_secret|code)=?[^\s&,]*/gi, "$1=[redacted]").slice(0, 500) || "Authorization failed.";
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]!);
}

function validClientId(value: string): string {
  const clientId = value.trim();
  if (!clientId || clientId.length > 256 || /[\s\u0000-\u001f]/.test(clientId)) throw new Error("Enter the OAuth client ID issued by the provider.");
  return clientId;
}

export class OAuthConnectionBroker {
  private readonly providers = new Map<string, OAuthProviderDefinition>();
  private readonly sessions = new Map<string, PendingSession>();
  private readonly options: OAuthConnectionBrokerOptions;

  constructor(options: OAuthConnectionBrokerOptions) {
    if (!options.providers.length) throw new Error("At least one OAuth provider is required.");
    for (const provider of options.providers) {
      if (this.providers.has(provider.id)) throw new Error(`Duplicate OAuth provider: ${provider.id}`);
      this.providers.set(provider.id, provider);
    }
    this.options = options;
  }

  async start(providerId: string, rawClientId: string): Promise<OAuthSessionSnapshot> {
    const provider = this.providers.get(providerId);
    if (!provider) throw new Error("This OAuth provider is not registered.");
    const clientId = validClientId(rawClientId);
    const sessionId = randomUUID();
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, LOOPBACK_HOST, () => {
        server.off("error", reject);
        resolve();
      });
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      server.close();
      throw new Error("Could not reserve a local OAuth callback port.");
    }
    const redirectUri = `http://${LOOPBACK_HOST}:${address.port}${CALLBACK_PREFIX}${encodeURIComponent(provider.id)}`;
    const configuration = this.configuration(provider, clientId);
    const codeVerifier = client.randomPKCECodeVerifier();
    const state = client.randomState();
    const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
    const authorizationUrl = client.buildAuthorizationUrl(configuration, {
      response_type: "code",
      redirect_uri: redirectUri,
      scope: provider.scopes.join(" "),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    }).href;
    const now = this.options.now?.() ?? new Date();
    const ttl = this.options.sessionTtlMs ?? 5 * 60_000;
    const snapshot: OAuthSessionSnapshot = {
      id: sessionId,
      providerId,
      providerName: provider.name,
      status: "waiting",
      authorizationUrl,
      expiresAt: new Date(now.getTime() + ttl).toISOString(),
      browserOpened: false,
    };
    const session = {
      snapshot, provider, configuration, codeVerifier, state, redirectUri, clientId, server,
      expiryTimer: setTimeout(() => this.expire(sessionId), ttl), inFlight: false,
    } satisfies PendingSession;
    this.sessions.set(sessionId, session);
    server.on("request", (request, response) => void this.handleCallback(sessionId, request.url || "/", response));
    try {
      snapshot.browserOpened = await this.options.browserLauncher.open(authorizationUrl);
    } catch {
      snapshot.browserOpened = false;
    }
    return publicSnapshot(session);
  }

  getSession(sessionId: string): OAuthSessionSnapshot {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("This connection session no longer exists. Start again.");
    return publicSnapshot(session);
  }

  async disconnect(providerId: string): Promise<void> {
    if (!this.providers.has(providerId)) throw new Error("This OAuth provider is not registered.");
    await this.options.secretStore(providerId).delete();
    await this.options.onDisconnected?.(providerId);
  }

  async refresh(providerId: string): Promise<import("./contracts.ts").VerifiedConnection> {
    const provider = this.providers.get(providerId);
    if (!provider) throw new Error("This OAuth provider is not registered.");
    const store = this.options.secretStore(providerId);
    const previousSecret = await store.read() || "";
    const credential = decodeOAuthCredential(previousSecret);
    if (!credential?.refreshToken) throw new Error(`${provider.name} did not issue a refresh token. Reconnect the account.`);
    const configuration = this.configuration(provider, credential.clientId);
    const tokens = await client.refreshTokenGrant(configuration, credential.refreshToken);
    if (!tokens.access_token) throw new Error("The provider returned no refreshed access token.");
    const now = this.options.now?.() ?? new Date();
    const refreshed: OAuthCredential = {
      providerId,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || credential.refreshToken,
      tokenType: tokens.token_type || credential.tokenType,
      expiresAt: typeof tokens.expires_in === "number" ? new Date(now.getTime() + tokens.expires_in * 1_000).toISOString() : credential.expiresAt,
      scopes: typeof tokens.scope === "string" ? tokens.scope.split(/\s+/).filter(Boolean) : credential.scopes,
      clientId: credential.clientId,
    };
    const connection = await provider.verify(refreshed);
    await store.write(encodeOAuthCredential(refreshed));
    try {
      await this.options.onConnected?.(providerId, connection);
    } catch (error) {
      await store.write(previousSecret);
      throw error;
    }
    return connection;
  }

  close(): void {
    for (const session of this.sessions.values()) {
      clearTimeout(session.expiryTimer);
      session.server.close();
    }
    this.sessions.clear();
  }

  private expire(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.snapshot.status !== "waiting" || session.inFlight) return;
    session.snapshot.status = "expired";
    session.snapshot.error = "The connection window expired. Start again.";
    session.server.close();
    this.scheduleRemoval(sessionId);
  }

  private configuration(provider: OAuthProviderDefinition, clientId: string): client.Configuration {
    const configuration = new client.Configuration({
      issuer: provider.issuer,
      authorization_endpoint: provider.authorizationEndpoint,
      token_endpoint: provider.tokenEndpoint,
      jwks_uri: provider.jwksUri,
      code_challenge_methods_supported: ["S256"],
    }, clientId, { token_endpoint_auth_method: "none" }, client.None());
    if (this.options.fetcher) configuration[client.customFetch] = this.options.fetcher;
    configuration.timeout = 15;
    return configuration;
  }

  private async handleCallback(sessionId: string, requestUrl: string, response: import("node:http").ServerResponse): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || session.snapshot.status !== "waiting") {
      this.callbackPage(response, 410, "Connection expired", "Return to Distribution OS and start again.");
      return;
    }
    const callback = new URL(requestUrl, session.redirectUri);
    if (callback.pathname !== `${CALLBACK_PREFIX}${encodeURIComponent(session.provider.id)}`) {
      this.callbackPage(response, 404, "Unknown callback", "This local address is reserved for the active connection.");
      return;
    }
    if (session.inFlight) {
      this.callbackPage(response, 410, "Connection already used", "Return to Distribution OS to review the connection.");
      return;
    }
    session.inFlight = true;
    clearTimeout(session.expiryTimer);
    try {
      const tokens = await client.authorizationCodeGrant(session.configuration, callback, {
        pkceCodeVerifier: session.codeVerifier,
        expectedState: session.state,
      });
      if (!tokens.access_token) throw new Error("The provider returned no access token.");
      const expiresAt = typeof tokens.expires_in === "number"
        ? new Date((this.options.now?.() ?? new Date()).getTime() + tokens.expires_in * 1_000).toISOString()
        : undefined;
      const credential: OAuthCredential = {
        providerId: session.provider.id,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenType: tokens.token_type,
        expiresAt,
        scopes: typeof tokens.scope === "string" ? tokens.scope.split(/\s+/).filter(Boolean) : [...session.provider.scopes],
        clientId: session.clientId,
      };
      const connection = await session.provider.verify(credential);
      const store = this.options.secretStore(session.provider.id);
      await store.write(encodeOAuthCredential(credential));
      try {
        await this.options.onConnected?.(session.provider.id, connection);
      } catch (error) {
        await store.delete();
        throw error;
      }
      session.snapshot.status = "connected";
      session.snapshot.connection = connection;
      this.callbackPage(response, 200, `${session.provider.name} connected`, "You can close this tab and return to Distribution OS.");
    } catch (error) {
      session.snapshot.status = "failed";
      session.snapshot.error = safeError(error);
      this.callbackPage(response, 400, "Connection failed", "Return to Distribution OS to review the error and try again.");
    } finally {
      session.server.close();
      this.scheduleRemoval(sessionId);
    }
  }

  private scheduleRemoval(sessionId: string): void {
    const timer = setTimeout(() => this.sessions.delete(sessionId), 10 * 60_000);
    timer.unref();
  }

  private callbackPage(response: import("node:http").ServerResponse, status: number, title: string, detail: string): void {
    response.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
    response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title><body style="margin:0;background:#10171b;color:#e6eef2;font:16px system-ui;display:grid;min-height:100vh;place-items:center"><main style="max-width:34rem;padding:2rem"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(detail)}</p></main></body></html>`);
  }
}
