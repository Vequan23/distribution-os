import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { browserLaunch, cliHelp, isCliEntrypoint, parseCliOptions } from "../server/cli.ts";

test("CLI options default to opening Distribution OS", () => {
  assert.deepEqual(parseCliOptions([], {}), { port: 4191, openBrowser: true, help: false });
  assert.deepEqual(parseCliOptions(["--no-open", "--port", "4400"], {}), { port: 4400, openBrowser: false, help: false });
  assert.deepEqual(parseCliOptions(["--port=4500", "--help"], {}), { port: 4500, openBrowser: true, help: true });
  assert.throws(() => parseCliOptions(["--port", "0"], {}), /between 1 and 65535/);
  assert.throws(() => parseCliOptions(["--unknown"], {}), /Unknown option/);
});

test("CLI uses the native browser opener for each platform", () => {
  const url = "http://127.0.0.1:4191";
  assert.deepEqual(browserLaunch("darwin", url), { command: "open", args: [url] });
  assert.deepEqual(browserLaunch("linux", url), { command: "xdg-open", args: [url] });
  assert.equal(browserLaunch("win32", url).command, "cmd");
  assert.match(cliHelp(), /distribution-os --no-open|--no-open/);
});

test("the npm package installs the distribution-os command", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as {
    name: string;
    bin: Record<string, string>;
    scripts: Record<string, string>;
    publishConfig: { access: string };
  };
  assert.equal(packageJson.name, "@vraxis/distribution-os");
  assert.equal(packageJson.bin["distribution-os"], "dist-server/server/cli.js");
  assert.equal(packageJson.scripts.prepack, "npm run build");
  assert.equal(packageJson.publishConfig.access, "public");
});

test("the CLI recognizes npm's symlinked command as its entry point", async t => {
  const directory = await mkdtemp(join(tmpdir(), "distribution-os-bin-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const modulePath = new URL("../server/cli.ts", import.meta.url);
  const commandPath = join(directory, "distribution-os");
  await symlink(modulePath, commandPath);
  assert.equal(isCliEntrypoint(modulePath.href, commandPath), true);
});

test("CLI starts the local app and serves its health endpoint", async t => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "distribution-os-cli-"));
  t.after(() => rm(dataDirectory, { recursive: true, force: true }));
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const address = reservation.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  reservation.close();
  await once(reservation, "close");

  const child = spawn(process.execPath, ["--no-warnings", "--experimental-strip-types", "server/cli.ts", "--no-open", "--port", String(port)], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, DISTRIBUTION_OS_DATA_DIR: dataDirectory },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", chunk => { output += String(chunk); });
  child.stderr.on("data", chunk => { output += String(chunk); });
  t.after(() => {
    if (child.exitCode === null) child.kill("SIGTERM");
  });

  const deadline = Date.now() + 30_000;
  let response: Response | undefined;
  while (Date.now() < deadline) {
    try {
      response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) break;
    } catch {}
    await new Promise(resolveDelay => setTimeout(resolveDelay, 100));
  }

  assert.equal(response?.status, 200, output);
  assert.equal((await response!.json() as { ok: boolean }).ok, true);
  while (!output.includes("Distribution OS is open") && Date.now() < deadline) {
    await new Promise(resolveDelay => setTimeout(resolveDelay, 50));
  }
  assert.match(output, /Distribution OS is open/, output);
  child.kill("SIGINT");
  await once(child, "exit");
  assert.equal(child.exitCode, 0, output);
});
