#!/usr/bin/env node

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export interface CliOptions {
  port: number;
  openBrowser: boolean;
  help: boolean;
}

export function parseCliOptions(args: string[], environment = process.env): CliOptions {
  let port = Number(environment.DISTRIBUTION_OS_PORT || 4191);
  let openBrowser = true;
  let help = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--help" || argument === "-h") help = true;
    else if (argument === "--no-open") openBrowser = false;
    else if (argument === "--port") port = Number(args[++index]);
    else if (argument.startsWith("--port=")) port = Number(argument.slice(7));
    else throw new Error(`Unknown option: ${argument}`);
  }

  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("Choose a port between 1 and 65535.");
  return { port, openBrowser, help };
}

export function browserLaunch(platform: NodeJS.Platform, url: string): { command: string; args: string[] } {
  if (platform === "darwin") return { command: "open", args: [url] };
  if (platform === "win32") return { command: "cmd", args: ["/d", "/s", "/c", "start", "", url] };
  return { command: "xdg-open", args: [url] };
}

export function cliHelp(): string {
  return [
    "Distribution OS",
    "",
    "Usage: distribution-os [options]",
    "",
    "Options:",
    "  --port <number>  Use a different local port",
    "  --no-open        Start without opening a browser",
    "  -h, --help       Show this help",
  ].join("\n");
}

async function serviceIsReady(url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(500) });
    if (!response.ok) return false;
    const value = await response.json() as { ok?: unknown };
    return value.ok === true;
  } catch {
    return false;
  }
}

function openBrowser(url: string): void {
  const launch = browserLaunch(process.platform, url);
  const opener = spawn(launch.command, launch.args, { detached: true, stdio: "ignore" });
  opener.on("error", () => console.warn(`Open ${url} in your browser.`));
  opener.unref();
}

function packagePaths(moduleUrl: string): { root: string; serverEntry: string; nodeArgs: string[]; compiled: boolean } {
  const cliFile = fileURLToPath(moduleUrl);
  const cliDirectory = dirname(cliFile);
  const compiled = basename(resolve(cliDirectory, "..")) === "dist-server";
  const root = compiled ? resolve(cliDirectory, "../..") : resolve(cliDirectory, "..");
  const serverEntry = compiled ? join(root, "dist-server", "server", "index.js") : join(root, "server", "index.ts");
  const nodeArgs = compiled ? ["--no-warnings", serverEntry] : ["--no-warnings", "--experimental-strip-types", serverEntry];
  return { root, serverEntry, nodeArgs, compiled };
}

async function waitUntilReady(url: string, child: ChildProcess, timeout = 30_000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await serviceIsReady(url)) return;
    if (child.exitCode !== null || child.signalCode !== null) {
      const reason = child.exitCode !== null ? `exit code ${child.exitCode}` : `signal ${child.signalCode}`;
      throw new Error(`The local service stopped with ${reason}.`);
    }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 100));
  }
  throw new Error(`The local service did not become ready at ${url}.`);
}

export async function runCli(args = process.argv.slice(2), moduleUrl = import.meta.url): Promise<number> {
  const options = parseCliOptions(args);
  if (options.help) {
    console.log(cliHelp());
    return 0;
  }

  const appUrl = `http://127.0.0.1:${options.port}`;
  if (await serviceIsReady(appUrl)) {
    console.log(`Distribution OS is already running at ${appUrl}`);
    if (options.openBrowser) openBrowser(appUrl);
    return 0;
  }

  const paths = packagePaths(moduleUrl);
  if (paths.compiled && !existsSync(join(paths.root, "dist", "index.html"))) throw new Error("Build Distribution OS first with npm run build.");
  if (!existsSync(paths.serverEntry)) throw new Error("The Distribution OS service build is missing. Run npm run build.");

  const child = spawn(process.execPath, paths.nodeArgs, {
    cwd: paths.root,
    env: { ...process.env, DISTRIBUTION_OS_PORT: String(options.port) },
    stdio: "inherit",
  });
  let stopRequested = false;
  const stop = (signal: NodeJS.Signals) => {
    stopRequested = true;
    child.kill(signal);
  };
  const stopOnInterrupt = () => stop("SIGINT");
  const stopOnTerminate = () => stop("SIGTERM");
  process.once("SIGINT", stopOnInterrupt);
  process.once("SIGTERM", stopOnTerminate);

  try {
    try {
      await waitUntilReady(appUrl, child);
    } catch (error) {
      if (stopRequested) return 0;
      throw error;
    }
    if (stopRequested) return 0;
    console.log(`Distribution OS is open at ${appUrl}`);
    if (options.openBrowser) openBrowser(appUrl);
    return await new Promise(resolveExit => child.once("exit", code => resolveExit(code ?? 0)));
  } finally {
    process.off("SIGINT", stopOnInterrupt);
    process.off("SIGTERM", stopOnTerminate);
    if (child.exitCode === null && !child.killed) child.kill("SIGTERM");
  }
}

export function isCliEntrypoint(moduleUrl: string, entrypoint = process.argv[1]): boolean {
  if (!entrypoint) return false;
  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(resolve(entrypoint));
  } catch {
    return moduleUrl === pathToFileURL(resolve(entrypoint)).href;
  }
}

if (isCliEntrypoint(import.meta.url)) {
  runCli().then(code => {
    process.exitCode = code;
  }).catch(error => {
    console.error(error instanceof Error ? error.message : "Distribution OS could not start.");
    process.exitCode = 1;
  });
}
