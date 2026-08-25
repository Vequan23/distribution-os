<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { decideOpportunity, loadDashboard, onboardProduct, refreshSignals } from "./api.ts";
import type { DashboardState, OnboardProductInput, Opportunity } from "../server/domain.ts";
import ProductOnboarding from "./ProductOnboarding.vue";

type View = "command" | "onboarding" | "memory" | "audience" | "campaigns" | "channels" | "journal" | "settings";

const state = ref<DashboardState | null>(null);
const view = ref<View>("command");
const selectedId = ref("");
const draft = ref("");
const loading = ref(true);
const actionBusy = ref(false);
const onboardingBusy = ref(false);
const error = ref("");

const readyOpportunities = computed(() => state.value?.opportunities.filter((item) => item.status === "ready") ?? []);
const selected = computed(() => {
  if (!state.value) return null;
  return state.value.opportunities.find((item) => item.id === selectedId.value)
    ?? readyOpportunities.value[0]
    ?? state.value.opportunities[0]
    ?? null;
});
const approved = computed(() => state.value?.opportunities.filter((item) => item.status === "approved") ?? []);

watch(selected, (opportunity) => {
  draft.value = opportunity?.draftCopy ?? "";
}, { immediate: true });

onMounted(async () => {
  try {
    state.value = await loadDashboard();
    if (state.value.onboarding.required) view.value = "onboarding";
    selectedId.value = readyOpportunities.value[0]?.id ?? state.value.opportunities[0]?.id ?? "";
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Distribution-OS could not load its local ledger.";
  } finally {
    loading.value = false;
  }
});

async function refresh(): Promise<void> {
  actionBusy.value = true;
  error.value = "";
  try {
    state.value = await refreshSignals();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Signals could not be refreshed.";
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
    selectedId.value = state.value.opportunities.find((item) => item.productId === result.productId)?.id ?? "";
    view.value = "memory";
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "The product could not be onboarded.";
  } finally {
    onboardingBusy.value = false;
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
  { id: "settings", label: "Settings", icon: "settings", section: "SYSTEM" },
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
        <span v-if="state" class="toolbar-summary">{{ state.metrics.readyMoves }} moves · {{ state.metrics.evidenceItems }} evidence items</span>
        <osx-button v-if="state && !state.onboarding.required" size="small" icon="plus" @click="view = 'onboarding'">Add product</osx-button>
        <osx-button size="small" icon="refresh" :loading="actionBusy" @click="refresh">Reload evidence</osx-button>
      </div>

      <nav slot="sidebar" class="source-list" aria-label="Distribution workspace">
        <div class="brand-block">
          <span class="brand-mark">D</span>
          <div><strong>Distribution-OS</strong><small>Governed growth system</small></div>
        </div>
        <template v-for="item in navItems" :key="item.id">
          <p v-if="item.section" class="nav-section">{{ item.section }}</p>
          <button :class="['nav-item', { active: view === item.id }]" :aria-current="view === item.id ? 'page' : undefined" @click="view = item.id">
            <osx-icon :name="item.icon" size="18"></osx-icon>
            <span>{{ item.label }}</span>
            <b v-if="item.id === 'command' && state">{{ state.metrics.readyMoves }}</b>
            <b v-else-if="item.id === 'campaigns' && approved.length">{{ approved.length }}</b>
          </button>
        </template>
        <section class="privacy-card">
          <osx-icon name="lock" size="18"></osx-icon>
          <div><strong>Private by default</strong><span>Product memory and drafts remain on this machine.</span></div>
        </section>
      </nav>

      <section v-if="loading" class="loading-state" aria-live="polite">
        <osx-spinner size="large" label="Loading distribution memory"></osx-spinner>
        <strong>Reading the local distribution ledger…</strong>
      </section>

      <osx-alert v-else-if="error && !state" tone="danger" title="Local service unavailable">{{ error }}</osx-alert>

      <ProductOnboarding v-else-if="state && view === 'onboarding'" :busy="onboardingBusy" :error="error" @submit="createProduct" />

      <main v-else-if="state && view === 'command'" class="command-center">
        <osx-alert v-if="error" tone="danger" title="Action needs attention" dismissible @dismiss="error = ''">{{ error }}</osx-alert>
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
                <div class="evidence-line"><osx-icon name="check" size="15"></osx-icon>{{ opportunity.evidence.length }} supporting evidence items</div>
              </div>
              <div class="opportunity-score"><strong>{{ opportunity.score }}</strong><span>FIT</span><osx-icon name="chevron-right" size="18"></osx-icon></div>
            </button>
            <osx-empty-state v-if="!readyOpportunities.length && !state.products.length" icon="boxes" title="No product memory yet">
              Add a product from a repository, URL, document, or pasted context before Distribution-OS recommends a move.
              <osx-button slot="actions" variant="primary" icon="plus" @click="view = 'onboarding'">Onboard a product</osx-button>
            </osx-empty-state>
            <osx-empty-state v-else-if="!readyOpportunities.length" icon="check" title="Today's queue is clear">Approved and skipped work remains available in Campaigns and the Journal.</osx-empty-state>
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
            <footer><strong>{{ product.evidenceCount }} evidence items · {{ product.stage }}</strong><osx-link v-if="product.websiteUrl || product.repositoryUrl" :href="product.websiteUrl || product.repositoryUrl" external>Open source</osx-link></footer>
          </article>
          <osx-empty-state v-if="!state.products.length" class="page-empty-state" icon="boxes" title="Product memory is empty">
            Start with whatever explains the product today. Code is useful, but it is not required.
            <osx-button slot="actions" variant="primary" icon="plus" @click="view = 'onboarding'">Add the first product</osx-button>
          </osx-empty-state>
          <button v-else class="add-product-card" @click="view = 'onboarding'"><osx-icon name="plus" size="24"></osx-icon><strong>Add another product</strong><span>Repository, URL, document, or pasted context</span></button>
        </div>
      </main>

      <main v-else-if="state && view === 'audience'" class="workspace-page">
        <header><p class="eyebrow">AUDIENCE MAP</p><h1>Problems, people, and places.</h1><p>The system optimizes for relevance—not reach without context.</p></header>
        <div v-if="state.products.length" class="audience-grid">
          <article v-for="product in state.products" :key="product.id"><osx-icon name="user" size="24"></osx-icon><h2>{{ product.audience }}</h2><p>{{ product.name }} is currently optimizing for: {{ product.objective }}</p><div><osx-badge>{{ product.stage }}</osx-badge><osx-badge tone="info">{{ product.confidence }}% evidence</osx-badge></div></article>
        </div>
        <osx-empty-state v-else class="page-empty-state" icon="user" title="No audience has been established">Audience hypotheses appear only after a product has been onboarded and reviewed.<osx-button slot="actions" variant="primary" icon="plus" @click="view = 'onboarding'">Onboard a product</osx-button></osx-empty-state>
      </main>

      <main v-else-if="state && view === 'campaigns'" class="workspace-page">
        <header><p class="eyebrow">CAMPAIGNS</p><h1>Approved narratives in motion.</h1><p>One product moment can become several channel-native contributions without repeating itself.</p></header>
        <section class="data-panel">
          <div v-for="opportunity in approved" :key="opportunity.id" class="campaign-row">
            <span class="status-orb"></span><div><strong>{{ opportunity.title }}</strong><small>{{ opportunity.productName }} · {{ opportunity.channelName }}</small></div><osx-badge tone="success">Queued</osx-badge><osx-button size="small" @click="selectOpportunity(opportunity); decide('restore')">Return to queue</osx-button>
          </div>
          <osx-empty-state v-if="!approved.length" icon="send" title="No approved campaigns yet">Approve a move from the Command Center to place it here.</osx-empty-state>
        </section>
      </main>

      <main v-else-if="state && view === 'channels'" class="workspace-page">
        <header><p class="eyebrow">CHANNEL POLICY</p><h1>Autonomy is granted—not assumed.</h1><p>Every destination owns its own approval mode, volume limit, and connection state.</p></header>
        <section class="channel-grid">
          <article v-for="channel in state.channels" :key="channel.id" class="channel-card">
            <header><span class="channel-mark">{{ channel.name.charAt(0) }}</span><div><h2>{{ channel.name }}</h2><p>{{ channel.handle }}</p></div><osx-badge :tone="channel.connected ? 'success' : channel.status === 'manual' ? 'warning' : 'neutral'" dot>{{ channel.status }}</osx-badge></header>
            <dl><div><dt>Execution mode</dt><dd>{{ channel.mode }}</dd></div><div><dt>Daily limit</dt><dd>{{ channel.dailyLimit }}</dd></div><div><dt>Reply automation</dt><dd>Approval required</dd></div></dl>
            <footer><osx-toggle :checked="channel.connected" :disabled="!channel.connected">Connection enabled</osx-toggle><osx-button size="small" icon="settings">Configure</osx-button></footer>
          </article>
        </section>
      </main>

      <main v-else-if="state && view === 'journal'" class="workspace-page">
        <header><p class="eyebrow">DISTRIBUTION JOURNAL</p><h1>The system remembers what happened.</h1><p>Decisions, executions, outcomes, and lessons form the feedback loop.</p></header>
        <ol class="journal-list">
          <li v-for="event in state.products.length ? state.recentEvents : []" :key="event.id"><span class="timeline-dot"></span><time>{{ formatDate(event.occurredAt) }}<small>{{ formatTime(event.occurredAt) }}</small></time><div><strong>{{ event.type.replaceAll('.', ' ') }}</strong><p>{{ event.detail }}</p></div><osx-badge size="small">{{ event.entityType }}</osx-badge></li>
          <osx-empty-state v-if="!state.products.length || !state.recentEvents.length" icon="book" title="The journal is empty">Product onboarding, decisions, executions, and measured outcomes will appear here in chronological order.</osx-empty-state>
        </ol>
      </main>

      <main v-else-if="state && view === 'settings'" class="workspace-page">
        <header><p class="eyebrow">SYSTEM</p><h1>Local control plane.</h1><p>The database, product memory, voice model, and approval history stay under your control.</p></header>
        <section class="settings-grid">
          <article><osx-icon name="lock" size="24"></osx-icon><div><h2>Private local ledger</h2><p>{{ state.storage.location }}</p></div><osx-badge tone="success">Active</osx-badge></article>
          <article><osx-icon name="activity" size="24"></osx-icon><div><h2>Managed execution cloud</h2><p>Optional future layer for scheduled publishing, monitoring, and team access.</p></div><osx-badge>Not enabled</osx-badge></article>
          <article><osx-icon name="user" size="24"></osx-icon><div><h2>Human approval kernel</h2><p>Public replies, new channels, and sensitive claims require explicit judgment.</p></div><osx-badge tone="info">Required</osx-badge></article>
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
            <div><span>Relevance</span><osx-progress :value="selected.relevanceScore" max="100"></osx-progress><b>{{ selected.relevanceScore }}</b></div>
            <div><span>Audience value</span><osx-progress :value="selected.valueScore" max="100"></osx-progress><b>{{ selected.valueScore }}</b></div>
            <div><span>Freshness</span><osx-progress :value="selected.freshnessScore" max="100"></osx-progress><b>{{ selected.freshnessScore }}</b></div>
          </section>
          <section class="evidence-panel">
            <h3>What proves it</h3>
            <template v-for="item in selected.evidence" :key="item.id">
              <a v-if="item.sourceUrl" :href="item.sourceUrl" target="_blank" rel="noreferrer"><osx-icon name="file-text" size="16"></osx-icon><span><strong>{{ item.title }}</strong><small>{{ item.summary }}</small></span><osx-icon name="external" size="14"></osx-icon></a>
              <div v-else class="evidence-static"><osx-icon name="file-text" size="16"></osx-icon><span><strong>{{ item.title }}</strong><small>{{ item.summary }}</small></span><osx-badge size="small">{{ item.classification }}</osx-badge></div>
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
