import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { SecretStore } from "./contracts.ts";

const execFileAsync = promisify(execFile);

export class MacOsKeychainSecretStore implements SecretStore {
  private readonly service: string;
  private readonly account: string;
  private readonly platform: NodeJS.Platform;

  constructor(
    service: string,
    account: string,
    platform: NodeJS.Platform = process.platform,
  ) {
    if (!service.trim() || !account.trim()) throw new Error("Keychain service and account names are required.");
    this.service = service;
    this.account = account;
    this.platform = platform;
  }

  async read(): Promise<string | null> {
    if (this.platform !== "darwin") return null;
    try {
      const result = await execFileAsync("security", ["find-generic-password", "-w", "-s", this.service, "-a", this.account], { maxBuffer: 64 * 1024 });
      return result.stdout.trim() || null;
    } catch {
      return null;
    }
  }

  async write(secret: string): Promise<void> {
    if (this.platform !== "darwin") throw new Error("macOS Keychain is unavailable on this platform. Configure the provider credential through an environment variable instead.");
    await execFileAsync("security", ["add-generic-password", "-U", "-s", this.service, "-a", this.account, "-w", secret], { maxBuffer: 64 * 1024 });
  }

  async delete(): Promise<void> {
    if (this.platform !== "darwin") return;
    try {
      await execFileAsync("security", ["delete-generic-password", "-s", this.service, "-a", this.account], { maxBuffer: 64 * 1024 });
    } catch {
      // Deleting an absent credential is idempotent.
    }
  }
}
