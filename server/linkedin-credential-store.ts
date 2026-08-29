import { MacOsKeychainSecretStore } from "../packages/connection-broker/src/index.ts";

export interface LinkedInCredentialStoreLike {
  read(): Promise<string | null>;
  write(secret: string): Promise<void>;
  delete?(): Promise<void>;
}

export class LinkedInCredentialStore extends MacOsKeychainSecretStore implements LinkedInCredentialStoreLike {
  constructor() {
    super("dev.distribution-os.channel.linkedin", "access-token");
  }
}
