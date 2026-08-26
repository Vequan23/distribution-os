import { lookup } from "node:dns/promises";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { basename, extname, join, relative, resolve } from "node:path";
import mammoth from "mammoth";
import pdfParse from "pdf-parse";
import type {
  EvidenceClassification,
  IngestedSource,
  OnboardingSourceInput,
  ProductBriefDraft,
  ProductBriefField,
} from "./domain.ts";

const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;
const MAX_REMOTE_BYTES = 2 * 1024 * 1024;
const MAX_REPOSITORY_FILES = 30;
const TEXT_EXTENSIONS = new Set([".md", ".mdx", ".txt", ".json", ".yaml", ".yml", ".toml", ".xml"]);
const IMPORTANT_FILES = /^(readme|changelog|package|pyproject|cargo|pom|composer|gemfile|requirements|manifest)/i;
const blockedAddresses = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as Array<[string, number]>) blockedAddresses.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [
  ["::", 128], ["::1", 128], ["64:ff9b::", 96], ["100::", 64],
  ["2001:db8::", 32], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
] as Array<[string, number]>) blockedAddresses.addSubnet(network, prefix, "ipv6");

function normalizeText(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, "\"")
    .replace(/\s+/g, " ")
    .trim();
}

function summarize(value: string): { summary: string; excerpt: string } {
  const clean = normalizeText(value);
  if (!clean) throw new Error("This source did not contain readable text.");
  const sentences = clean.match(/[^.!?\n]+[.!?]?/g) ?? [clean];
  const useful = sentences
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 24)
    .slice(0, 4);
  const summary = useful.slice(0, 2).join(" ").slice(0, 480) || clean.slice(0, 480);
  return { summary, excerpt: clean.slice(0, 2_400) };
}

function sourcePolicy(type: OnboardingSourceInput["type"]): {
  classification: EvidenceClassification;
  confidence: number;
} {
  if (type === "repository") return { classification: "implementation", confidence: 88 };
  if (type === "url") return { classification: "public-claim", confidence: 68 };
  return { classification: "intent", confidence: 52 };
}

export function isPrivateAddress(value: string): boolean {
  const address = value.toLowerCase().replace(/^\[|\]$/g, "");
  const family = isIP(address);
  if (!family) return true;
  return blockedAddresses.check(address, family === 4 ? "ipv4" : "ipv6");
}

export function safeRemoteUrl(value: string): URL {
  const url = new URL(value);
  if (!(url.protocol === "https:" || url.protocol === "http:")) {
    throw new Error("Only HTTP and HTTPS URLs can be imported.");
  }
  if (url.username || url.password) throw new Error("URLs containing credentials cannot be imported.");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost"
    || host.endsWith(".local")
    || host === "0.0.0.0"
    || host === "::1"
    || /^127\./.test(host)
    || /^10\./.test(host)
    || /^192\.168\./.test(host)
    || /^169\.254\./.test(host)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) throw new Error("Private-network URLs cannot be imported.");
  return url;
}

type AddressResolver = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

export async function resolvePublicAddress(hostname: string, resolver: AddressResolver = async (host) => lookup(host, { all: true, verbatim: true })): Promise<{ address: string; family: number }> {
  hostname = hostname.replace(/^\[|\]$/g, "");
  const literalFamily = isIP(hostname);
  const addresses = literalFamily ? [{ address: hostname, family: literalFamily }] : await resolver(hostname);
  if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new Error("Private-network URLs cannot be imported.");
  }
  return addresses[0];
}

async function downloadRemote(url: URL, redirects = 0): Promise<{ body: string; finalUrl: URL }> {
  if (redirects > 4) throw new Error("This web source redirected too many times.");
  const pinned = await resolvePublicAddress(url.hostname);
  const client = url.protocol === "https:" ? httpsRequest : httpRequest;
  const pinnedLookup: LookupFunction = (_hostname, options, callback) => {
    if (options.all) callback(null, [pinned]);
    else callback(null, pinned.address, pinned.family);
  };
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    const reject = (error: Error): void => {
      if (settled) return;
      settled = true;
      rejectPromise(error);
    };
    const request = client(url, {
      headers: { "user-agent": "Distribution-OS/0.1 product-evidence-importer", accept: "text/html,text/plain,application/json;q=0.8" },
      lookup: pinnedLookup,
      servername: url.hostname,
    }, (response) => {
      const status = response.statusCode || 0;
      const location = response.headers.location;
      if (status >= 300 && status < 400 && location) {
        response.resume();
        const redirected = safeRemoteUrl(new URL(location, url).toString());
        downloadRemote(redirected, redirects + 1).then((value) => {
          settled = true;
          resolvePromise(value);
        }, reject);
        return;
      }
      if (status < 200 || status >= 300) {
        response.resume();
        reject(new Error(`Could not read ${url.hostname} (${status}).`));
        return;
      }
      const declaredLength = Number(response.headers["content-length"] || 0);
      if (declaredLength > MAX_REMOTE_BYTES) {
        response.destroy();
        reject(new Error("This web source is larger than 2 MB."));
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.byteLength;
        if (size > MAX_REMOTE_BYTES) {
          response.destroy();
          reject(new Error("This web source is larger than 2 MB."));
          return;
        }
        chunks.push(buffer);
      });
      response.on("end", () => {
        if (settled) return;
        settled = true;
        resolvePromise({ body: Buffer.concat(chunks).toString("utf8"), finalUrl: url });
      });
      response.on("error", (error) => reject(error));
    });
    request.setTimeout(15_000, () => request.destroy(new Error("The web source timed out.")));
    request.on("error", (error) => reject(error));
    request.end();
  });
}

async function ingestUrl(source: OnboardingSourceInput): Promise<IngestedSource> {
  const url = safeRemoteUrl(String(source.value || "").trim());
  const { body: html, finalUrl } = await downloadRemote(url);
  const pageTitle = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const { summary, excerpt } = summarize(html);
  const policy = sourcePolicy("url");
  return {
    type: "url",
    label: normalizeText(pageTitle || source.label || finalUrl.hostname).slice(0, 160),
    sourceUrl: finalUrl.toString(),
    summary,
    excerpt,
    ...policy,
  };
}

function repositoryFiles(root: string): string[] {
  const results: string[] = [];
  const visit = (directory: string, depth: number): void => {
    if (depth > 3 || results.length >= MAX_REPOSITORY_FILES) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (results.length >= MAX_REPOSITORY_FILES) return;
      if ([".git", "node_modules", "dist", "build", "coverage", ".next", ".nuxt"].includes(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (depth < 2 && ["docs", "src", "app", "packages"].includes(entry.name.toLowerCase())) visit(path, depth + 1);
        continue;
      }
      const extension = extname(entry.name).toLowerCase();
      if ((IMPORTANT_FILES.test(entry.name) || TEXT_EXTENSIONS.has(extension)) && statSync(path).size <= 200_000) {
        results.push(path);
      }
    }
  };
  visit(root, 0);
  const priority = (path: string): number => {
    const name = relative(root, path).replaceAll("\\", "/").toLowerCase();
    const base = basename(name);
    if (/^readme(\.|$)/.test(base) && !name.includes("/")) return 0;
    if (/^(package\.json|pyproject\.toml|cargo\.toml|pom\.xml|composer\.json|gemfile|requirements\.txt)$/.test(base) && !name.includes("/")) return 10;
    if (/^(product|architecture|overview|vision|positioning|brief)(\.|-)/.test(base)) return 20;
    if (/^readme(\.|$)/.test(base)) return 25;
    if (name.startsWith("docs/")) return 35;
    if (/^(changelog|security|contributing|code_of_conduct|code-of-conduct|license)/.test(base)) return 90;
    return 50;
  };
  return results.sort((left, right) => priority(left) - priority(right) || relative(root, left).localeCompare(relative(root, right)));
}

function ingestRepository(source: OnboardingSourceInput): IngestedSource {
  if (source.contentBase64) {
    const buffer = Buffer.from(source.contentBase64, "base64");
    if (buffer.byteLength > 4 * 1024 * 1024) throw new Error("Repository imports must be 4 MB or smaller after filtering.");
    const { summary, excerpt } = summarize(buffer.toString("utf8"));
    return {
      type: "repository",
      label: source.label || source.filename || "Selected repository",
      sourceUrl: "",
      summary: `${summary} Imported through the bounded repository folder chooser.`,
      excerpt,
      classification: "implementation",
      confidence: 82,
    };
  }
  const root = resolve(String(source.value || "").trim());
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error("The repository folder could not be found.");
  const files = repositoryFiles(root);
  if (!files.length) throw new Error("No readable product documentation or manifests were found in this folder.");
  const body = files.map((path) => `\n--- ${path.slice(root.length + 1)} ---\n${readFileSync(path, "utf8")}`).join("\n");
  const { summary } = summarize(readFileSync(files[0], "utf8"));
  const { excerpt } = summarize(body);
  return {
    type: "repository",
    label: source.label || basename(root),
    sourceUrl: `file://${root}`,
    summary: `${summary} Scanned ${files.length} bounded repository files.`,
    excerpt,
    ...sourcePolicy("repository"),
  };
}

async function documentText(source: OnboardingSourceInput): Promise<string> {
  if (!source.contentBase64) throw new Error("The uploaded document was empty.");
  const buffer = Buffer.from(source.contentBase64, "base64");
  if (buffer.byteLength > MAX_DOCUMENT_BYTES) throw new Error("Documents must be 8 MB or smaller.");
  const extension = extname(source.filename || "").toLowerCase();
  if (extension === ".pdf" || source.mimeType === "application/pdf") {
    return (await pdfParse(buffer)).text;
  }
  if (extension === ".docx" || source.mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    return (await mammoth.extractRawText({ buffer })).value;
  }
  return buffer.toString("utf8");
}

async function ingestDocument(source: OnboardingSourceInput): Promise<IngestedSource> {
  const { summary, excerpt } = summarize(await documentText(source));
  return {
    type: "document",
    label: source.label || source.filename || "Uploaded document",
    sourceUrl: "",
    summary,
    excerpt,
    ...sourcePolicy("document"),
  };
}

function ingestText(source: OnboardingSourceInput): IngestedSource {
  const { summary, excerpt } = summarize(String(source.value || ""));
  return {
    type: "text",
    label: source.label || "Founder-provided context",
    sourceUrl: "",
    summary,
    excerpt,
    ...sourcePolicy("text"),
  };
}

export async function ingestSources(sources: OnboardingSourceInput[]): Promise<IngestedSource[]> {
  if (!sources.length) throw new Error("Add at least one product source.");
  if (sources.length > 12) throw new Error("A product can be onboarded with up to 12 sources at once.");
  const ingested: IngestedSource[] = [];
  for (const source of sources) {
    if (source.type === "url") ingested.push(await ingestUrl(source));
    else if (source.type === "repository") ingested.push(ingestRepository(source));
    else if (source.type === "document") ingested.push(await ingestDocument(source));
    else ingested.push(ingestText(source));
  }
  return ingested;
}

function displayName(value: string): string {
  return value
    .replace(/\.(pdf|docx?|mdx?|txt|json|ya?ml|html?)$/i, "")
    .split(/\s+[|—–]\s+|\s+-\s+/)[0]
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase())
    .trim()
    .slice(0, 100);
}

function field(value: string, confidence: number, sourceLabels: string[], needsReview = false): ProductBriefField {
  return { value: value.trim(), confidence, sourceLabels: [...new Set(sourceLabels)], needsReview };
}

function packageValue(body: string, key: string): string {
  return body.match(new RegExp(`(?:\"|')${key}(?:\"|')\\s*:\\s*(?:\"|')([^\"']{2,240})(?:\"|')`, "i"))?.[1]?.trim() || "";
}

function audienceCandidate(body: string): string {
  const patterns = [
    /(?:built|designed|created)\s+for\s+([^.!?]{8,120})/i,
    /helps?\s+([^.!?]{8,100}?)\s+(?:to\s+)?(?:build|create|manage|understand|turn|find|ship|grow|automate|improve)/i,
    /for\s+([^.!?]{8,100}?)\s+who\s+/i,
  ];
  for (const pattern of patterns) {
    const candidate = body.match(pattern)?.[1]?.replace(/\s+/g, " ").trim();
    if (candidate) return candidate;
  }
  return "Needs founder confirmation";
}

function productNameCandidate(body: string): string {
  const candidate = body.match(/\b([A-Z][\w-]+(?:\s+[A-Z][\w-]+){0,3})\s+(?:is|helps|gives|turns|enables|provides|lets)\b/)?.[1]?.trim() || "";
  if (["This", "The", "Our", "It"].includes(candidate)) return "";
  return candidate;
}

export function buildProductBrief(sources: IngestedSource[]): ProductBriefDraft {
  if (!sources.length) throw new Error("A product brief needs at least one readable source.");
  const repository = sources.find((source) => source.type === "repository");
  const publicSource = sources.find((source) => source.type === "url");
  const primary = repository || publicSource || sources[0];
  const body = sources.map((source) => `${source.label}\n${source.excerpt}`).join("\n\n");

  const packageName = packageValue(body, "name");
  const genericLabel = /^(paste context|founder-provided context|product source|uploaded document)$/i.test(primary.label.trim());
  const inferredName = genericLabel ? productNameCandidate(sources.map((source) => source.excerpt).join("\n")) : "";
  const nameValue = displayName(packageName || inferredName || primary.label) || "Untitled product";
  const nameSources = packageName ? sources.filter((source) => source.excerpt.includes(packageName)).map((source) => source.label) : [primary.label];
  const name = field(nameValue, packageName ? 90 : inferredName ? 72 : repository ? 76 : 58, nameSources, !packageName && !inferredName && !repository);

  const packageDescription = packageValue(body, "description");
  const descriptionValue = packageDescription || primary.summary.replace(/\s+(Scanned|Imported through).*$/i, "");
  const description = field(descriptionValue.slice(0, 420), packageDescription ? 86 : sources.length > 1 ? 67 : 52, [primary.label], !packageDescription);

  const audienceValue = audienceCandidate(body);
  const audience = field(audienceValue, audienceValue === "Needs founder confirmation" ? 18 : 54, sources.map((source) => source.label), true);
  const positioningValue = audienceValue === "Needs founder confirmation"
    ? `${nameValue} — ${descriptionValue}`
    : `For ${audienceValue}, ${nameValue} makes the described outcome easier to achieve.`;
  const positioning = field(positioningValue.slice(0, 420), 36, [primary.label], true);

  const evidenceCounts = new Map<EvidenceClassification, number>();
  for (const source of sources) evidenceCounts.set(source.classification, (evidenceCounts.get(source.classification) || 0) + 1);
  const overallConfidence = Math.round((name.confidence + description.confidence + audience.confidence + positioning.confidence) / 4);
  const hasImplementation = sources.some((source) => source.classification === "implementation");

  return {
    name,
    description,
    audience,
    positioning,
    stage: hasImplementation ? "early" : "idea",
    suggestedObjectives: [
      "Find the first 20 active users",
      "Validate positioning with 10 qualified conversations",
      "Earn 100 qualified visits from one durable channel",
    ],
    overallConfidence,
    sourceCount: sources.length,
    evidenceClasses: [...evidenceCounts].map(([classification, count]) => ({ classification, count })),
    analysis: { mode: "local", runId: null, provider: "", model: "", warning: "" },
  };
}
