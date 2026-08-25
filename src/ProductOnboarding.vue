<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { analyzeProduct } from "./api.ts";
import type {
  OnboardProductInput,
  OnboardingSourceInput,
  OnboardingSourceType,
  ProductBriefDraft,
  ProductBriefField,
} from "../server/domain.ts";

defineProps<{ busy: boolean; error: string }>();
const emit = defineEmits<{ submit: [input: OnboardProductInput] }>();

const step = ref(1);
const sourceType = ref<OnboardingSourceType>("repository");
const sourceLabel = ref("");
const sourceValue = ref("");
const fileBusy = ref(false);
const analysisBusy = ref(false);
const localError = ref("");
const sources = ref<OnboardingSourceInput[]>([]);
const brief = ref<ProductBriefDraft | null>(null);
const customObjective = ref(false);
const form = reactive({
  name: "",
  description: "",
  stage: "early",
  audience: "",
  objective: "",
  positioning: "",
  websiteUrl: "",
  repositoryUrl: "",
});

const sourceReady = computed(() => sources.value.length > 0);
const briefReady = computed(() => Boolean(
  form.name.trim()
  && form.description.trim()
  && form.audience.trim()
  && form.audience.trim().toLowerCase() !== "needs founder confirmation",
));

const sourceOptions: Array<{ type: OnboardingSourceType; icon: string; label: string; detail: string }> = [
  { type: "repository", icon: "folder", label: "Repository folder", detail: "Choose a folder—no path knowledge required" },
  { type: "url", icon: "globe", label: "Web URL", detail: "Product site, docs, listing, or GitHub" },
  { type: "document", icon: "file-text", label: "Documents", detail: "PDF, DOCX, Markdown, text, or JSON" },
  { type: "text", icon: "edit", label: "Paste context", detail: "PRD, pitch, prompts, notes, or conversations" },
];

function asBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("The selected source could not be read."));
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.readAsDataURL(blob);
  });
}

function resetAnalysis(): void {
  brief.value = null;
}

function addTypedSource(): void {
  localError.value = "";
  const value = sourceValue.value.trim();
  if (!value) {
    localError.value = sourceType.value === "url" ? "Enter a public URL." : sourceType.value === "repository" ? "Enter an absolute local folder path." : "Paste some product context.";
    return;
  }
  if (sourceType.value === "url") {
    try { new URL(value); } catch { localError.value = "Enter a complete URL, including https://."; return; }
  }
  sources.value.push({
    type: sourceType.value,
    label: sourceLabel.value.trim() || sourceOptions.find((option) => option.type === sourceType.value)?.label || "Product source",
    value,
  });
  if (sourceType.value === "url") {
    if (value.includes("github.com/")) form.repositoryUrl = value;
    else if (!form.websiteUrl) form.websiteUrl = value;
  }
  sourceLabel.value = "";
  sourceValue.value = "";
  resetAnalysis();
}

async function addFiles(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const files = [...(input.files ?? [])];
  if (!files.length) return;
  fileBusy.value = true;
  localError.value = "";
  try {
    for (const file of files) {
      if (file.size > 8 * 1024 * 1024) throw new Error(`${file.name} is larger than 8 MB.`);
      sources.value.push({
        type: "document",
        label: file.name,
        filename: file.name,
        mimeType: file.type,
        contentBase64: await asBase64(file),
      });
    }
    resetAnalysis();
  } catch (cause) {
    localError.value = cause instanceof Error ? cause.message : "The document could not be read.";
  } finally {
    fileBusy.value = false;
    input.value = "";
  }
}

function isUsefulRepositoryFile(file: File): boolean {
  const path = (file.webkitRelativePath || file.name).toLowerCase();
  if (/(^|\/)(node_modules|\.git|dist|build|coverage|\.next|\.nuxt)(\/|$)/.test(path)) return false;
  if (file.size > 200_000) return false;
  const name = file.name.toLowerCase();
  return /^(readme|changelog|package|pyproject|cargo|pom|composer|gemfile|requirements|manifest)/.test(name)
    || /\.(md|mdx|txt|json|ya?ml|toml|xml)$/.test(name);
}

async function addRepositoryFolder(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const allFiles = [...(input.files ?? [])];
  if (!allFiles.length) return;
  fileBusy.value = true;
  localError.value = "";
  try {
    const selected = allFiles.filter(isUsefulRepositoryFile).slice(0, 30);
    if (!selected.length) throw new Error("No README, documentation, or project manifests were found in that folder.");
    const sections: string[] = [];
    let totalBytes = 0;
    for (const file of selected) {
      totalBytes += file.size;
      if (totalBytes > 2_500_000) break;
      sections.push(`\n--- ${file.webkitRelativePath || file.name} ---\n${await file.text()}`);
    }
    const rootName = (selected[0]?.webkitRelativePath || selected[0]?.name || "Selected repository").split("/")[0];
    sources.value.push({
      type: "repository",
      label: rootName,
      filename: `${rootName}-repository.txt`,
      mimeType: "text/plain",
      contentBase64: await asBase64(new Blob([sections.join("\n")], { type: "text/plain" })),
    });
    resetAnalysis();
  } catch (cause) {
    localError.value = cause instanceof Error ? cause.message : "The repository folder could not be read.";
  } finally {
    fileBusy.value = false;
    input.value = "";
  }
}

function removeSource(index: number): void {
  sources.value.splice(index, 1);
  resetAnalysis();
}

async function generateBrief(): Promise<void> {
  if (!sourceReady.value) return;
  analysisBusy.value = true;
  localError.value = "";
  try {
    const result = await analyzeProduct(sources.value);
    brief.value = result.brief;
    form.name = result.brief.name.value;
    form.description = result.brief.description.value;
    form.audience = result.brief.audience.value;
    form.positioning = result.brief.positioning.value;
    form.stage = result.brief.stage;
    form.objective = result.brief.suggestedObjectives[0] || "";
    step.value = 2;
  } catch (cause) {
    localError.value = cause instanceof Error ? cause.message : "The product brief could not be generated.";
  } finally {
    analysisBusy.value = false;
  }
}

function chooseObjective(value: string): void {
  customObjective.value = false;
  form.objective = value;
}

function chooseCustomObjective(): void {
  customObjective.value = true;
  form.objective = "";
}

function submit(): void {
  localError.value = "";
  if (!briefReady.value) { step.value = 2; localError.value = "Review the generated brief and resolve the missing fields."; return; }
  if (!form.objective.trim()) { step.value = 3; localError.value = "Choose or write a distribution objective."; return; }
  emit("submit", { ...form, sources: sources.value });
}

function confidenceTone(value: number): "success" | "warning" | "neutral" {
  return value >= 70 ? "success" : value >= 45 ? "warning" : "neutral";
}

function sourcesFor(field: ProductBriefField): string {
  return field.sourceLabels.slice(0, 2).join(" · ");
}
</script>

<template>
  <main class="onboarding-page">
    <header class="onboarding-hero">
      <div>
        <p class="eyebrow">UNIVERSAL PRODUCT ONBOARDING</p>
        <h1>Start with the evidence.</h1>
        <p>Choose a project folder or bring whatever explains the product today. Distribution-OS will draft the brief, cite its sources, and ask you to correct what it cannot know.</p>
      </div>
      <osx-badge tone="success" dot>Private local analysis</osx-badge>
    </header>

    <nav class="onboarding-steps" aria-label="Onboarding progress">
      <button v-for="item in 3" :key="item" :class="{ active: step === item, complete: step > item }" @click="step = item === 1 || brief ? item : step">
        <span>{{ step > item ? "✓" : item }}</span>
        <strong>{{ item === 1 ? "Product evidence" : item === 2 ? "Generated brief" : "Goal & approval" }}</strong>
      </button>
    </nav>

    <osx-alert v-if="localError || error" tone="danger" title="Onboarding needs attention">{{ localError || error }}</osx-alert>

    <section v-if="step === 1" class="onboarding-panel">
      <div class="panel-heading"><div><p class="eyebrow">01 · PRODUCT EVIDENCE</p><h2>What can explain the product?</h2></div><osx-badge tone="info">{{ sources.length }} added</osx-badge></div>
      <div class="source-type-grid">
        <button v-for="option in sourceOptions" :key="option.type" :class="{ active: sourceType === option.type }" @click="sourceType = option.type; localError = ''">
          <osx-icon :name="option.icon" size="21"></osx-icon><span><strong>{{ option.label }}</strong><small>{{ option.detail }}</small></span>
        </button>
      </div>

      <div v-if="sourceType === 'repository'" class="repository-picker">
        <label class="file-drop repository-drop">
          <osx-icon name="folder" size="30"></osx-icon>
          <strong>{{ fileBusy ? "Reading repository evidence…" : "Choose repository folder" }}</strong>
          <span>Only bounded documentation and project manifests are read. Dependencies, builds, Git history, binaries, and secrets are ignored.</span>
          <input type="file" multiple webkitdirectory="" :disabled="fileBusy" @change="addRepositoryFolder" />
        </label>
        <details class="advanced-path">
          <summary>Advanced: use an absolute folder path</summary>
          <div class="source-entry compact">
            <label><span>Source label <small>Optional</small></span><input v-model="sourceLabel" placeholder="Repository name" /></label>
            <label class="wide"><span>Absolute local folder path</span><input v-model="sourceValue" placeholder="/Users/you/projects/your-product" @keydown.enter.prevent="addTypedSource" /></label>
            <osx-button icon="plus" :disabled="!sourceValue.trim()" @click="addTypedSource">Add path</osx-button>
          </div>
        </details>
      </div>

      <div v-else-if="sourceType === 'document'" class="repository-picker">
        <label class="file-drop">
          <osx-icon name="upload" size="28"></osx-icon>
          <strong>{{ fileBusy ? "Reading documents…" : "Choose product documents" }}</strong>
          <span>PDF, DOCX, Markdown, text, JSON, YAML, or HTML · 8 MB each</span>
          <input type="file" multiple accept=".pdf,.docx,.md,.mdx,.txt,.json,.yaml,.yml,.html,text/*,application/pdf" :disabled="fileBusy" @change="addFiles" />
        </label>
      </div>

      <div v-else class="source-entry">
        <label><span>Source label <small>Optional</small></span><input v-model="sourceLabel" placeholder="What should we call this?" /></label>
        <label class="wide"><span>{{ sourceType === 'url' ? 'Public URL' : 'Product context' }}</span>
          <textarea v-if="sourceType === 'text'" v-model="sourceValue" rows="6" placeholder="Paste a PRD, pitch, prompt transcript, launch notes, customer context, or anything else that explains the product."></textarea>
          <input v-else v-model="sourceValue" placeholder="https://your-product.com" @keydown.enter.prevent="addTypedSource" />
        </label>
        <osx-button icon="plus" :disabled="!sourceValue.trim()" @click="addTypedSource">Add source</osx-button>
      </div>

      <div v-if="sources.length" class="source-inventory">
        <article v-for="(source, index) in sources" :key="`${source.type}-${index}`">
          <osx-icon :name="sourceOptions.find((option) => option.type === source.type)?.icon || 'file-text'" size="18"></osx-icon>
          <span><strong>{{ source.label }}</strong><small>{{ source.type }} · {{ source.filename || source.value?.slice(0, 90) || "local source bundle" }}</small></span>
          <osx-button size="small" icon="x" aria-label="Remove source" @click="removeSource(index)"></osx-button>
        </article>
      </div>
      <footer><span>Sources are analyzed locally and nothing is published.</span><osx-button variant="primary" icon="sparkle" :loading="analysisBusy" :disabled="!sourceReady" @click="generateBrief">Generate product brief</osx-button></footer>
    </section>

    <section v-else-if="step === 2 && brief" class="onboarding-panel">
      <div class="panel-heading"><div><p class="eyebrow">02 · GENERATED BRIEF</p><h2>Correct the machine’s interpretation.</h2></div><osx-badge :tone="confidenceTone(brief.overallConfidence)">{{ brief.overallConfidence }}% draft confidence</osx-badge></div>
      <osx-alert tone="info" title="A proposal, not product truth">Every field remains editable. Low-confidence fields require founder judgment before the brief can be approved.</osx-alert>
      <div class="form-grid generated-brief-grid">
        <label><span>Product name</span><input v-model="form.name" required /><small class="field-meta"><osx-badge :tone="confidenceTone(brief.name.confidence)" size="small">{{ brief.name.confidence }}%</osx-badge>{{ sourcesFor(brief.name) }}</small></label>
        <label><span>Stage</span><select v-model="form.stage"><option value="idea">Idea</option><option value="prototype">Prototype</option><option value="early">Early product</option><option value="public-beta">Public beta</option><option value="launched">Launched</option></select></label>
        <label class="wide"><span>Plain-language description</span><textarea v-model="form.description" required></textarea><small class="field-meta"><osx-badge :tone="confidenceTone(brief.description.confidence)" size="small">{{ brief.description.confidence }}%</osx-badge>{{ sourcesFor(brief.description) }}</small></label>
        <label class="wide" :class="{ 'needs-review': brief.audience.needsReview }"><span>Primary audience {{ brief.audience.needsReview ? '· confirm this' : '' }}</span><input v-model="form.audience" required /><small class="field-meta"><osx-badge :tone="confidenceTone(brief.audience.confidence)" size="small">{{ brief.audience.confidence }}%</osx-badge>{{ sourcesFor(brief.audience) }}</small></label>
        <label class="wide"><span>Positioning hypothesis · confirm this</span><textarea v-model="form.positioning"></textarea><small class="field-meta"><osx-badge :tone="confidenceTone(brief.positioning.confidence)" size="small">{{ brief.positioning.confidence }}%</osx-badge>{{ sourcesFor(brief.positioning) }}</small></label>
      </div>
      <section class="analysis-provenance"><strong>Evidence used</strong><div><osx-badge v-for="item in brief.evidenceClasses" :key="item.classification">{{ item.count }} {{ item.classification }}</osx-badge></div><span>{{ brief.sourceCount }} source{{ brief.sourceCount === 1 ? "" : "s" }} · confidence is derived from coverage, not model certainty</span></section>
      <footer><osx-button icon="chevron-left" @click="step = 1">Change sources</osx-button><osx-button variant="primary" icon="chevron-right" :disabled="!briefReady" @click="step = 3">Choose the objective</osx-button></footer>
    </section>

    <section v-else-if="brief" class="onboarding-panel review-panel">
      <div class="panel-heading"><div><p class="eyebrow">03 · GOAL & APPROVAL</p><h2>What must distribution accomplish next?</h2></div><osx-badge tone="warning">Founder decision</osx-badge></div>
      <div class="objective-grid">
        <button v-for="objective in brief.suggestedObjectives" :key="objective" :class="{ active: !customObjective && form.objective === objective }" @click="chooseObjective(objective)"><osx-icon name="target" size="20"></osx-icon><span>{{ objective }}</span><osx-icon v-if="!customObjective && form.objective === objective" name="check" size="17"></osx-icon></button>
        <button :class="{ active: customObjective }" @click="chooseCustomObjective"><osx-icon name="edit" size="20"></osx-icon><span>Write a different objective</span><osx-icon v-if="customObjective" name="check" size="17"></osx-icon></button>
      </div>
      <label v-if="customObjective" class="custom-objective"><span>Custom objective</span><input v-model="form.objective" autofocus placeholder="A measurable outcome for the next distribution cycle" /></label>
      <div class="truth-grid">
        <article><osx-icon name="edit" size="22"></osx-icon><div><strong>Intent</strong><p>Documents and pasted context establish what you mean to build—not what has shipped.</p></div></article>
        <article><osx-icon name="globe" size="22"></osx-icon><div><strong>Public claim</strong><p>Web pages establish what customers are being promised—not whether the behavior works.</p></div></article>
        <article><osx-icon name="code" size="22"></osx-icon><div><strong>Implementation</strong><p>Repositories can support capability claims, but cannot prove demand or customer value.</p></div></article>
      </div>
      <dl class="brief-review"><div><dt>Product</dt><dd>{{ form.name }} · {{ form.stage }}</dd></div><div><dt>Audience</dt><dd>{{ form.audience }}</dd></div><div><dt>Objective</dt><dd>{{ form.objective }}</dd></div><div><dt>Sources</dt><dd>{{ brief.sourceCount }} source{{ brief.sourceCount === 1 ? "" : "s" }} · {{ brief.overallConfidence }}% initial confidence</dd></div></dl>
      <osx-alert tone="info" title="What happens next">Distribution-OS creates one founder-reviewable narrative grounded only in these sources. It does not publish or connect a channel.</osx-alert>
      <footer><osx-button icon="chevron-left" :disabled="busy" @click="step = 2">Review the brief</osx-button><osx-button variant="primary" icon="check" :loading="busy" :disabled="!form.objective.trim()" @click="submit">Approve product memory</osx-button></footer>
    </section>
  </main>
</template>
