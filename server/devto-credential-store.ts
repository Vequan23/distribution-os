import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const SERVICE = "dev.distribution-os.channel.devto";

export interface DevToCredentialStoreLike {
  read(): Promise<string | null>;
  write(secret: string): Promise<void>;
}

export class DevToCredentialStore implements DevToCredentialStoreLike {
  async read(): Promise<string | null> {
    if (process.platform !== "darwin") return null;
    try {
      const result = await execFileAsync("security", ["find-generic-password", "-w", "-s", SERVICE, "-a", "api-key"], { maxBuffer: 64 * 1024 });
      return result.stdout.trim() || null;
    } catch {
      return null;
    }
  }

  async write(secret: string): Promise<void> {
    if (process.platform !== "darwin") throw new Error("Secure DEV credential storage is unavailable on this platform. Use DEVTO_API_KEY instead.");
    await execFileAsync("security", ["add-generic-password", "-U", "-s", SERVICE, "-a", "api-key", "-w", secret], { maxBuffer: 64 * 1024 });
  }
}
