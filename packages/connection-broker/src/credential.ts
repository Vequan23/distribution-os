import type { OAuthCredential } from "./contracts.ts";

const CREDENTIAL_VERSION = 1;

interface StoredOAuthCredential extends OAuthCredential {
  version: number;
}

export function encodeOAuthCredential(credential: OAuthCredential): string {
  return JSON.stringify({ version: CREDENTIAL_VERSION, ...credential } satisfies StoredOAuthCredential);
}

export function decodeOAuthCredential(value: string): OAuthCredential | null {
  try {
    const parsed = JSON.parse(value) as Partial<StoredOAuthCredential>;
    if (parsed.version !== CREDENTIAL_VERSION || typeof parsed.providerId !== "string" || typeof parsed.accessToken !== "string" || typeof parsed.clientId !== "string" || !Array.isArray(parsed.scopes)) return null;
    return {
      providerId: parsed.providerId,
      accessToken: parsed.accessToken,
      refreshToken: typeof parsed.refreshToken === "string" ? parsed.refreshToken : undefined,
      tokenType: typeof parsed.tokenType === "string" ? parsed.tokenType : undefined,
      expiresAt: typeof parsed.expiresAt === "string" ? parsed.expiresAt : undefined,
      scopes: parsed.scopes.filter((scope): scope is string => typeof scope === "string"),
      clientId: parsed.clientId,
    };
  } catch {
    return null;
  }
}

export function accessTokenFromSecret(value: string): string {
  return decodeOAuthCredential(value)?.accessToken ?? value;
}
