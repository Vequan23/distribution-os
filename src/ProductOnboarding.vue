<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import type { OnboardProductInput, OnboardingSourceInput, OnboardingSourceType } from "../server/domain.ts";

defineProps<{ busy: boolean; error: string }>();
const emit = defineEmits<{ submit: [input: OnboardProductInput] }>();

const step = ref(1);
const sourceType = ref<OnboardingSourceType>("text");
const sourceLabel = ref("");
const sourceValue = ref("");
const fileBusy = ref(false);
const localError = ref("");
const sources = ref<OnboardingSourceInput[]>([]);
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

const basicsReady = computed(() => Boolean(form.name.trim() && form.description.trim() && form.audience.trim() && form.objective.trim()));
const sourceReady = computed(() => sources.value.length > 0);

const sourceOptions: Array<{ type: OnboardingSourceType; icon: string; label: string; detail: string }> = [
  { type: "text", icon: "edit", label: "Paste context", detail: "PRD, pitch, notes, or a product conversation" },
  { type: "url", icon: "globe", label: "Web URL", detail: "Marketing site, docs, listing, or public page" },
  { type: "document", icon: "file-text", label: "Upload document", detail: "PDF, DOCX, Markdown, text, or JSON" },
  { type: "repository", icon: "folder", label: "Local repository", detail: "Bounded scan of docs and project manifests" },
];

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
  if (sourceType.value === "url" && !form.websiteUrl) form.websiteUrl = value;
  if (sourceType.value === "repository" && !form.repositoryUrl) form.repositoryUrl = value;
  sourceLabel.value = "";
  sourceValue.value = "";
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
      const contentBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
        reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
        reader.readAsDataURL(file);
      });
      sources.value.push({
        type: "document",
        label: file.name,
        filename: file.name,
        mimeType: file.type,
        contentBase64,
      });
    }
  } catch (cause) {
    localError.value = cause instanceof Error ? cause.message : "The document could not be read.";
  } finally {
    fileBusy.value = false;
    input.value = "";
  }
}

function removeSource(index: number): void {
  sources.value.splice(index, 1);
}

function submit(): void {
  localError.value = "";
  if (!basicsReady.value) { step.value = 1; localError.value = "Complete the product brief before continuing."; return; }
  if (!sourceReady.value) { step.value = 2; localError.value = "Add at least one product source."; return; }
  emit("submit", { ...form, sources: sources.value });
}
</script>

<template>
  <main class="onboarding-page">
    <header class="onboarding-hero">
      <div>
        <p class="eyebrow">UNIVERSAL PRODUCT ONBOARDING</p>
        <h1>Give us what you have.</h1>
        <p>Code is optional. Distribution-OS separates what you intend, what you publicly claim, and what the available evidence can actually prove.</p>
      </div>
      <osx-badge tone="success" dot>Private local analysis</osx-badge>
    </header>

    <nav class="onboarding-steps" aria-label="Onboarding progress">
      <button v-for="item in 3" :key="item" :class="{ active: step === item, complete: step > item }" @click="step = item">
        <span>{{ step > item ? "✓" : item }}</span>
        <strong>{{ item === 1 ? "Product brief" : item === 2 ? "Evidence sources" : "Review boundaries" }}</strong>
      </button>
    </nav>

    <osx-alert v-if="localError || error" tone="danger" title="Onboarding needs attention">{{ localError || error }}</osx-alert>

    <section v-if="step === 1" class="onboarding-panel">
      <div class="panel-heading"><div><p class="eyebrow">01 · PRODUCT BRIEF</p><h2>What are you building?</h2></div><osx-badge>Founder-provided</osx-badge></div>
      <div class="form-grid">
        <label><span>Product name</span><input v-model="form.name" required placeholder="e.g. Distribution-OS" /></label>
        <label><span>Stage</span><select v-model="form.stage"><option value="idea">Idea</option><option value="prototype">Prototype</option><option value="early">Early product</option><option value="public-beta">Public beta</option><option value="launched">Launched</option></select></label>
        <label class="wide"><span>Plain-language description</span><textarea v-model="form.description" required placeholder="What does the product help someone accomplish?"></textarea></label>
        <label class="wide"><span>Primary audience</span><input v-model="form.audience" required placeholder="Who experiences the problem most acutely?" /></label>
        <label class="wide"><span>Current distribution objective</span><input v-model="form.objective" required placeholder="e.g. Reach the first 25 active design-system users" /></label>
        <label class="wide"><span>Positioning hypothesis <small>Optional and editable</small></span><textarea v-model="form.positioning" placeholder="Why should this audience choose or care about this product?"></textarea></label>
      </div>
      <footer><span>Nothing is published during onboarding.</span><osx-button variant="primary" icon="chevron-right" :disabled="!basicsReady" @click="step = 2">Add evidence</osx-button></footer>
    </section>

    <section v-else-if="step === 2" class="onboarding-panel">
      <div class="panel-heading"><div><p class="eyebrow">02 · EVIDENCE SOURCES</p><h2>Bring code—or don’t.</h2></div><osx-badge tone="info">{{ sources.length }} added</osx-badge></div>
      <div class="source-type-grid">
        <button v-for="option in sourceOptions" :key="option.type" :class="{ active: sourceType === option.type }" @click="sourceType = option.type; localError = ''">
          <osx-icon :name="option.icon" size="21"></osx-icon><span><strong>{{ option.label }}</strong><small>{{ option.detail }}</small></span>
        </button>
      </div>

      <div v-if="sourceType !== 'document'" class="source-entry">
        <label><span>Source label <small>Optional</small></span><input v-model="sourceLabel" placeholder="What should we call this?" /></label>
        <label class="wide"><span>{{ sourceType === 'url' ? 'Public URL' : sourceType === 'repository' ? 'Absolute folder path' : 'Product context' }}</span>
          <textarea v-if="sourceType === 'text'" v-model="sourceValue" rows="6" placeholder="Paste a PRD, pitch, prompt transcript, launch notes, customer context, or anything else that explains the product."></textarea>
          <input v-else v-model="sourceValue" :placeholder="sourceType === 'url' ? 'https://your-product.com' : '/Users/you/projects/your-product'" @keydown.enter.prevent="addTypedSource" />
        </label>
        <osx-button icon="plus" :disabled="!sourceValue.trim()" @click="addTypedSource">Add source</osx-button>
      </div>
      <label v-else class="file-drop">
        <osx-icon name="upload" size="28"></osx-icon>
        <strong>{{ fileBusy ? "Reading documents…" : "Choose product documents" }}</strong>
        <span>PDF, DOCX, Markdown, text, JSON, YAML, or HTML · 8 MB each</span>
        <input type="file" multiple accept=".pdf,.docx,.md,.mdx,.txt,.json,.yaml,.yml,.html,text/*,application/pdf" :disabled="fileBusy" @change="addFiles" />
      </label>

      <div v-if="sources.length" class="source-inventory">
        <article v-for="(source, index) in sources" :key="`${source.type}-${index}`">
          <osx-icon :name="sourceOptions.find((option) => option.type === source.type)?.icon || 'file-text'" size="18"></osx-icon>
          <span><strong>{{ source.label }}</strong><small>{{ source.type }} · {{ source.filename || source.value?.slice(0, 90) || "local document" }}</small></span>
          <osx-button size="small" icon="x" aria-label="Remove source" @click="removeSource(index)"></osx-button>
        </article>
      </div>
      <footer><osx-button icon="chevron-left" @click="step = 1">Back</osx-button><osx-button variant="primary" icon="chevron-right" :disabled="!sourceReady" @click="step = 3">Review evidence policy</osx-button></footer>
    </section>

    <section v-else class="onboarding-panel review-panel">
      <div class="panel-heading"><div><p class="eyebrow">03 · REVIEW</p><h2>Evidence has boundaries.</h2></div><osx-badge tone="warning">Human confirmation required</osx-badge></div>
      <div class="truth-grid">
        <article><osx-icon name="edit" size="22"></osx-icon><div><strong>Intent</strong><p>PRDs, documents, and pasted context establish what you mean to build—not what has shipped.</p></div></article>
        <article><osx-icon name="globe" size="22"></osx-icon><div><strong>Public claim</strong><p>Web pages establish what customers are being promised—not whether the behavior works.</p></div></article>
        <article><osx-icon name="code" size="22"></osx-icon><div><strong>Implementation</strong><p>Repositories can support capability claims, but cannot prove demand or customer value.</p></div></article>
      </div>
      <dl class="brief-review">
        <div><dt>Product</dt><dd>{{ form.name }} · {{ form.stage }}</dd></div>
        <div><dt>Audience</dt><dd>{{ form.audience }}</dd></div>
        <div><dt>Objective</dt><dd>{{ form.objective }}</dd></div>
        <div><dt>Sources</dt><dd>{{ sources.length }} source{{ sources.length === 1 ? "" : "s" }} across {{ new Set(sources.map((source) => source.type)).size }} evidence type{{ new Set(sources.map((source) => source.type)).size === 1 ? "" : "s" }}</dd></div>
      </dl>
      <osx-alert tone="info" title="What happens next">Distribution-OS extracts a bounded local product profile, assigns confidence by evidence class, and creates one founder-reviewable narrative. It does not publish or connect a channel.</osx-alert>
      <footer><osx-button icon="chevron-left" :disabled="busy" @click="step = 2">Back</osx-button><osx-button variant="primary" icon="sparkle" :loading="busy" @click="submit">Build product memory</osx-button></footer>
    </section>
  </main>
</template>
