import type { OAuthCredential, OAuthProviderDefinition, VerifiedConnection } from "../packages/connection-broker/src/index.ts";

const LINKEDIN_USERINFO = "https://api.linkedin.com/v2/userinfo";

interface LinkedInIdentity {
  sub?: string;
  name?: string;
  given_name?: string;
  family_name?: string;
}

function checkedMemberIdentity(identity: LinkedInIdentity): VerifiedConnection {
  if (!identity.sub || !/^[A-Za-z0-9_-]+$/.test(identity.sub)) throw new Error("LinkedIn did not return a valid member identity. Confirm the app has Sign in with LinkedIn access.");
  const accountName = identity.name?.trim() || [identity.given_name, identity.family_name].filter(Boolean).join(" ").trim() || "LinkedIn member";
  return { accountId: `urn:li:person:${identity.sub}`, accountName, capabilities: ["identity", "publish"] };
}

export async function verifyLinkedInCredential(credential: OAuthCredential, fetcher: typeof fetch = fetch): Promise<VerifiedConnection> {
  if (!credential.scopes.includes("w_member_social")) throw new Error("LinkedIn did not grant publishing access. Enable Share on LinkedIn and reconnect.");
  const response = await fetcher(LINKEDIN_USERINFO, {
    signal: AbortSignal.timeout(15_000),
    headers: { authorization: `Bearer ${credential.accessToken}`, accept: "application/json", "user-agent": "Distribution-OS/0.1 linkedin-connection" },
  });
  if (!response.ok) throw new Error(`LinkedIn identity verification returned ${response.status}.`);
  return checkedMemberIdentity(await response.json() as LinkedInIdentity);
}

export function createLinkedInOAuthProvider(fetcher: typeof fetch = fetch): OAuthProviderDefinition {
  return {
    id: "linkedin",
    name: "LinkedIn",
    issuer: "https://www.linkedin.com/oauth",
    authorizationEndpoint: "https://www.linkedin.com/oauth/native-pkce/authorization",
    tokenEndpoint: "https://www.linkedin.com/oauth/v2/accessToken",
    jwksUri: "https://www.linkedin.com/oauth/openid/jwks",
    scopes: ["openid", "profile", "w_member_social"],
    verify: (credential) => verifyLinkedInCredential(credential, fetcher),
  };
}

export function legacyLinkedInCredential(accessToken: string): OAuthCredential {
  return { providerId: "linkedin", accessToken, scopes: ["openid", "profile", "w_member_social"], clientId: "manual-token" };
}
