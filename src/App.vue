<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from "vue";
import { activateAgentRuntime, activateModelProfile, addProductAudienceSignals, decideOpportunity, discoverAIRuntimes, generateProductPlan, loadAIControlPlane, loadDashboard, onboardProduct, recordOpportunityOutcome, refreshWorkspace, saveModelProfile, testModelProfile, updateChannelPolicy } from "./api.ts";
import type { AIControlPlane, Channel, ChannelMode, DashboardState, ModelProviderId, OnboardProductInput, OnboardingSourceInput, Opportunity } from "../server/domain.ts";
import ProductOnboarding from "./ProductOnboarding.vue";

type View = "command" | "onboarding" | "memory" | "audience" | "campaigns" | "channels" | "journal" | "harness" | "settings";

const state = ref<DashboardState | null>(null);
const view = ref<View>("command");
const selectedId = ref("");
const draft = ref("");
const loading = ref(true);
const actionBusy = ref(false);
const onboardingBusy = ref(false);
const planBusy = ref(false);
const planNotice = ref<{ tone: "success" | "warning" | "danger"; title: string; detail: string } | null>(null);
const error = ref("");
const ai = ref<AIControlPlane | null>(null);
const aiBusy = ref(false);
const aiError = ref("");
const profileNotice = ref<{ tone: "success" | "warning" | "danger"; title: string; detail: string } | null>(null);
const profileErrors = reactive({ model: "", baseUrl: "" });
const modelInput = ref<HTMLInputElement | null>(null);
const baseUrlInput = ref<HTMLInputElement | null>(null);
const runtimeModel = ref("");
const testingProfileId = ref("");
const outcomeOpportunityId = ref("");
const outcomeForm = reactive({ metric: "qualified-visits", value: 0, note: "" });
const signalBusy = ref(false);
const signalNotice = ref<{ tone: "success" | "danger"; title: string; detail: string } | null>(null);
const signalForm = reactive({ productId: "", type: "text" as "text" | "url", label: "", value: "" });
const channelEditingId = ref("");
const channelNotice = ref<{ tone: "success" | "danger"; title: string; detail: string } | null>(null);
const channelForm = reactive<{ mode: ChannelMode; dailyLimit: number }>({ mode: "approval", dailyLimit: 1 });
const profileForm = reactive({ name: "", provider: "anthropic" as ModelProviderId, model: "", baseUrl: "https://api.anthropic.com/v1", apiKey: "" });

const readyOpportunities = computed(() => state.value?.opportunities.filter((item) => item.status === "ready") ?? []);
const selected = computed(() => {
  if (!state.value) return null;
  return state.value.opportunities.find((item) => item.id === selectedId.value)
    ?? readyOpportunities.value[0]
    ?? state.value.opportunities[0]
    ?? null;
});
const approved = computed(() => state.value?.opportunities.filter((item) => item.status === "approved") ?? []);
const activeRuntime = computed(() => ai.value?.runtimes.find((runtime) => runtime.id === ai.value?.execution.runtimeId) ?? null);
const activeModelProfile = computed(() => ai.value?.profiles.find((profile) => profile.id === ai.value?.execution.modelProfileId) ?? null);
const selectedProvider = computed(() => ai.value?.providers.find((provider) => provider.id === profileForm.provider));

watch(selected, (opportunity) => {
  draft.value = opportunity?.draftCopy ?? "";
}, { immediate: true });

onMounted(async () => {
  try {
    state.value = await loadDashboard();
    signalForm.productId = state.value.products[0]?.id ?? "";
    if (state.value.onboarding.required) view.value = "onboarding";
    selectedId.value = readyOpportunities.value[0]?.id ?? state.value.opportunities[0]?.id ?? "";
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Distribution-OS could not load its local ledger.";
  } finally {
    loading.value = false;
  }
  try {
    ai.value = await loadAIControlPlane();
  } catch (cause) {
    aiError.value = cause instanceof Error ? cause.message : "The AI control plane could not be loaded.";
  }
});

function selectProvider(providerId: ModelProviderId): void {
  profileForm.provider = providerId;
  const provider = ai.value?.providers.find((item) => item.id === providerId);
  profileForm.baseUrl = provider?.defaultBaseUrl ?? "";
  profileForm.name = "";
  profileForm.model = "";
  profileForm.apiKey = "";
  profileErrors.model = "";
  profileErrors.baseUrl = "";
  profileNotice.value = null;
}

async function saveProfile(): Promise<void> {
  profileNotice.value = null;
  profileErrors.model = profileForm.model.trim() ? "" : "Enter the provider's model identifier.";
  profileErrors.baseUrl = profileForm.baseUrl.trim() ? "" : "Enter the provider base URL.";
  if (profileErrors.model || profileErrors.baseUrl) {
    profileNotice.value = { tone: "danger", title: "Complete the highlighted fields", detail: profileErrors.model || profileErrors.baseUrl };
    await nextTick();
    (profileErrors.model ? modelInput.value : baseUrlInput.value)?.focus();
    return;
  }
  aiBusy.value = true;
  aiError.value = "";
  try {
    ai.value = await saveModelProfile({ ...profileForm, activate: true });
    const saved = ai.value.profiles.find((profile) => profile.provider === profileForm.provider && profile.model === profileForm.model.trim());
    profileForm.apiKey = "";
    profileForm.name = "";
    profileNotice.value = saved?.readiness === "ready"
      ? { tone: "success", title: "Model profile saved", detail: `${saved.name} is selected for cited onboarding and is available to the native harness. Your agent-runtime selection was not changed.` }
      : { tone: "warning", title: "Profile saved—credential required", detail: `The profile is selected for onboarding, but ${saved?.provider ?? profileForm.provider} still needs a Keychain credential or environment variable before AI inference can run.` };
  } catch (cause) {
    profileNotice.value = { tone: "danger", title: "Model profile was not saved", detail: cause instanceof Error ? cause.message : "The model profile could not be saved." };
  } finally {
    aiBusy.value = false;
  }
}

async function chooseModelProfile(id: string): Promise<void> {
  aiBusy.value = true;
  aiError.value = "";
  try {
    ai.value = await activateModelProfile(id);
  } catch (cause) {
    aiError.value = cause instanceof Error ? cause.message : "The model profile could not be activated.";
  } finally {
    aiBusy.value = false;
  }
}

async function verifyModelProfile(id: string): Promise<void> {
  testingProfileId.value = id;
  profileNotice.value = null;
  try {
    const result = await testModelProfile(id);
    profileNotice.value = { tone: "success", title: "Connection verified", detail: `${result.provider} · ${result.model} responded in ${result.durationMs}ms.` };
  } catch (cause) {
    profileNotice.value = { tone: "danger", title: "Connection test failed", detail: cause instanceof Error ? cause.message : "The provider did not respond." };
  } finally {
    testingProfileId.value = "";
  }
}

async function chooseRuntime(id: string): Promise<void> {
  aiBusy.value = true;
  aiError.value = "";
  try {
    ai.value = await activateAgentRuntime(id, runtimeModel.value);
  } catch (cause) {
    aiError.value = cause instanceof Error ? cause.message : "The agent runtime could not be activated.";
  } finally {
    aiBusy.value = false;
  }
}

async function discoverRuntimes(): Promise<void> {
  aiBusy.value = true;
  aiError.value = "";
  try {
    ai.value = await discoverAIRuntimes();
  } catch (cause) {
    aiError.value = cause instanceof Error ? cause.message : "Local runtimes could not be inspected.";
  } finally {
    aiBusy.value = false;
  }
}

async function refresh(): Promise<void> {
  actionBusy.value = true;
  error.value = "";
  try {
    state.value = await refreshWorkspace();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "The workspace could not be refreshed.";
  } finally {
    actionBusy.value = false;
  }
}

async function createProduct(input: OnboardProductInput): Promise<void> {
  onboardingBusy.value = true;
  error.value = "";
  try {
    const result = await onboardProduct(input);
    state.value = result.dashboard;
    signalForm.productId = result.productId;
    selectedId.value = state.value.opportunities.find((item) => item.productId === result.productId)?.id ?? "";
    view.value = "memory";
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "The product could not be onboarded.";
  } finally {
    onboardingBusy.value = false;
  }
}

async function addAudienceSignal(): Promise<void> {
  signalNotice.value = null;
  if (!signalForm.productId || !signalForm.value.trim()) {
    signalNotice.value = { tone: "danger", title: "Signal needs context", detail: "Choose a product and add a public URL or a bounded discussion excerpt." };
    return;
  }
  if (signalForm.type === "url") {
    try { new URL(signalForm.value.trim()); } catch {
      signalNotice.value = { tone: "danger", title: "Enter a complete public URL", detail: "Include https:// so Distribution-OS can import the source safely." };
      return;
    }
  }
  signalBusy.value = true;
  try {
    const source: OnboardingSourceInput = {
      type: signalForm.type,
      label: signalForm.label.trim() || (signalForm.type === "url" ? "Audience source" : "Founder-supplied discussion signal"),
      value: signalForm.value.trim(),
    };
    const result = await addProductAudienceSignals(signalForm.productId, [source]);
    state.value = result.dashboard;
    signalForm.label = "";
    signalForm.value = "";
    signalNotice.value = { tone: "success", title: "Audience signal added", detail: "The observation is now separately labeled evidence for the next plan. It is not treated as verified demand or a live trend." };
  } catch (cause) {
    signalNotice.value = { tone: "danger", title: "Signal could not be added", detail: cause instanceof Error ? cause.message : "The source could not be imported." };
  } finally {
    signalBusy.value = false;
  }
}

async function runDistributionPlan(productId: string): Promise<void> {
  planBusy.value = true;
  planNotice.value = null;
  error.value = "";
  try {
    const result = await generateProductPlan(productId);
    state.value = result.dashboard;
    selectedId.value = result.application.opportunityIds[0] ?? selectedId.value;
    planNotice.value = result.plan.mode === "ai" && result.application.insertedCount > 0
      ? { tone: "success", title: "Cited distribution plan ready", detail: `${result.application.insertedCount} new move${result.application.insertedCount === 1 ? "" : "s"} added for review. Nothing was published.` }
      : result.application.insertedCount === 0
        ? { tone: "warning", title: "Plan already represented", detail: `The cited plan matched work already in the queue, so no duplicate move was added.${result.plan.warning ? ` ${result.plan.warning}` : ""}` }
      : { tone: "warning", title: "Local fallback plan ready", detail: result.plan.warning || "A conservative source-based move was generated without model inference." };
    view.value = "command";
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "The distribution plan could not be generated.";
  } finally {
    planBusy.value = false;
  }
}

function editChannel(channel: Channel): void {
  channelEditingId.value = channel.id;
  channelForm.mode = channel.mode;
  channelForm.dailyLimit = channel.dailyLimit;
  channelNotice.value = null;
}

async function saveChannel(channel: Channel): Promise<void> {
  actionBusy.value = true;
  channelNotice.value = null;
  try {
    state.value = await updateChannelPolicy(channel.id, channelForm);
    channelEditingId.value = "";
    channelNotice.value = { tone: "success", title: `${channel.name} policy saved`, detail: "The next planning run will use this execution mode and daily limit." };
  } catch (cause) {
    channelNotice.value = { tone: "danger", title: "Channel policy was not saved", detail: cause instanceof Error ? cause.message : "Review the values and try again." };
  } finally {
    actionBusy.value = false;
  }
}

async function decide(action: "approve" | "skip" | "restore"): Promise<void> {
  if (!selected.value) return;
  actionBusy.value = true;
  error.value = "";
  const currentId = selected.value.id;
  try {
    state.value = await decideOpportunity(currentId, action, draft.value);
    if (action !== "restore") {
      selectedId.value = state.value.opportunities.find((item) => item.status === "ready")?.id ?? currentId;
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "The decision could not be recorded.";
  } finally {
    actionBusy.value = false;
  }
}

async function saveOutcome(): Promise<void> {
  if (!outcomeOpportunityId.value) return;
  actionBusy.value = true;
  error.value = "";
  try {
    state.value = await recordOpportunityOutcome(outcomeOpportunityId.value, outcomeForm);
    outcomeOpportunityId.value = "";
    outcomeForm.value = 0;
    outcomeForm.note = "";
    view.value = "journal";
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "The outcome could not be recorded.";
  } finally {
    actionBusy.value = false;
  }
}

function selectOpportunity(opportunity: Opportunity): void {
  selectedId.value = opportunity.id;
  view.value = "command";
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(value));
}

const navItems: Array<{ id: View; label: string; icon: string; section?: string }> = [
  { id: "command", label: "Command Center", icon: "dashboard", section: "OPERATE" },
  { id: "onboarding", label: "Add Product", icon: "plus", section: "UNDERSTAND" },
  { id: "memory", label: "Product Memory", icon: "boxes" },
  { id: "audience", label: "Audience Map", icon: "user" },
  { id: "campaigns", label: "Campaigns", icon: "send", section: "EXECUTE" },
  { id: "channels", label: "Channels", icon: "activity" },
  { id: "journal", label: "Distribution Journal", icon: "book", section: "LEARN" },
  { id: "harness", label: "AI Harness", icon: "sparkle", section: "SYSTEM" },
  { id: "settings", label: "Settings", icon: "settings" },
];
</script>

<template>
  <div class="app-stage" data-osx-theme="panther">
    <osx-app-shell
      app-title="Distribution-OS"
      sidebar-width="244px"
      inspector-width="354px"
      :inspector-open="view === 'command'"
      label="Distribution-OS command workspace"
    >
      <div slot="toolbar" class="toolbar-actions">
        <osx-badge tone="success" size="small" dot>LOCAL-FIRST</osx-badge>
        <button v-if="ai" class="engine-chip" title="Open AI Harness" @click="view = 'harness'">
          <osx-icon :name="ai.execution.runtimeId === 'native' ? 'sparkle' : 'terminal'" :size="14"></osx-icon>
          {{ activeRuntime?.name ?? "AI setup" }}<span v-if="activeModelProfile && ai.execution.runtimeId === 'native'">· {{ activeModelProfile.model }}</span>
        </button>
        <span v-if="state" class="toolbar-summary">{{ state.metrics.readyMoves }} moves · {{ state.metrics.evidenceItems }} evidence items</span>
        <osx-button v-if="state && !state.onboarding.required" size="small" icon="plus" @click="view = 'onboarding'">Add product</osx-button>
        <osx-button size="small" icon="refresh" :loading="actionBusy" @click="refresh">Refresh workspace</osx-button>
      </div>

      <nav slot="sidebar" class="source-list" aria-label="Distribution workspace">
        <div class="brand-block">
          <span class="brand-mark">D</span>
          <div><strong>Distribution-OS</strong><small>Governed growth system</small></div>
        </div>
        <template v-for="item in navItems" :key="item.id">
          <p v-if="item.section" class="nav-section">{{ item.section }}</p>
          <button :class="['nav-item', { active: view === item.id }]" :aria-current="view === item.id ? 'page' : undefined" @click="view = item.id">
            <osx-icon :name="item.icon" :size="18"></osx-icon>
            <span>{{ item.label }}</span>
            <b v-if="item.id === 'command' && state">{{ state.metrics.readyMoves }}</b>
            <b v-else-if="item.id === 'campaigns' && approved.length">{{ approved.length }}</b>
          </button>
        </template>
        <section class="privacy-card">
          <osx-icon name="lock" :size="18"></osx-icon>
          <div><strong>Private by default</strong><span>Product memory and drafts remain on this machine.</span></div>
        </section>
      </nav>

      <osx-alert v-if="error && state && view !== 'command' && view !== 'onboarding'" class="global-alert" tone="danger" title="Action needs attention" dismissible @dismiss="error = ''">{{ error }}</osx-alert>

      <section v-if="loading" class="loading-state" aria-live="polite">
        <osx-spinner size="large" label="Loading distribution memory"></osx-spinner>
        <strong>Reading the local distribution ledger…</strong>
      </section>

      <osx-alert v-else-if="error && !state" tone="danger" title="Local service unavailable">{{ error }}</osx-alert>

      <ProductOnboarding v-else-if="state && view === 'onboarding'" :busy="onboardingBusy" :error="error" @submit="createProduct" />

      <main v-else-if="state && view === 'command'" class="command-center">
        <osx-alert v-if="error" tone="danger" title="Action needs attention" dismissible @dismiss="error = ''">{{ error }}</osx-alert>
        <osx-alert v-if="planNotice" :tone="planNotice.tone" :title="planNotice.title" dismissible @dismiss="planNotice = null">{{ planNotice.detail }}</osx-alert>
        <header class="command-hero">
          <div>
            <p class="eyebrow">TODAY'S DISTRIBUTION BRIEF</p>
            <h1>{{ state.metrics.readyMoves === 0 ? "No forced activity." : state.metrics.readyMoves === 1 ? "One move worth making." : `${state.metrics.readyMoves} moves worth making.` }}</h1>
            <p>Each move is grounded in product evidence, matched to an audience, and bounded by your channel policy.</p>
          </div>
          <div class="system-score"><span>Evidence confidence</span><strong>{{ state.metrics.analysisConfidence }}%</strong><small>Derived from source coverage</small></div>
        </header>

        <section class="metric-grid" aria-label="Distribution metrics">
          <article><span>Ready moves</span><strong>{{ state.metrics.readyMoves }}</strong><small>Ranked by usefulness</small></article>
          <article><span>Approved</span><strong>{{ state.metrics.approvedMoves }}</strong><small>Waiting for execution</small></article>
          <article><span>Product evidence</span><strong>{{ state.metrics.evidenceItems }}</strong><small>Across {{ state.products.length }} product{{ state.products.length === 1 ? "" : "s" }}</small></article>
          <article><span>Live connectors</span><strong>{{ state.metrics.connectedChannels }}</strong><small>Manual gates active</small></article>
        </section>

        <section class="queue-section">
          <div class="section-heading">
            <div><p class="eyebrow">OPPORTUNITY QUEUE</p><h2>Contribution before promotion</h2></div>
            <osx-badge tone="info">{{ readyOpportunities.length }} ready</osx-badge>
          </div>
          <div class="opportunity-list">
            <button
              v-for="(opportunity, index) in readyOpportunities"
              :key="opportunity.id"
              :class="['opportunity-card', { selected: selected?.id === opportunity.id }]"
              @click="selectOpportunity(opportunity)"
            >
              <span class="rank">0{{ index + 1 }}</span>
              <div class="opportunity-copy">
                <div class="opportunity-meta">
                  <osx-badge tone="info" size="small">{{ opportunity.channelName }}</osx-badge>
                  <span>{{ opportunity.productName }}</span>
                  <span>{{ opportunity.type.replaceAll('-', ' ') }}</span>
                </div>
                <h3>{{ opportunity.title }}</h3>
                <p>{{ opportunity.context }}</p>
                <div class="evidence-line"><osx-icon name="check" :size="15"></osx-icon>{{ opportunity.evidence.length }} supporting evidence items</div>
              </div>
              <div class="opportunity-score"><strong>{{ opportunity.score }}</strong><span>FIT</span><osx-icon name="chevron-right" :size="18"></osx-icon></div>
            </button>
            <osx-empty-state v-if="!readyOpportunities.length && !state.products.length" icon="boxes" title="No product memory yet">
              Add a product from a repository, URL, document, or pasted context before Distribution-OS recommends a move.
              <osx-button slot="actions" variant="primary" icon="plus" @click="view = 'onboarding'">Onboard a product</osx-button>
            </osx-empty-state>
            <osx-empty-state v-else-if="!readyOpportunities.length" icon="check" title="Today's queue is clear">
              Approved and skipped work remains available in Campaigns and the Journal. Generate another evidence-grounded plan when you are ready to learn from the next move.
              <osx-button slot="actions" variant="primary" icon="sparkle" :loading="planBusy" @click="runDistributionPlan(state.products[0].id)">Generate next plan</osx-button>
            </osx-empty-state>
          </div>
        </section>
      </main>

      <main v-else-if="state && view === 'memory'" class="workspace-page">
        <header class="page-header-with-action"><div><p class="eyebrow">PRODUCT MEMORY</p><h1>The truth Distribution-OS can use.</h1><p>Intent, public claims, and implementation evidence remain distinct.</p></div><osx-button variant="primary" icon="plus" @click="view = 'onboarding'">Add product</osx-button></header>
        <div class="product-grid">
          <article v-for="product in state.products" :key="product.id" class="product-card">
            <div><span class="product-monogram">{{ product.name.charAt(0) }}</span><osx-badge tone="success" size="small">{{ product.confidence }}% evidence</osx-badge></div>
            <h2>{{ product.name }}</h2><p>{{ product.description }}</p>
            <dl class="product-brief"><div><dt>Audience</dt><dd>{{ product.audience }}</dd></div><div><dt>Objective</dt><dd>{{ product.objective }}</dd></div></dl>
            <footer><strong>{{ product.evidenceCount }} evidence items · {{ product.stage }}</strong><span class="product-actions"><osx-link v-if="product.websiteUrl || product.repositoryUrl" :href="product.websiteUrl || product.repositoryUrl" external>Open source</osx-link><osx-button size="small" icon="sparkle" :loading="planBusy" @click="runDistributionPlan(product.id)">Generate plan</osx-button></span></footer>
          </article>
          <osx-empty-state v-if="!state.products.length" class="page-empty-state" icon="boxes" title="Product memory is empty">
            Start with whatever explains the product today. Code is useful, but it is not required.
            <osx-button slot="actions" variant="primary" icon="plus" @click="view = 'onboarding'">Add the first product</osx-button>
          </osx-empty-state>
          <button v-else class="add-product-card" @click="view = 'onboarding'"><osx-icon name="plus" :size="24"></osx-icon><strong>Add another product</strong><span>Repository, URL, document, or pasted context</span></button>
        </div>
      </main>

      <main v-else-if="state && view === 'audience'" class="workspace-page">
        <header><p class="eyebrow">AUDIENCE MAP</p><h1>Problems, people, and places.</h1><p>The system optimizes for relevance—not reach without context.</p></header>
        <div v-if="state.products.length" class="audience-grid">
          <article v-for="product in state.products" :key="product.id"><osx-icon name="user" :size="24"></osx-icon><h2>{{ product.audience }}</h2><p>{{ product.name }} is currently optimizing for: {{ product.objective }}</p><div><osx-badge>{{ product.stage }}</osx-badge><osx-badge tone="info">{{ product.confidence }}% evidence</osx-badge></div></article>
        </div>
        <osx-empty-state v-else class="page-empty-state" icon="user" title="No audience has been established">Audience hypotheses appear only after a product has been onboarded and reviewed.<osx-button slot="actions" variant="primary" icon="plus" @click="view = 'onboarding'">Onboard a product</osx-button></osx-empty-state>
        <section v-if="state.products.length" class="audience-signal-panel">
          <div class="section-heading"><div><p class="eyebrow">AUDIENCE EVIDENCE</p><h2>Bring the conversation into the loop.</h2><p>Add a public discussion URL or paste a bounded excerpt you observed. Distribution-OS labels it as founder-supplied audience evidence—it never upgrades one observation into a trend.</p></div><osx-badge tone="info">{{ state.audienceSignals?.length || 0 }} signals</osx-badge></div>
          <form class="signal-form" @submit.prevent="addAudienceSignal">
            <label>Product<select v-model="signalForm.productId"><option v-for="product in state.products" :key="product.id" :value="product.id">{{ product.name }}</option></select></label>
            <label>Source type<select v-model="signalForm.type"><option value="text">Paste discussion context</option><option value="url">Public URL</option></select></label>
            <label>Source label <small>Make citations recognizable</small><input v-model="signalForm.label" placeholder="Example: Hacker News launch discussion" /></label>
            <label class="wide">{{ signalForm.type === 'url' ? 'Public discussion URL' : 'What did the audience say or ask?' }}
              <input v-if="signalForm.type === 'url'" v-model="signalForm.value" type="url" placeholder="https://…" />
              <textarea v-else v-model="signalForm.value" rows="5" placeholder="Paste only the relevant public excerpt or your own bounded observation. Include uncertainty and context."></textarea>
            </label>
            <footer><span>Nothing is posted or contacted. This becomes citable input for the next plan.</span><osx-button type="button" variant="primary" icon="plus" :loading="signalBusy" :disabled="!signalForm.value.trim()" @click="addAudienceSignal">Add audience signal</osx-button></footer>
          </form>
          <osx-alert v-if="signalNotice" :tone="signalNotice.tone" :title="signalNotice.title" dismissible @dismiss="signalNotice = null">{{ signalNotice.detail }}</osx-alert>
          <div v-if="state.audienceSignals?.length" class="signal-list">
            <article v-for="signal in state.audienceSignals" :key="signal.id"><span class="signal-icon"><osx-icon :name="signal.sourceType === 'url' ? 'globe' : 'message-circle'" :size="18"></osx-icon></span><div><strong>{{ signal.title }}</strong><p>{{ signal.summary }}</p><small>{{ signal.productName }} · {{ formatDate(signal.occurredAt) }} · founder supplied</small></div><osx-link v-if="signal.sourceUrl" :href="signal.sourceUrl" external>Open source</osx-link></article>
          </div>
          <osx-empty-state v-else icon="message-circle" title="No audience evidence yet">Product evidence explains what you built. Audience evidence explains what people are discussing. Add one real observation before asking the agent to infer where to contribute.</osx-empty-state>
        </section>
      </main>

      <main v-else-if="state && view === 'campaigns'" class="workspace-page">
        <header><p class="eyebrow">CAMPAIGNS</p><h1>Approved narratives in motion.</h1><p>One product moment can become several channel-native contributions without repeating itself.</p></header>
        <section class="data-panel">
          <div v-for="opportunity in approved" :key="opportunity.id" class="campaign-row">
            <span class="status-orb"></span><div><strong>{{ opportunity.title }}</strong><small>{{ opportunity.productName }} · {{ opportunity.channelName }}</small></div><osx-badge tone="success">Approved</osx-badge><span class="campaign-actions"><osx-button size="small" @click="selectOpportunity(opportunity); decide('restore')">Return to queue</osx-button><osx-button size="small" variant="primary" icon="activity" @click="outcomeOpportunityId = opportunity.id">Record outcome</osx-button></span>
          </div>
          <form v-if="outcomeOpportunityId" class="outcome-form" @submit.prevent="saveOutcome">
            <div><p class="eyebrow">CLOSE THE LOOP</p><h2>What happened after the approved move?</h2><p>Measured outcomes become evidence for the next planning run.</p></div>
            <label>Metric<select v-model="outcomeForm.metric"><option value="qualified-visits">Qualified visits</option><option value="replies">Replies</option><option value="conversations">Conversations</option><option value="signups">Signups</option><option value="stars">Stars</option><option value="revenue">Revenue</option></select></label>
            <label>Value<input v-model.number="outcomeForm.value" type="number" min="0" step="any" /></label>
            <label class="wide">What did you learn?<textarea v-model="outcomeForm.note" rows="3" placeholder="Optional context that should influence the next plan"></textarea></label>
            <footer><osx-button size="small" @click="outcomeOpportunityId = ''">Cancel</osx-button><osx-button type="button" variant="primary" icon="check" :loading="actionBusy" @click="saveOutcome">Record & learn</osx-button></footer>
          </form>
          <osx-empty-state v-if="!approved.length" icon="send" title="No approved campaigns yet">Approve a move from the Command Center to place it here.</osx-empty-state>
        </section>
      </main>

      <main v-else-if="state && view === 'channels'" class="workspace-page">
        <header><p class="eyebrow">CHANNEL POLICY</p><h1>Autonomy is granted—not assumed.</h1><p>Every destination owns its own approval mode, volume limit, and connection state.</p></header>
        <section class="channel-grid">
          <article v-for="channel in state.channels" :key="channel.id" class="channel-card">
            <header><span class="channel-mark">{{ channel.name.charAt(0) }}</span><div><h2>{{ channel.name }}</h2><p>{{ channel.handle }}</p></div><osx-badge :tone="channel.connected ? 'success' : channel.status === 'manual' ? 'warning' : 'neutral'" dot>{{ channel.status }}</osx-badge></header>
            <dl><div><dt>Execution mode</dt><dd>{{ channel.mode }}</dd></div><div><dt>Daily limit</dt><dd>{{ channel.dailyLimit }}</dd></div><div><dt>Reply automation</dt><dd>Approval required</dd></div></dl>
            <form v-if="channelEditingId === channel.id" class="channel-policy-form" @submit.prevent="saveChannel(channel)">
              <label>Execution mode<select v-model="channelForm.mode"><option value="draft">Draft only</option><option value="approval">Human approval</option><option value="autopilot">Autopilot within policy</option></select></label>
              <label>Daily limit<input v-model.number="channelForm.dailyLimit" type="number" min="0" max="100" step="1" /></label>
              <small>Connection credentials are configured separately. This policy only governs what the harness may propose or execute.</small>
              <footer><osx-button size="small" @click="channelEditingId = ''">Cancel</osx-button><osx-button type="button" size="small" variant="primary" icon="check" :loading="actionBusy" @click="saveChannel(channel)">Save policy</osx-button></footer>
            </form>
            <footer v-else><osx-toggle :checked="channel.connected" disabled>{{ channel.connected ? 'Connection enabled' : 'Not connected' }}</osx-toggle><osx-button size="small" icon="settings" @click="editChannel(channel)">Configure policy</osx-button></footer>
          </article>
        </section>
        <osx-alert v-if="channelNotice" :tone="channelNotice.tone" :title="channelNotice.title" dismissible @dismiss="channelNotice = null">{{ channelNotice.detail }}</osx-alert>
      </main>

      <main v-else-if="state && view === 'journal'" class="workspace-page">
        <header><p class="eyebrow">DISTRIBUTION JOURNAL</p><h1>The system remembers what happened.</h1><p>Decisions, executions, outcomes, and lessons form the feedback loop.</p></header>
        <ol class="journal-list">
          <li v-for="event in state.products.length ? state.recentEvents : []" :key="event.id"><span class="timeline-dot"></span><time>{{ formatDate(event.occurredAt) }}<small>{{ formatTime(event.occurredAt) }}</small></time><div><strong>{{ event.type.replaceAll('.', ' ') }}</strong><p>{{ event.detail }}</p></div><osx-badge size="small">{{ event.entityType }}</osx-badge></li>
          <osx-empty-state v-if="!state.products.length || !state.recentEvents.length" icon="book" title="The journal is empty">Product onboarding, decisions, executions, and measured outcomes will appear here in chronological order.</osx-empty-state>
        </ol>
      </main>

      <main v-else-if="state && view === 'harness'" class="workspace-page harness-page">
        <header class="page-header-with-action">
          <div><p class="eyebrow">AI EXECUTION CONTROL PLANE</p><h1>Choose who owns the agent loop.</h1><p>Model APIs power cited onboarding and the native Distribution-OS harness. Agent runtimes bring their own tools, authentication, session behavior, and model controls.</p></div>
          <osx-button icon="refresh" :loading="aiBusy" @click="discoverRuntimes">Discover runtimes</osx-button>
        </header>

        <osx-alert v-if="aiError" tone="danger" title="AI setup needs attention" dismissible @dismiss="aiError = ''">{{ aiError }}</osx-alert>
        <section v-if="!ai" class="loading-state" aria-live="polite"><osx-spinner label="Inspecting local AI runtimes"></osx-spinner><strong>Inspecting local providers and agent runtimes…</strong></section>

        <section v-if="ai" class="execution-summary">
          <div class="execution-mark"><osx-icon :name="ai.execution.runtimeId === 'native' ? 'sparkle' : 'terminal'" :size="24"></osx-icon></div>
          <div><span>ACTIVE EXECUTION PROFILE</span><strong>{{ activeRuntime?.name }}</strong><small v-if="ai.execution.runtimeId === 'native'">{{ activeModelProfile ? `${activeModelProfile.name} · ${activeModelProfile.model}` : "Add a model profile to enable AI-backed analysis." }}</small><small v-else>{{ ai.execution.runtimeModel || "The runtime's default model" }} · onboarding via {{ activeModelProfile?.name || "local extraction" }}</small></div>
          <osx-badge :tone="activeRuntime?.available && (ai.execution.runtimeId !== 'native' || activeModelProfile?.readiness === 'ready') ? 'success' : 'warning'" dot>{{ activeRuntime?.available && (ai.execution.runtimeId !== 'native' || activeModelProfile?.readiness === 'ready') ? "Ready" : "Setup required" }}</osx-badge>
        </section>

        <section class="ownership-grid" aria-label="AI execution ownership">
          <article><osx-icon name="sparkle" :size="22"></osx-icon><div><h2>Model APIs</h2><p>Distribution-OS owns planning, bounded tools, product memory, approvals, retries, and outcome learning. The provider supplies inference only.</p></div></article>
          <article><osx-icon name="terminal" :size="22"></osx-icon><div><h2>Agent runtimes</h2><p>Claude Code, Cursor, OpenCode, or Codex own their internal agent loop. Distribution-OS supplies the task, evidence, policy, and records the result.</p></div></article>
        </section>

        <section v-if="ai" class="harness-section">
          <div class="section-heading">
            <div><p class="eyebrow">AGENT RUNTIMES</p><h2>Use an installed coding agent as the execution engine</h2><p>Discovery verifies installation. Claude authentication is preflighted; other runtimes verify their own authentication when a run starts.</p></div>
            <span>Last checked {{ formatTime(ai.generatedAt) }}</span>
          </div>
          <div class="runtime-grid">
            <article v-for="runtime in ai.runtimes" :key="runtime.id" :class="['runtime-card', { selected: ai.execution.runtimeId === runtime.id, unavailable: !runtime.available }]">
              <header><span class="runtime-icon"><osx-icon :name="runtime.id === 'native' ? 'sparkle' : 'terminal'" :size="20"></osx-icon></span><div><h3>{{ runtime.name }}</h3><small>{{ runtime.version || (runtime.id === 'native' ? 'Built in' : runtime.command) }}</small></div><osx-badge :tone="runtime.availability === 'available' ? 'success' : runtime.availability === 'setup-required' ? 'warning' : 'neutral'" size="small" dot>{{ runtime.availability.replace('-', ' ') }}</osx-badge></header>
              <p>{{ runtime.detail }}</p>
              <ul><li v-for="capability in runtime.capabilities" :key="capability"><osx-icon name="check" :size="13"></osx-icon>{{ capability }}</li></ul>
              <label v-if="runtime.id !== 'native' && runtime.ownsModelSelection && ai.execution.runtimeId === runtime.id">Runtime model override <input v-model="runtimeModel" placeholder="Optional — use runtime default" /></label>
              <footer><span>{{ runtime.ownsModelSelection ? "Runtime owns model selection" : "Uses the active model profile" }}</span><osx-button size="small" :variant="ai.execution.runtimeId === runtime.id ? 'secondary' : 'primary'" :disabled="!runtime.available || aiBusy || ai.execution.runtimeId === runtime.id" @click="chooseRuntime(runtime.id)">{{ ai.execution.runtimeId === runtime.id ? "Active" : "Use runtime" }}</osx-button></footer>
            </article>
          </div>
        </section>

        <section v-if="ai" class="harness-section">
          <div class="section-heading">
            <div><p class="eyebrow">MODEL APIS</p><h2>Inference for onboarding and the native harness</h2><p>The selected profile powers source-cited onboarding even when an external runtime owns longer agent work. Secrets are read from provider environment variables or {{ ai.secureStorage }} and never enter the ledger.</p></div>
            <osx-badge>{{ ai.profiles.length }} profile{{ ai.profiles.length === 1 ? "" : "s" }}</osx-badge>
          </div>

          <div class="provider-layout">
            <div class="provider-list" role="list" aria-label="Model providers">
              <button v-for="provider in ai.providers" :key="provider.id" :class="{ active: profileForm.provider === provider.id }" @click="selectProvider(provider.id)">
                <span><strong>{{ provider.name }}</strong><small>{{ provider.category }}</small></span><osx-icon name="chevron-right" :size="16"></osx-icon>
              </button>
            </div>
            <form class="provider-form" novalidate @submit.prevent="saveProfile" @keydown.enter.prevent="saveProfile">
              <div class="provider-form-heading"><div><h3>{{ selectedProvider?.name }}</h3><p>{{ selectedProvider?.description }}</p></div><osx-badge>{{ selectedProvider?.category }}</osx-badge></div>
              <div class="provider-form-grid">
                <label>Profile name <input v-model="profileForm.name" placeholder="Optional label" /></label>
                <label :class="{ invalid: profileErrors.model }">Model ID <input ref="modelInput" v-model="profileForm.model" :aria-invalid="Boolean(profileErrors.model)" aria-describedby="model-id-feedback" placeholder="Provider model identifier" @input="profileErrors.model = ''; profileNotice = null" /><small id="model-id-feedback" :class="{ 'field-error': profileErrors.model }">{{ profileErrors.model || "Use the exact model ID exposed by the provider." }}</small></label>
                <label class="wide" :class="{ invalid: profileErrors.baseUrl }">Base URL <input ref="baseUrlInput" v-model="profileForm.baseUrl" :aria-invalid="Boolean(profileErrors.baseUrl)" :aria-describedby="profileErrors.baseUrl ? 'base-url-feedback' : undefined" inputmode="url" @input="profileErrors.baseUrl = ''; profileNotice = null" /><small v-if="profileErrors.baseUrl" id="base-url-feedback" class="field-error">{{ profileErrors.baseUrl }}</small></label>
                <label v-if="profileForm.provider !== 'ollama'" class="wide">API key <input v-model="profileForm.apiKey" type="password" autocomplete="off" :placeholder="selectedProvider?.environmentVariables.length ? `Optional if ${selectedProvider.environmentVariables.join(' or ')} is set` : 'Stored securely'" /><small>Leave blank to use an environment variable. A supplied key is saved only to {{ ai.secureStorage }}.</small></label>
              </div>
              <osx-alert v-if="profileNotice" class="profile-notice" :tone="profileNotice.tone" :title="profileNotice.title">{{ profileNotice.detail }}</osx-alert>
              <footer><span>Saving selects this API for onboarding and native inference. It does not change the selected agent runtime.</span><osx-button type="button" variant="primary" icon="plus" :loading="aiBusy" @click="saveProfile">Save profile</osx-button></footer>
            </form>
          </div>

          <div v-if="ai.profiles.length" class="profile-list">
            <article v-for="profile in ai.profiles" :key="profile.id" :class="{ active: ai.execution.modelProfileId === profile.id }">
              <span class="provider-monogram">{{ profile.provider.charAt(0).toUpperCase() }}</span>
              <div><strong>{{ profile.name }}</strong><small>{{ profile.provider }} · {{ profile.model }} · {{ profile.credentialSource }}</small></div>
              <osx-badge :tone="profile.readiness === 'ready' ? 'success' : 'warning'" size="small" dot>{{ profile.readiness.replaceAll('-', ' ') }}</osx-badge>
              <span class="profile-actions"><osx-button size="small" :loading="testingProfileId === profile.id" :disabled="profile.readiness !== 'ready' || Boolean(testingProfileId)" @click="verifyModelProfile(profile.id)">Test</osx-button><osx-button size="small" :disabled="profile.readiness !== 'ready' || aiBusy || (ai.execution.runtimeId === 'native' && ai.execution.modelProfileId === profile.id)" @click="chooseModelProfile(profile.id)">{{ ai.execution.runtimeId === 'native' && ai.execution.modelProfileId === profile.id ? "Active native" : ai.execution.modelProfileId === profile.id ? "Use native" : "Select & use native" }}</osx-button></span>
            </article>
          </div>
          <osx-empty-state v-else icon="sparkle" title="No model profiles configured">The deterministic local analyzer still works. Add a provider when you want model-backed research, synthesis, and agent execution.</osx-empty-state>
        </section>

        <section v-if="state.harnessRuns?.length" class="harness-section">
          <div class="section-heading"><div><p class="eyebrow">RUN LEDGER</p><h2>Every plan leaves evidence</h2><p>Model calls, tool chaining, fallbacks, and failures remain inspectable without storing prompts or credentials.</p></div><osx-badge>{{ state.harnessRuns.length }} recent</osx-badge></div>
          <div class="run-ledger">
            <article v-for="run in state.harnessRuns" :key="run.id">
              <header><div><strong>{{ run.kind.replaceAll('-', ' ') }}</strong><small>{{ run.provider ? `${run.provider} · ${run.model}` : run.runtimeId }}</small></div><osx-badge :tone="run.status === 'completed' ? 'success' : run.status === 'failed' ? 'danger' : 'warning'" dot>{{ run.status }}</osx-badge></header>
              <p>{{ run.summary || run.error || 'Run in progress' }}</p>
              <ol><li v-for="step in run.steps" :key="step.id"><span :class="['run-step-dot', step.status]"></span><div><strong>{{ step.name }}</strong><small>{{ step.detail }}</small></div></li></ol>
            </article>
          </div>
        </section>
        <section v-else class="harness-section">
          <div class="section-heading"><div><p class="eyebrow">RUN LEDGER</p><h2>No harness runs yet</h2><p>The first onboarding synthesis or distribution plan will record its engine, steps, retries, fallbacks, and result here.</p></div><osx-badge>0 runs</osx-badge></div>
          <osx-empty-state icon="activity" title="Run evidence will appear here">
            {{ state.products.length ? "Generate a plan from Product Memory to exercise the selected execution engine. Nothing will be published." : "Onboard a product first so the harness has bounded evidence to work from." }}
            <osx-button slot="actions" variant="primary" :icon="state.products.length ? 'sparkle' : 'plus'" @click="view = state.products.length ? 'memory' : 'onboarding'">{{ state.products.length ? "Open product memory" : "Onboard a product" }}</osx-button>
          </osx-empty-state>
        </section>
      </main>

      <main v-else-if="state && view === 'settings'" class="workspace-page">
        <header><p class="eyebrow">SYSTEM</p><h1>Local control plane.</h1><p>The database, product memory, voice model, and approval history stay under your control.</p></header>
        <section class="settings-grid">
          <article><osx-icon name="lock" :size="24"></osx-icon><div><h2>Private local ledger</h2><p>{{ state.storage.location }}</p></div><osx-badge tone="success">Active</osx-badge></article>
          <article><osx-icon name="activity" :size="24"></osx-icon><div><h2>Managed execution cloud</h2><p>Optional future layer for scheduled publishing, monitoring, and team access.</p></div><osx-badge>Not enabled</osx-badge></article>
          <article><osx-icon name="user" :size="24"></osx-icon><div><h2>Human approval kernel</h2><p>Public replies, new channels, and sensitive claims require explicit judgment.</p></div><osx-badge tone="info">Required</osx-badge></article>
        </section>
      </main>

      <aside v-if="view === 'command'" slot="inspector" :class="['inspector-panel', { empty: !selected }]">
        <template v-if="selected">
          <header>
          <div><p class="eyebrow">MOVE INSPECTOR</p><h2>{{ selected.channelName }}</h2></div>
          <osx-badge :tone="selected.promotionRisk < 15 ? 'success' : 'warning'">{{ selected.promotionRisk }} risk</osx-badge>
          </header>
          <section class="reason-card"><h3>Why now</h3><p>{{ selected.whyNow }}</p></section>
          <section class="reason-card"><h3>Contribution angle</h3><p>{{ selected.suggestedAngle }}</p><small>{{ selected.audience }}</small></section>
          <section class="score-panel">
            <h3>Decision signals</h3>
            <div><span>Relevance</span><osx-progress :value="selected.relevanceScore" :max="100"></osx-progress><b>{{ selected.relevanceScore }}</b></div>
            <div><span>Audience value</span><osx-progress :value="selected.valueScore" :max="100"></osx-progress><b>{{ selected.valueScore }}</b></div>
            <div><span>Freshness</span><osx-progress :value="selected.freshnessScore" :max="100"></osx-progress><b>{{ selected.freshnessScore }}</b></div>
          </section>
          <section class="evidence-panel">
            <h3>What proves it</h3>
            <template v-for="item in selected.evidence" :key="item.id">
              <a v-if="item.sourceUrl" :href="item.sourceUrl" target="_blank" rel="noreferrer"><osx-icon name="file-text" :size="16"></osx-icon><span><strong>{{ item.title }}</strong><small>{{ item.summary }}</small></span><osx-icon name="external" :size="14"></osx-icon></a>
              <div v-else class="evidence-static"><osx-icon name="file-text" :size="16"></osx-icon><span><strong>{{ item.title }}</strong><small>{{ item.summary }}</small></span><osx-badge size="small">{{ item.classification }}</osx-badge></div>
            </template>
          </section>
          <section class="draft-panel">
            <div><h3>Proposed contribution</h3><osx-badge size="small">Editable</osx-badge></div>
            <textarea v-model="draft" aria-label="Proposed contribution draft"></textarea>
          </section>
          <footer class="decision-bar">
            <osx-button size="small" :disabled="actionBusy" @click="decide('skip')">Skip for now</osx-button>
            <osx-button variant="primary" icon="check" :loading="actionBusy" @click="decide('approve')">Approve & queue</osx-button>
          </footer>
        </template>
        <osx-empty-state v-else icon="search" title="Nothing to inspect">
          Select a recommended move to review its evidence and draft. Onboard a product first if the queue is empty.
          <osx-button slot="actions" variant="primary" icon="plus" @click="view = 'onboarding'">Onboard a product</osx-button>
        </osx-empty-state>
      </aside>

      <osx-status-bar slot="status" :label="state?.onboarding.required ? 'Product onboarding required' : state ? 'Local ledger ready' : 'Starting local ledger'" :status="error ? 'offline' : loading ? 'working' : 'ready'" :detail="state ? `Updated ${formatTime(state.generatedAt)}` : ''">
        <span v-if="state">· Human approval required for public actions</span>
      </osx-status-bar>
    </osx-app-shell>
  </div>
</template>
