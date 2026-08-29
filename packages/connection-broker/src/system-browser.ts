import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { BrowserLauncher } from "./contracts.ts";

const execFileAsync = promisify(execFile);

export function browserLaunchCommand(platform: NodeJS.Platform, url: string): { command: string; args: string[] } {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") throw new Error("Authorization must open on HTTPS.");
  if (platform === "darwin") return { command: "open", args: [url] };
  if (platform === "win32") return { command: "rundll32.exe", args: ["url.dll,FileProtocolHandler", url] };
  return { command: "xdg-open", args: [url] };
}

export class SystemBrowserLauncher implements BrowserLauncher {
  async open(url: string): Promise<boolean> {
    try {
      const launch = browserLaunchCommand(process.platform, url);
      await execFileAsync(launch.command, launch.args, { timeout: 10_000, maxBuffer: 16 * 1024 });
      return true;
    } catch {
      return false;
    }
  }
}
