import assert from "node:assert/strict";
import test from "node:test";
import {
  OAuthConnectionBroker,
  accessTokenFromSecret,
  browserLaunchCommand,
  decodeOAuthCredential,
  encodeOAuthCredential,
  type SecretStore,
} from "../packages/connection-broker/src/index.ts";

class MemorySecretStore implements SecretStore {
  value: string | null = null;
  async read(): Promise<string | null> { return this.value; }
  async write(secret: string): Promise<void> { this.value = secret; }
  async delete(): Promise<void> { this.value = null; }
}

async function waitForStatus(broker: OAuthConnectionBroker, id: string, expected: "connected" | "failed"): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (broker.getSession(id).status === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`OAuth session did not reach ${expected}`);
}

test("OAuth connection broker binds PKCE and state, stores credentials opaquely, and disconnects", async () => {
  const store = new MemorySecretStore();
  let authorizationUrl = "";
  let tokenRequestBody = "";
  const connected: string[] = [];
  const disconnected: string[] = [];
  const broker = new OAuthConnectionBroker({
    providers: [{
      id: "example",
      name: "Example",
      issuer: "https://identity.example.test",
      authorizationEndpoint: "https://identity.example.test/oauth/authorize",
      tokenEndpoint: "https://identity.example.test/oauth/token",
      scopes: ["profile", "publish"],
      verify: async (credential) => {
        assert.ok(["access-secret-value", "refreshed-access-value"].includes(credential.accessToken));
        return { accountId: "account-42", accountName: "Founder", capabilities: ["identity", "publish"] };
      },
    }],
    secretStore: () => store,
    browserLauncher: { open: async (url) => { authorizationUrl = url; return false; } },
    fetcher: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      tokenRequestBody = await request.clone().text();
      if (tokenRequestBody.includes("grant_type=refresh_token")) {
        return Response.json({ access_token: "refreshed-access-value", token_type: "Bearer", expires_in: 7200, scope: "profile publish" }, { headers: { "cache-control": "no-store" } });
      }
      return Response.json({ access_token: "access-secret-value", refresh_token: "refresh-secret-value", token_type: "Bearer", expires_in: 3600, scope: "profile publish" }, { headers: { "cache-control": "no-store" } });
    },
    onConnected: (providerId, connection) => { connected.push(`${providerId}:${connection.accountId}`); },
    onDisconnected: (providerId) => { disconnected.push(providerId); },
  });
  try {
    const session = await broker.start("example", "public-client-id");
    assert.equal(session.status, "waiting");
    assert.equal(session.browserOpened, false);
    assert.equal(session.authorizationUrl, authorizationUrl);
    assert.doesNotMatch(JSON.stringify(session), /access-secret|refresh-secret/);
    const authorization = new URL(authorizationUrl);
    assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");
    assert.ok(authorization.searchParams.get("code_challenge"));
    assert.ok(authorization.searchParams.get("state"));
    assert.equal(authorization.searchParams.get("client_secret"), null);
    const redirectUri = authorization.searchParams.get("redirect_uri");
    assert.ok(redirectUri?.startsWith("http://127.0.0.1:"));

    const callback = new URL(redirectUri!);
    callback.searchParams.set("code", "single-use-code");
    callback.searchParams.set("state", authorization.searchParams.get("state")!);
    const callbackResponse = await fetch(callback);
    assert.equal(callbackResponse.status, 200);
    await waitForStatus(broker, session.id, "connected");
    assert.deepEqual(connected, ["example:account-42"]);
    assert.match(tokenRequestBody, /code_verifier=/);
    assert.match(tokenRequestBody, /client_id=public-client-id/);
    assert.doesNotMatch(tokenRequestBody, /client_secret=/);
    const credential = decodeOAuthCredential(store.value!);
    assert.equal(credential?.accessToken, "access-secret-value");
    assert.equal(credential?.refreshToken, "refresh-secret-value");
    assert.equal(accessTokenFromSecret(store.value!), "access-secret-value");

    const refreshedConnection = await broker.refresh("example");
    assert.equal(refreshedConnection.accountName, "Founder");
    assert.equal(decodeOAuthCredential(store.value!)?.accessToken, "refreshed-access-value");
    assert.equal(decodeOAuthCredential(store.value!)?.refreshToken, "refresh-secret-value", "rotating providers may omit a replacement refresh token");

    await broker.disconnect("example");
    assert.equal(store.value, null);
    assert.deepEqual(disconnected, ["example"]);
  } finally {
    broker.close();
  }
});

test("OAuth connection broker rejects a callback with the wrong state and stores nothing", async () => {
  const store = new MemorySecretStore();
  let tokenCalled = false;
  const broker = new OAuthConnectionBroker({
    providers: [{
      id: "example", name: "Example", issuer: "https://identity.example.test",
      authorizationEndpoint: "https://identity.example.test/oauth/authorize",
      tokenEndpoint: "https://identity.example.test/oauth/token", scopes: ["profile"],
      verify: async () => ({ accountId: "never", accountName: "Never", capabilities: ["identity"] }),
    }],
    secretStore: () => store,
    browserLauncher: { open: async () => true },
    fetcher: async () => { tokenCalled = true; return Response.json({ access_token: "unexpected" }); },
  });
  try {
    const session = await broker.start("example", "public-client-id");
    const authorization = new URL(session.authorizationUrl);
    const callback = new URL(authorization.searchParams.get("redirect_uri")!);
    callback.searchParams.set("code", "single-use-code");
    callback.searchParams.set("state", "wrong-state");
    assert.equal((await fetch(callback)).status, 400);
    await waitForStatus(broker, session.id, "failed");
    assert.equal(store.value, null);
    assert.equal(tokenCalled, false);
    assert.doesNotMatch(broker.getSession(session.id).error || "", /single-use-code/);
  } finally {
    broker.close();
  }
});

test("credential codec remains backward compatible with manually stored tokens", () => {
  assert.equal(accessTokenFromSecret("legacy-access-token"), "legacy-access-token");
  const encoded = encodeOAuthCredential({ providerId: "example", accessToken: "new-token", clientId: "client", scopes: [] });
  assert.equal(accessTokenFromSecret(encoded), "new-token");
});

test("system browser commands use argument vectors and require HTTPS authorization", () => {
  assert.deepEqual(browserLaunchCommand("darwin", "https://example.test/authorize"), { command: "open", args: ["https://example.test/authorize"] });
  assert.deepEqual(browserLaunchCommand("linux", "https://example.test/authorize"), { command: "xdg-open", args: ["https://example.test/authorize"] });
  assert.throws(() => browserLaunchCommand("darwin", "http://example.test/authorize"), /HTTPS/);
});
