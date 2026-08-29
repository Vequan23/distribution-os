export type ConnectionCapability = "identity" | "publish" | "measure";

export interface OAuthCredential {
  providerId: string;
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  expiresAt?: string;
  scopes: string[];
  clientId: string;
}

export interface VerifiedConnection {
  accountId: string;
  accountName: string;
  capabilities: ConnectionCapability[];
}

export interface SecretStore {
  read(): Promise<string | null>;
  write(secret: string): Promise<void>;
  delete(): Promise<void>;
}

export interface OAuthProviderDefinition {
  id: string;
  name: string;
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri?: string;
  scopes: string[];
  verify(credential: OAuthCredential): Promise<VerifiedConnection>;
}

export type OAuthSessionStatus = "waiting" | "connected" | "failed" | "expired";

export interface OAuthSessionSnapshot {
  id: string;
  providerId: string;
  providerName: string;
  status: OAuthSessionStatus;
  authorizationUrl: string;
  expiresAt: string;
  browserOpened: boolean;
  connection?: VerifiedConnection;
  error?: string;
}

export interface BrowserLauncher {
  open(url: string): Promise<boolean>;
}

export interface OAuthConnectionBrokerOptions {
  providers: OAuthProviderDefinition[];
  secretStore(providerId: string): SecretStore;
  browserLauncher: BrowserLauncher;
  onConnected?: (providerId: string, connection: VerifiedConnection) => Promise<void> | void;
  onDisconnected?: (providerId: string) => Promise<void> | void;
  fetcher?: typeof fetch;
  sessionTtlMs?: number;
  now?: () => Date;
}
