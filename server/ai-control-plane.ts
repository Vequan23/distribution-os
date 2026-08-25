import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type {
  AgentRuntimeId,
  AgentRuntimeStatus,
  AIControlPlane,
  AIExecutionProfile,
  ModelProfile,
  ModelProviderId,
  ProviderCatalogEntry,
} from "./domain.ts";

const execFileAsync = promisify(execFile);

export const providerCatalog: ProviderCatalogEntry[] = [
  { id: "openai", name: "OpenAI", category: "Direct", description: "Direct OpenAI models with native tool calling.", defaultBaseUrl: "https://api.openai.com/v1", environmentVariables: ["OPENAI_API_KEY"] },
  { id: "anthropic", name: "Anthropic", category: "Direct", description: "Claude models through Anthropic's model API.", defaultBaseUrl: "https://api.anthropic.com/v1", environmentVariables: ["ANTHROPIC_API_KEY"] },
  { id: "google", name: "Google Gemini", category: "Direct", description: "Gemini models through the Google Developer API.", defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta", environmentVariables: ["GOOGLE_API_KEY", "GEMINI_API_KEY"] },
  { id: "deepseek", name: "DeepSeek", category: "Direct", description: "DeepSeek models through its OpenAI-compatible API.", defaultBaseUrl: "https://api.deepseek.com", environmentVariables: ["DEEPSEEK_API_KEY"] },
  { id: "openrouter", name: "OpenRouter", category: "Gateway", description: "A broad provider and model catalog behind one API.", defaultBaseUrl: "https://openrouter.ai/api/v1", environmentVariables: ["OPENROUTER_API_KEY"] },
  { id: "groq", name: "Groq", category: "Gateway", description: "Low-latency hosted models through an OpenAI-compatible API.", defaultBaseUrl: "https://api.groq.com/openai/v1", environmentVariables: ["GROQ_API_KEY"] },
  { id: "ollama", name: "Ollama", category: "Local", description: "Private models served by Ollama on this machine.", defaultBaseUrl: "http://127.0.0.1:11434/v1", environmentVariables: [] },
  { id: "openai-compatible", name: "Custom endpoint", category: "Advanced", description: "LM Studio, vLLM, Together, Fireworks, xAI, or another compatible endpoint.", defaultBaseUrl: "", environmentVariables: ["DISTRIBUTION_OS_AI_API_KEY"] },
];

interface StoredModelProfile {
  id: string;
  name: string;
  provider: ModelProviderId;
  model: string;
  baseUrl: string;
  credentialSource: "environment" | "keychain" | "none";
}

export interface ResolvedModelExecution {
  profile: StoredModelProfile;
  apiKey: string;
}

interface StoredSettings {
  version: 1;
  profiles: StoredModelProfile[];
  execution: AIExecutionProfile;
}

interface RuntimeDefinition {
  id: AgentRuntimeId;
  name: string;
  command: string;
  ownsModelSelection: boolean;
  capabilities: string[];
}

type RuntimeRunner = (command: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;

const runtimeCatalog: RuntimeDefinition[] = [
  { id: "native", name: "Distribution-OS Native", command: "", ownsModelSelection: false, capabilities: ["Governed tool loop", "Distribution memory", "Approval policy", "Outcome ledger"] },
  { id: "claude-code", name: "Claude Code", command: "claude", ownsModelSelection: true, capabilities: ["Repository tools", "Claude Code sessions", "Runtime-managed authentication"] },
  { id: "cursor", name: "Cursor Agent", command: "cursor-agent", ownsModelSelection: true, capabilities: ["Repository tools", "Cursor agent mode", "Runtime-managed authentication"] },
  { id: "opencode", name: "OpenCode", command: "opencode", ownsModelSelection: true, capabilities: ["Repository tools", "OpenCode sessions", "Runtime-managed providers"] },
  { id: "codex", name: "Codex CLI", command: "codex", ownsModelSelection: true, capabilities: ["Repository tools", "Codex sessions", "Runtime-managed authentication"] },
];

function defaultExecution(): AIExecutionProfile {
  return { runtimeId: "native", modelProfileId: null, runtimeModel: "", updatedAt: new Date().toISOString() };
}

function cleanOutput(stdout: string, stderr: string): string {
  return `${stdout}${stderr}`.trim().split("\n")[0]?.slice(0, 160) || "installed";
}

function validateBaseUrl(value: string): string {
  if (!value) throw new Error("A base URL is required for this provider.");
  const url = new URL(value);
  const local = ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new Error("Remote model endpoints must use HTTPS.");
  }
  return url.toString().replace(/\/$/, "");
}

function environmentCredential(provider: ModelProviderId): string | undefined {
  if (process.env.DISTRIBUTION_OS_AI_API_KEY) return process.env.DISTRIBUTION_OS_AI_API_KEY;
  if (provider === "openai") return process.env.OPENAI_API_KEY;
  if (provider === "anthropic") return process.env.ANTHROPIC_API_KEY;
  if (provider === "google") return process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;
  if (provider === "deepseek") return process.env.DEEPSEEK_API_KEY;
  if (provider === "openrouter") return process.env.OPENROUTER_API_KEY;
  if (provider === "groq") return process.env.GROQ_API_KEY;
  return undefined;
}

export async function inspectRuntime(definition: RuntimeDefinition, runner: RuntimeRunner = async (command, args) => {
  const result = await execFileAsync(command, args, { timeout: 5_000, maxBuffer: 64 * 1024 });
  return { stdout: result.stdout, stderr: result.stderr };
}): Promise<AgentRuntimeStatus> {
  if (definition.id === "native") {
    return { ...definition, available: true, availability: "available", detail: "Distribution-OS owns planning, tools, memory, approvals, and the learning loop." };
  }
  try {
    const { stdout, stderr } = await runner(definition.command, ["--version"]);
    const version = cleanOutput(stdout, stderr);
    if (definition.id === "claude-code" && !process.env.ANTHROPIC_API_KEY && !process.env.CLAUDE_CODE_OAUTH_TOKEN) {
      try {
        const auth = await runner(definition.command, ["auth", "status"]);
        const status = JSON.parse(auth.stdout) as { loggedIn?: boolean };
        if (status.loggedIn !== true) {
          return { ...definition, available: false, availability: "setup-required", version, detail: "Claude Code is installed but not authenticated. Run claude auth login." };
        }
      } catch {
        return { ...definition, available: false, availability: "setup-required", version, detail: "Claude Code is installed, but authentication could not be verified. Run claude auth status." };
      }
    }
    return { ...definition, available: true, availability: "available", version, detail: `${definition.name} is installed. Authentication and its internal tool loop remain owned by the runtime.` };
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    return {
      ...definition,
      available: false,
      availability: missing ? "missing" : "setup-required",
      detail: missing ? `${definition.name} is not installed or is not on PATH.` : `${definition.name} could not be started: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export class AIControlPlaneStore {
  readonly settingsPath: string;
  private readonly runner?: RuntimeRunner;

  constructor(dataDirectory: string, runner?: RuntimeRunner) {
    this.settingsPath = join(resolve(dataDirectory), "ai-settings.json");
    this.runner = runner;
  }

  private keychainService(profileId: string): string {
    return `dev.distribution-os.model.${profileId}`;
  }

  private async readSettings(): Promise<StoredSettings> {
    try {
      const value = JSON.parse(await readFile(this.settingsPath, "utf8")) as Partial<StoredSettings>;
      const execution = value.execution && runtimeCatalog.some((runtime) => runtime.id === value.execution?.runtimeId)
        ? { ...defaultExecution(), ...value.execution }
        : defaultExecution();
      return { version: 1, profiles: Array.isArray(value.profiles) ? value.profiles : [], execution };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, profiles: [], execution: defaultExecution() };
      throw error;
    }
  }

  private async writeSettings(settings: StoredSettings): Promise<void> {
    await mkdir(resolve(this.settingsPath, ".."), { recursive: true, mode: 0o700 });
    const temporary = `${this.settingsPath}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, this.settingsPath);
  }

  private async keychainRead(profileId: string): Promise<string | null> {
    if (process.platform !== "darwin") return null;
    try {
      const result = await execFileAsync("security", ["find-generic-password", "-w", "-s", this.keychainService(profileId), "-a", "api-key"], { maxBuffer: 64 * 1024 });
      return result.stdout.trim();
    } catch {
      return null;
    }
  }

  private async keychainWrite(profileId: string, secret: string): Promise<void> {
    if (process.platform !== "darwin") throw new Error("Secure credential storage is unavailable on this platform. Use the provider environment variable instead.");
    await execFileAsync("security", ["add-generic-password", "-U", "-s", this.keychainService(profileId), "-a", "api-key", "-w", secret], { maxBuffer: 64 * 1024 });
  }

  private async publicProfile(profile: StoredModelProfile): Promise<ModelProfile> {
    const catalog = providerCatalog.find((provider) => provider.id === profile.provider);
    const localWithoutCredential = profile.provider === "ollama" || (profile.provider === "openai-compatible" && ["127.0.0.1", "localhost", "::1"].includes(new URL(profile.baseUrl).hostname));
    const credentialConfigured = localWithoutCredential || Boolean(environmentCredential(profile.provider)) || Boolean(await this.keychainRead(profile.id));
    return {
      ...profile,
      credentialConfigured,
      readiness: !profile.model ? "needs-model" : credentialConfigured ? "ready" : "needs-credential",
      name: profile.name || `${catalog?.name ?? profile.provider} · ${profile.model}`,
    };
  }

  async inspectRuntimes(): Promise<AgentRuntimeStatus[]> {
    return Promise.all(runtimeCatalog.map((runtime) => inspectRuntime(runtime, this.runner)));
  }

  async getPublicState(): Promise<AIControlPlane> {
    const settings = await this.readSettings();
    const [profiles, runtimes] = await Promise.all([
      Promise.all(settings.profiles.map((profile) => this.publicProfile(profile))),
      this.inspectRuntimes(),
    ]);
    return {
      generatedAt: new Date().toISOString(),
      secureStorage: process.platform === "darwin" ? "macOS Keychain" : "environment variables",
      providers: providerCatalog,
      profiles,
      runtimes,
      execution: settings.execution,
    };
  }

  async getActiveModelExecution(): Promise<ResolvedModelExecution | null> {
    const settings = await this.readSettings();
    if (settings.execution.runtimeId !== "native") return null;
    return this.resolveModelExecution(settings);
  }

  private async resolveModelExecution(settings: StoredSettings, profileId = settings.execution.modelProfileId): Promise<ResolvedModelExecution | null> {
    if (!profileId) return null;
    const profile = settings.profiles.find((item) => item.id === profileId);
    if (!profile) return null;
    const localWithoutCredential = profile.provider === "ollama"
      || (profile.provider === "openai-compatible" && ["127.0.0.1", "localhost", "::1"].includes(new URL(profile.baseUrl).hostname));
    const apiKey = environmentCredential(profile.provider) || await this.keychainRead(profile.id) || "";
    if (!localWithoutCredential && !apiKey) return null;
    return { profile, apiKey };
  }

  async getConfiguredModelExecution(): Promise<ResolvedModelExecution | null> {
    return this.resolveModelExecution(await this.readSettings());
  }

  async getModelExecution(profileId: string): Promise<ResolvedModelExecution | null> {
    return this.resolveModelExecution(await this.readSettings(), profileId);
  }

  async getExecutionProfile(): Promise<AIExecutionProfile> {
    return (await this.readSettings()).execution;
  }

  async saveModelProfile(input: { id?: string; name?: string; provider?: string; model?: string; baseUrl?: string; apiKey?: string; activate?: boolean }): Promise<AIControlPlane> {
    const provider = providerCatalog.find((item) => item.id === input.provider);
    if (!provider) throw new Error("Choose a supported model provider.");
    const model = input.model?.trim().slice(0, 200) ?? "";
    if (!model) throw new Error("A model ID is required.");
    const baseUrl = validateBaseUrl(input.baseUrl?.trim() || provider.defaultBaseUrl);
    const settings = await this.readSettings();
    const id = input.id && /^[a-zA-Z0-9-]{8,80}$/.test(input.id) ? input.id : randomUUID();
    const existing = settings.profiles.find((profile) => profile.id === id);
    let credentialSource: StoredModelProfile["credentialSource"] = provider.id === "ollama" ? "none" : existing?.credentialSource ?? "environment";
    if (input.apiKey?.trim()) {
      await this.keychainWrite(id, input.apiKey.trim());
      credentialSource = "keychain";
    }
    const profile: StoredModelProfile = {
      id,
      name: input.name?.trim().slice(0, 80) || `${provider.name} · ${model}`,
      provider: provider.id,
      model,
      baseUrl,
      credentialSource,
    };
    settings.profiles = [profile, ...settings.profiles.filter((item) => item.id !== id)];
    if (input.activate || !settings.execution.modelProfileId) settings.execution.modelProfileId = id;
    settings.execution.updatedAt = new Date().toISOString();
    await this.writeSettings(settings);
    return this.getPublicState();
  }

  async activateModelProfile(profileId: string): Promise<AIControlPlane> {
    const settings = await this.readSettings();
    const profile = settings.profiles.find((item) => item.id === profileId);
    if (!profile) throw new Error("Model profile not found.");
    const publicProfile = await this.publicProfile(profile);
    if (publicProfile.readiness !== "ready") throw new Error("This model profile needs a model and credential before activation.");
    settings.execution = { ...settings.execution, runtimeId: "native", modelProfileId: profileId, updatedAt: new Date().toISOString() };
    await this.writeSettings(settings);
    return this.getPublicState();
  }

  async activateRuntime(runtimeId: string, runtimeModel = ""): Promise<AIControlPlane> {
    const runtime = runtimeCatalog.find((item) => item.id === runtimeId);
    if (!runtime) throw new Error("Choose a supported agent runtime.");
    const status = await inspectRuntime(runtime, this.runner);
    if (!status.available) throw new Error(`${status.detail} Finish runtime setup before activating it.`);
    const settings = await this.readSettings();
    settings.execution = {
      ...settings.execution,
      runtimeId: runtime.id,
      runtimeModel: runtimeModel.trim().slice(0, 160),
      updatedAt: new Date().toISOString(),
    };
    await this.writeSettings(settings);
    return this.getPublicState();
  }
}
