import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
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

function safeRemoteUrl(value: string): URL {
  const url = new URL(value);
  if (!(url.protocol === "https:" || url.protocol === "http:")) {
    throw new Error("Only HTTP and HTTPS URLs can be imported.");
  }
  if (url.username || url.password) throw new Error("URLs containing credentials cannot be imported.");
  const host = url.hostname.toLowerCase();
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

async function ingestUrl(source: OnboardingSourceInput): Promise<IngestedSource> {
  const url = safeRemoteUrl(String(source.value || "").trim());
  const response = await fetch(url, {
    signal: AbortSignal.timeout(15_000),
    headers: { "user-agent": "Distribution-OS/0.1 product-evidence-importer" },
  });
  if (!response.ok) throw new Error(`Could not read ${url.hostname} (${response.status}).`);
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > MAX_REMOTE_BYTES) throw new Error("This web source is larger than 2 MB.");
  const html = (await response.text()).slice(0, MAX_REMOTE_BYTES);
  const pageTitle = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const { summary, excerpt } = summarize(html);
  const policy = sourcePolicy("url");
  return {
    type: "url",
    label: normalizeText(pageTitle || source.label || url.hostname).slice(0, 160),
    sourceUrl: url.toString(),
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
  return results;
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
  const { summary, excerpt } = summarize(body);
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

export function buildProductBrief(sources: IngestedSource[]): ProductBriefDraft {
  if (!sources.length) throw new Error("A product brief needs at least one readable source.");
  const repository = sources.find((source) => source.type === "repository");
  const publicSource = sources.find((source) => source.type === "url");
  const primary = repository || publicSource || sources[0];
  const body = sources.map((source) => `${source.label}\n${source.excerpt}`).join("\n\n");

  const packageName = packageValue(body, "name");
  const nameValue = displayName(packageName || primary.label) || "Untitled product";
  const nameSources = packageName ? sources.filter((source) => source.excerpt.includes(packageName)).map((source) => source.label) : [primary.label];
  const name = field(nameValue, packageName ? 90 : repository ? 76 : 58, nameSources, !packageName && !repository);

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
  };
}
