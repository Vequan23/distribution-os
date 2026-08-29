import { MacOsKeychainSecretStore } from "../packages/connection-broker/src/index.ts";

export interface DevToCredentialStoreLike {
  read(): Promise<string | null>;
  write(secret: string): Promise<void>;
  delete?(): Promise<void>;
}

export class DevToCredentialStore extends MacOsKeychainSecretStore implements DevToCredentialStoreLike {
  constructor() {
    super("dev.distribution-os.channel.devto", "api-key");
  }
}
