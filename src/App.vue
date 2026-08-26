<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { activateAgentRuntime, activateModelProfile, approveActionExecution, captureProductSignals, connectDevTo, connectGitHubSource, createActionAdapter, createAutomationPlaybook, decideOpportunity, decideSignal, deleteAutomationPlaybook, deleteProduct, disconnectSourceConnector, discoverAIRuntimes, executeOpportunity, generateProductPlan, loadAIControlPlane, loadDashboard, onboardProduct, previewActionPolicy, probeActionAdapter, recordOpportunityOutcome, requestActionExecution, runAutomationPlaybook, saveDevToCredential, saveModelProfile, setActionAdapterEnabled, setAutomationPaused, syncSourceConnector, testAgentRuntime, testModelProfile, updateAutomationPlaybook, updateChannelPolicy, writeOpportunityDraft } from "./api.ts";
import type { AgentRuntimeStatus, AIControlPlane, AutomationRun, Channel, ChannelMode, DashboardState, ModelProviderId, OnboardProductInput, OnboardingSourceInput, Opportunity } from "../server/domain.ts";
import type { ActionAdapterDescriptor, ActionCapability, ActionExecutionRecord, ActionToolDescriptor, ActionTransport } from "../packages/action-fabric/src/index.ts";
import ProductOnboarding from "./ProductOnboarding.vue";

type View = "command" | "automation" | "onboarding" | "memory" | "signals" | "audience" | "campaigns" | "channels" | "journal" | "harness" | "settings";

const state = ref<DashboardState | null>(null);
const view = ref<View>("command");
const activeProductId = ref("");
const selectedId = ref("");
const draft = ref("");
const loading = ref(true);
const actionBusy = ref(false);
const onboardingBusy = ref(false);
const planBusy = ref(false);
const planElapsedSeconds = ref(0);
const planNotice = ref<{ tone: "success" | "warning" | "danger"; title: string; detail: string } | null>(null);
const productNotice = ref<{ tone: "success" | "warning" | "danger"; title: string; detail: string } | null>(null);
const productDeleteBusyId = ref("");
const campaignNotice = ref<{ tone: "success" | "danger"; title: string; detail: string } | null>(null);
const copiedOpportunityId = ref("");
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
const testingRuntimeId = ref("");
const runtimeNotice = ref<{ tone: "success" | "warning" | "danger"; title: string; detail: string } | null>(null);
const outcomeOpportunityId = ref("");
const outcomeForm = reactive({ metric: "qualified-visits", value: 0, note: "" });
const signalBusy = ref(false);
const signalActionId = ref("");
const signalNotice = ref<{ tone: "success" | "warning" | "danger"; title: string; detail: string } | null>(null);
const signalForm = reactive({ productId: "", type: "text" as "text" | "url", label: "", value: "" });
const connectorBusyId = ref("");
const connectorNotice = ref<{ tone: "success" | "warning" | "danger"; title: string; detail: string } | null>(null);
const connectorForm = reactive({ productId: "", repository: "" });
const devToApiKey = ref("");
const devToBusy = ref(false);
const devToNotice = ref<{ tone: "success" | "warning" | "danger"; title: string; detail: string } | null>(null);
const devToForm = reactive({ productId: "", signalQuery: "", publishTags: "opensource, productivity" });
const draftBusy = ref(false);
const draftNotice = ref<{ tone: "success" | "warning" | "danger"; title: string; detail: string } | null>(null);
const channelEditingId = ref("");
const channelNotice = ref<{ tone: "success" | "danger"; title: string; detail: string } | null>(null);
const channelForm = reactive<{ mode: ChannelMode; dailyLimit: number }>({ mode: "approval", dailyLimit: 1 });
const profileForm = reactive({ name: "", provider: "anthropic" as ModelProviderId, model: "", baseUrl: "https://api.anthropic.com/v1", apiKey: "" });
const automationBusyId = ref("");
const automationNotice = ref<{ tone: "success" | "warning" | "danger"; title: string; detail: string } | null>(null);
const automationForm = reactive({ productId: "", name: "", intervalMinutes: 1440, maxActionsPerRun: 1 });
const actionAdapterOpen = ref(false);
const actionAdapterBusyId = ref("");
const actionAdapterForm = reactive({
  name: "", transport: "mcp" as Exclude<ActionTransport, "direct-api">,
  capabilities: ["observe", "search", "read"] as ActionCapability[], endpoint: "", command: "gh", gateway: "composio", connectionRef: "", credentialEnv: "",
});
const actionInvocationOpen = ref(false);
const actionInvocation = reactive({ adapterId: "", adapterName: "", toolName: "", capability: "read" as ActionCapability, purpose: "", evidenceRefs: "", argumentsJson: "{}" });
let planAbortController: AbortController | null = null;
let planTimer: number | null = null;

const activeProduct = computed(() => state.value?.products.find((item) => item.id === activeProductId.value) ?? null);
const scopedProducts = computed(() => activeProduct.value ? [activeProduct.value] : state.value?.products ?? []);
const scopedOpportunities = computed(() => state.value?.opportunities.filter((item) => !activeProductId.value || item.productId === activeProductId.value) ?? []);
const readyOpportunities = computed(() => scopedOpportunities.value.filter((item) => item.status === "ready"));
const selected = computed(() => {
  if (!state.value) return null;
  return scopedOpportunities.value.find((item) => item.id === selectedId.value && item.status === "ready")
    ?? readyOpportunities.value[0]
    ?? null;
});
const approved = computed(() => scopedOpportunities.value.filter((item) => item.status === "approved"));
const published = computed(() => scopedOpportunities.value.filter((item) => item.status === "published"));
const scopedSignalInbox = computed(() => state.value?.signalInbox.filter((item) => !activeProductId.value || item.productId === activeProductId.value) ?? []);
const newSignals = computed(() => scopedSignalInbox.value.filter((item) => item.status === "new"));
const reviewedSignals = computed(() => scopedSignalInbox.value.filter((item) => item.status !== "new"));
const scopedAudienceSignals = computed(() => state.value?.audienceSignals.filter((item) => !activeProductId.value || item.productId === activeProductId.value) ?? []);
const scopedConnectors = computed(() => state.value?.connectors.filter((item) => !activeProductId.value || item.productId === activeProductId.value) ?? []);
const scopedEvents = computed(() => state.value?.recentEvents.filter((item) => !activeProductId.value || !item.productId || item.productId === activeProductId.value) ?? []);
const scopedHarnessRuns = computed(() => state.value?.harnessRuns.filter((item) => !activeProductId.value || !item.productId || item.productId === activeProductId.value) ?? []);
const scopedEvidenceCount = computed(() => scopedProducts.value.reduce((sum, product) => sum + product.evidenceCount, 0));
const scopedConfidence = computed(() => scopedProducts.value.length ? Math.round(scopedProducts.value.reduce((sum, product) => sum + product.confidence, 0) / scopedProducts.value.length) : 0);
const scopedPlaybooks = computed(() => state.value?.automation.playbooks.filter((item) => !activeProductId.value || item.productId === activeProductId.value) ?? []);
const scopedAutomationRuns = computed(() => state.value?.automation.runs.filter((item) => !activeProductId.value || item.productId === activeProductId.value) ?? []);
const devToChannel = computed(() => state.value?.channels.find((item) => item.id === "devto") ?? null);
const activeRuntime = computed(() => ai.value?.runtimes.find((runtime) => runtime.id === ai.value?.execution.runtimeId) ?? null);
const activeModelProfile = computed(() => ai.value?.profiles.find((profile) => profile.id === ai.value?.execution.modelProfileId) ?? null);
const activeExecutionReady = computed(() => activeRuntime.value?.id === "native"
  ? activeModelProfile.value?.readiness === "ready"
  : activeRuntime.value?.verification === "ready");
const selectedProvider = computed(() => ai.value?.providers.find((provider) => provider.id === profileForm.provider));
const actionCapabilityOptions = computed<ActionCapability[]>(() => actionAdapterForm.transport === "cli"
  ? ["observe", "search", "read"]
  : actionAdapterForm.transport === "manual"
    ? ["execute", "measure"]
    : ["observe", "search", "read", "prepare", "execute", "measure"]);

watch(selected, (opportunity) => {
  draft.value = opportunity?.draftCopy ?? "";
}, { immediate: true });

watch(activeProductId, (productId) => {
  window.localStorage.setItem("distribution-os.active-product", productId);
  if (productId) {
    signalForm.productId = productId;
    connectorForm.productId = productId;
    automationForm.productId = productId;
    devToForm.productId = productId;
  }
  selectedId.value = readyOpportunities.value[0]?.id ?? "";
});

onMounted(async () => {
  try {
    state.value = await loadDashboard();
    const storedProductId = window.localStorage.getItem("distribution-os.active-product") || "";
    activeProductId.value = state.value.products.some((product) => product.id === storedProductId)
      ? storedProductId
      : state.value.products.length === 1 ? state.value.products[0]?.id ?? "" : "";
    const initialProductId = activeProductId.value || state.value.products[0]?.id || "";
    signalForm.productId = initialProductId;
    connectorForm.productId = initialProductId;
    automationForm.productId = initialProductId;
    devToForm.productId = devToChannel.value?.connector.productId || initialProductId;
    devToForm.signalQuery = devToChannel.value?.connector.signalQuery || "";
    devToForm.publishTags = devToChannel.value?.connector.publishTags.join(", ") || "opensource, productivity";
    connectorForm.repository = state.value.products[0]?.repositoryUrl.includes("github.com") ? state.value.products[0].repositoryUrl : "";
    if (state.value.onboarding.required) view.value = "onboarding";
    selectedId.value = readyOpportunities.value[0]?.id ?? state.value.opportunities[0]?.id ?? "";
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Distribution OS could not load local data.";
  } finally {
    loading.value = false;
  }
  try {
    ai.value = await loadAIControlPlane();
  } catch (cause) {
    aiError.value = cause instanceof Error ? cause.message : "AI settings could not be loaded.";
  }
});

onBeforeUnmount(() => {
  planAbortController?.abort();
  if (planTimer !== null) window.clearInterval(planTimer);
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
      ? { tone: "success", title: "Model profile saved", detail: `${saved.name} is available when Native is selected. Your agent-runtime selection was not changed.` }
      : { tone: "warning", title: "Profile saved. Credential required.", detail: `${saved?.provider ?? profileForm.provider} still needs a Keychain credential or environment variable before Native can run.` };
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

function runtimeStatusLabel(runtime: AgentRuntimeStatus): string {
  if (!runtime.available) return runtime.availability.replace("-", " ");
  if (runtime.id === "native" || runtime.verification === "ready") return "ready";
  if (runtime.verification === "failed") return "test failed";
  return "installed · unverified";
}

function runtimeStatusTone(runtime: AgentRuntimeStatus): "success" | "warning" | "danger" | "neutral" {
  if (runtime.id === "native" || runtime.verification === "ready") return "success";
  if (runtime.verification === "failed") return "danger";
  if (runtime.available || runtime.availability === "setup-required") return "warning";
  return "neutral";
}

async function verifyAgentRuntime(runtime: AgentRuntimeStatus): Promise<void> {
  if (runtime.id === "native") return;
  testingRuntimeId.value = runtime.id;
  runtimeNotice.value = null;
  try {
    const model = ai.value?.execution.runtimeId === runtime.id ? runtimeModel.value : "";
    const result = await testAgentRuntime(runtime.id, model);
    ai.value = result.controlPlane;
    runtimeNotice.value = result.ok
      ? { tone: "success", title: `${runtime.name} is ready`, detail: `The read-only test returned valid JSON in ${result.durationMs}ms. No project sources were sent.` }
      : { tone: "danger", title: `${runtime.name} test failed`, detail: `${result.detail} Diagnostic: ${result.failureCode?.replaceAll("-", " ") || "unknown"}.` };
  } catch (cause) {
    runtimeNotice.value = { tone: "danger", title: `${runtime.name} test could not run`, detail: cause instanceof Error ? cause.message : "The runtime readiness test could not be completed." };
  } finally {
    testingRuntimeId.value = "";
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

async function toggleAutomationControl(): Promise<void> {
  if (!state.value) return;
  automationBusyId.value = "control";
  automationNotice.value = null;
  const paused = !state.value.automation.control.paused;
  try {
    state.value = (await setAutomationPaused(paused)).dashboard;
    automationNotice.value = paused
      ? { tone: "warning", title: "Automation paused", detail: "Scheduled source checks and drafts are stopped. Review and history remain available." }
      : { tone: "success", title: "Automation resumed", detail: "Due schedules can check sources and prepare work again. Public actions still need your approval." };
  } catch (cause) {
    automationNotice.value = { tone: "danger", title: "Automation control failed", detail: cause instanceof Error ? cause.message : "The control state could not be changed." };
  } finally {
    automationBusyId.value = "";
  }
}

async function createPlaybook(): Promise<void> {
  if (!automationForm.productId) return;
  automationBusyId.value = "new";
  automationNotice.value = null;
  try {
    const result = await createAutomationPlaybook({ ...automationForm, name: automationForm.name.trim() || undefined });
    state.value = result.dashboard;
    automationForm.name = "";
    automationNotice.value = { tone: "success", title: "Schedule created", detail: "The schedule can check sources and prepare work. It cannot publish or reply." };
  } catch (cause) {
    automationNotice.value = { tone: "danger", title: "Schedule was not created", detail: cause instanceof Error ? cause.message : "Review the limits and try again." };
  } finally {
    automationBusyId.value = "";
  }
}

async function togglePlaybook(id: string, enabled: boolean, intervalMinutes: number, maxActionsPerRun: number): Promise<void> {
  automationBusyId.value = id;
  automationNotice.value = null;
  try {
    const result = await updateAutomationPlaybook(id, { enabled, intervalMinutes, maxActionsPerRun });
    state.value = result.dashboard;
    automationNotice.value = { tone: enabled ? "success" : "warning", title: enabled ? "Schedule resumed" : "Schedule paused", detail: enabled ? "The next due run can check sources and prepare work." : "This schedule will not run until you resume it." };
  } catch (cause) {
    automationNotice.value = { tone: "danger", title: "Schedule could not be updated", detail: cause instanceof Error ? cause.message : "Try again." };
  } finally {
    automationBusyId.value = "";
  }
}

async function deletePlaybook(playbook: DashboardState["automation"]["playbooks"][number]): Promise<void> {
  const confirmed = window.confirm(`Delete “${playbook.name}”?\n\nThe schedule will stop and disappear. Past runs, decisions, and results will stay in History.`);
  if (!confirmed) return;
  automationBusyId.value = playbook.id;
  automationNotice.value = null;
  try {
    const result = await deleteAutomationPlaybook(playbook.id);
    state.value = result.dashboard;
    automationNotice.value = { tone: "success", title: "Schedule deleted", detail: "Distribution OS removed the schedule and kept its past runs, decisions, and results." };
  } catch (cause) {
    automationNotice.value = { tone: "danger", title: "Schedule was not deleted", detail: cause instanceof Error ? cause.message : "Try again after the current run finishes." };
  } finally {
    automationBusyId.value = "";
  }
}

async function runPlaybook(id: string): Promise<void> {
  automationBusyId.value = id;
  automationNotice.value = null;
  try {
    const result = await runAutomationPlaybook(id);
    state.value = result.dashboard;
    automationNotice.value = result.run.status === "waiting-approval"
      ? { tone: "success", title: "Useful work is ready for judgment", detail: result.run.summary }
      : result.run.status === "failed"
        ? { tone: "danger", title: "The loop stopped safely", detail: result.run.error || result.run.summary }
        : { tone: "success", title: "Automation run complete", detail: result.run.summary };
  } catch (cause) {
    automationNotice.value = { tone: "danger", title: "Automation run could not start", detail: cause instanceof Error ? cause.message : "Try again." };
  } finally {
    automationBusyId.value = "";
  }
}

function setAdapterTransport(transport: Exclude<ActionTransport, "direct-api">): void {
  actionAdapterForm.transport = transport;
  actionAdapterForm.capabilities = transport === "mcp" ? ["observe", "search", "read"]
    : transport === "cli" ? ["observe", "search", "read"]
      : transport === "managed-gateway" ? ["observe", "search", "read"]
        : ["execute", "measure"];
}

function toggleAdapterCapability(capability: ActionCapability): void {
  actionAdapterForm.capabilities = actionAdapterForm.capabilities.includes(capability)
    ? actionAdapterForm.capabilities.filter((item) => item !== capability)
    : [...actionAdapterForm.capabilities, capability];
}

async function saveActionAdapter(): Promise<void> {
  actionAdapterBusyId.value = "new-adapter";
  automationNotice.value = null;
  try {
    const result = await createActionAdapter({ ...actionAdapterForm });
    state.value = result.dashboard;
    actionAdapterForm.name = "";
    actionAdapterForm.endpoint = "";
    actionAdapterForm.connectionRef = "";
    actionAdapterForm.credentialEnv = "";
    actionAdapterOpen.value = false;
    automationNotice.value = { tone: "success", title: "Connection added", detail: `${result.adapter.name} is ready for setup. No credentials were granted and no action ran.` };
  } catch (cause) {
    automationNotice.value = { tone: "danger", title: "Connection was not added", detail: cause instanceof Error ? cause.message : "Review the settings and try again." };
  } finally {
    actionAdapterBusyId.value = "";
  }
}

async function probeAdapter(adapter: ActionAdapterDescriptor): Promise<void> {
  actionAdapterBusyId.value = adapter.id;
  automationNotice.value = null;
  try {
    const result = await probeActionAdapter(adapter.id);
    state.value = result.dashboard;
    automationNotice.value = result.adapter.transport === "manual"
      ? { tone: "success", title: "Human handoff is ready", detail: "The manifest is active. Distribution OS will package only the reviewed payload and will never claim that the external action occurred." }
      : { tone: "success", title: "Connection verified", detail: `${result.adapter.name} exposed ${result.adapter.connection.tools.length} tool${result.adapter.connection.tools.length === 1 ? "" : "s"}. Only those tools can be requested.` };
  } catch (cause) {
    state.value = await loadDashboard();
    automationNotice.value = { tone: "danger", title: "Connection was not activated", detail: cause instanceof Error ? cause.message : "The test failed. The connection cannot run yet." };
  } finally {
    actionAdapterBusyId.value = "";
  }
}

function openActionInvocation(adapter: ActionAdapterDescriptor, tool: ActionToolDescriptor): void {
  actionInvocation.adapterId = adapter.id;
  actionInvocation.adapterName = adapter.name;
  actionInvocation.toolName = tool.name;
  actionInvocation.capability = tool.capabilities[0] || "read";
  actionInvocation.purpose = "";
  actionInvocation.evidenceRefs = selected.value?.evidence.map((item) => item.id).join(", ") || "";
  actionInvocation.argumentsJson = adapter.transport === "cli" && tool.name === "list-issues" ? '{\n  "repository": "owner/repository",\n  "limit": 10\n}' : "{}";
  actionInvocationOpen.value = true;
  automationNotice.value = null;
}

async function runActionInvocation(): Promise<void> {
  actionAdapterBusyId.value = "action-request";
  automationNotice.value = null;
  try {
    const parsed = JSON.parse(actionInvocation.argumentsJson) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Arguments must be one JSON object.");
    const idempotencyKey = `ui:${actionInvocation.adapterId}:${actionInvocation.toolName}:${crypto.randomUUID()}`;
    const result = await requestActionExecution({
      adapterId: actionInvocation.adapterId, capability: actionInvocation.capability, toolName: actionInvocation.toolName,
      purpose: actionInvocation.purpose, evidenceRefs: actionInvocation.evidenceRefs.split(",").map((item) => item.trim()).filter(Boolean),
      arguments: parsed as Record<string, unknown>, idempotencyKey,
    });
    state.value = result.dashboard;
    actionInvocationOpen.value = false;
    automationNotice.value = result.record.status === "approval-required"
      ? { tone: "warning", title: "Waiting for your approval", detail: "The request and its allowed fields were recorded. Nothing has been sent." }
      : result.record.status === "completed"
        ? { tone: "success", title: "Action completed", detail: result.record.summary }
        : { tone: "danger", title: "Action did not complete", detail: result.record.error || result.record.decision.reasons.join(" ") };
  } catch (cause) {
    automationNotice.value = { tone: "danger", title: "Action request was rejected", detail: cause instanceof Error ? cause.message : "Review the purpose, evidence, and JSON arguments." };
  } finally {
    actionAdapterBusyId.value = "";
  }
}

async function approveAction(record: ActionExecutionRecord): Promise<void> {
  actionAdapterBusyId.value = record.id;
  automationNotice.value = null;
  try {
    const result = await approveActionExecution(record.id);
    state.value = result.dashboard;
    automationNotice.value = result.record.status === "completed"
      ? { tone: "success", title: "Approved action completed", detail: result.record.summary }
      : { tone: "danger", title: "Approved action stopped safely", detail: result.record.error || result.record.decision.reasons.join(" ") };
  } catch (cause) {
    state.value = await loadDashboard();
    automationNotice.value = { tone: "danger", title: "Approval could not be executed", detail: cause instanceof Error ? cause.message : "The connection may have changed. No success was claimed." };
  } finally {
    actionAdapterBusyId.value = "";
  }
}

async function toggleActionAdapter(adapter: ActionAdapterDescriptor): Promise<void> {
  actionAdapterBusyId.value = adapter.id;
  automationNotice.value = null;
  try {
    const result = await setActionAdapterEnabled(adapter.id, adapter.state === "disabled");
    state.value = result.dashboard;
    automationNotice.value = { tone: result.adapter.state === "disabled" ? "warning" : "success", title: result.adapter.state === "disabled" ? "Connection disabled" : "Connection returned to setup", detail: "The change took effect immediately. No credential or external service changed." };
  } catch (cause) {
    automationNotice.value = { tone: "danger", title: "Adapter state was not changed", detail: cause instanceof Error ? cause.message : "Try again." };
  } finally {
    actionAdapterBusyId.value = "";
  }
}

async function inspectActionBoundary(adapter: ActionAdapterDescriptor): Promise<void> {
  const capability = adapter.capabilities.includes("execute") ? "execute" : adapter.capabilities[0];
  if (!capability) return;
  actionAdapterBusyId.value = adapter.id;
  try {
    const product = activeProduct.value ?? state.value?.products[0];
    const decision = await previewActionPolicy({ adapterId: adapter.id, capability, productId: product?.id, evidenceRefs: product ? [product.id] : ["preview"], purpose: `Preview the ${adapter.name} boundary.`, budgetLimit: 1 });
    automationNotice.value = {
      tone: decision.status === "blocked" ? "danger" : decision.status === "approval-required" ? "warning" : "success",
      title: decision.status === "allowed" ? "This action is allowed" : decision.status === "approval-required" ? "Your approval is required" : "This action is blocked",
      detail: decision.reasons.join(" "),
    };
  } catch (cause) {
    automationNotice.value = { tone: "danger", title: "Policy preview failed", detail: cause instanceof Error ? cause.message : "Try again." };
  } finally {
    actionAdapterBusyId.value = "";
  }
}

async function createProduct(input: OnboardProductInput): Promise<void> {
  onboardingBusy.value = true;
  error.value = "";
  try {
    const result = await onboardProduct(input);
    state.value = result.dashboard;
    activeProductId.value = result.productId;
    signalForm.productId = result.productId;
    automationForm.productId = result.productId;
    selectedId.value = state.value.opportunities.find((item) => item.productId === result.productId)?.id ?? "";
    productNotice.value = result.operation === "updated"
      ? { tone: "success", title: "Project updated", detail: "Distribution OS matched this project by name and source, refreshed its brief, and kept its past sources and results." }
      : { tone: "success", title: "Project added", detail: "The approved brief and its sources are ready for planning." };
    view.value = "memory";
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "The project could not be added.";
  } finally {
    onboardingBusy.value = false;
  }
}

function openProject(productId: string, destination: View = "command"): void {
  activeProductId.value = productId;
  view.value = destination;
}

async function permanentlyDeleteProduct(product: DashboardState["products"][number]): Promise<void> {
  const confirmation = window.prompt(`Permanently delete “${product.name}” and all of its local data?\n\nThis removes sources, signals, recommendations, results, connections, automation schedules, run history, and activity. This cannot be undone.\n\nType DELETE to continue.`);
  if (confirmation !== "DELETE") return;
  productDeleteBusyId.value = product.id;
  productNotice.value = null;
  try {
    const result = await deleteProduct(product.id);
    state.value = result.dashboard;
    if (activeProductId.value === product.id) activeProductId.value = state.value.products[0]?.id || "";
    productNotice.value = { tone: "success", title: "Project permanently deleted", detail: `Distribution OS removed all local data linked to ${product.name}.` };
  } catch (cause) {
    productNotice.value = { tone: "danger", title: "Project was not deleted", detail: cause instanceof Error ? cause.message : "Try again after active work finishes." };
  } finally {
    productDeleteBusyId.value = "";
  }
}

async function saveDevToKey(): Promise<void> {
  devToNotice.value = null;
  if (!devToApiKey.value.trim()) return;
  devToBusy.value = true;
  try {
    state.value = await saveDevToCredential(devToApiKey.value);
    devToApiKey.value = "";
    devToNotice.value = { tone: "success", title: "DEV key verified", detail: "Distribution OS saved the API key to macOS Keychain, not SQLite." };
  } catch (cause) {
    devToNotice.value = { tone: "danger", title: "DEV key was not saved", detail: cause instanceof Error ? cause.message : "DEV could not verify this credential." };
  } finally {
    devToBusy.value = false;
  }
}

async function connectDevToSignals(): Promise<void> {
  devToNotice.value = null;
  if (!devToForm.productId || !devToForm.signalQuery.trim()) {
    devToNotice.value = { tone: "danger", title: "Focused signal query required", detail: "Choose a project and describe the specific audience problem to observe on DEV." };
    return;
  }
  devToBusy.value = true;
  try {
    const result = await connectDevTo(devToForm.productId, devToForm.signalQuery, devToForm.publishTags.split(","));
    state.value = result.dashboard;
    activeProductId.value = devToForm.productId;
    devToNotice.value = result.imported
      ? { tone: "success", title: "DEV signals are ready for review", detail: `${result.imported} public observation${result.imported === 1 ? "" : "s"} added to Signals. None was accepted automatically.` }
      : { tone: "warning", title: "DEV is connected", detail: "No new observations were found. Existing candidates and decisions were preserved." };
  } catch (cause) {
    devToNotice.value = { tone: "danger", title: "DEV signals could not be connected", detail: cause instanceof Error ? cause.message : "The public DEV search failed." };
  } finally {
    devToBusy.value = false;
  }
}

async function publishToDev(opportunity: Opportunity): Promise<void> {
  if (!window.confirm(`Publish the approved draft “${opportunity.title}” to DEV now? This is a real public action.`)) return;
  actionBusy.value = true;
  campaignNotice.value = null;
  try {
    const result = await executeOpportunity(opportunity.id);
    state.value = result.dashboard;
    campaignNotice.value = { tone: "success", title: "Published to DEV", detail: `Execution receipt captured: ${result.receipt.externalUrl}. Outcome refresh is now automatic when the workspace refreshes.` };
  } catch (cause) {
    campaignNotice.value = { tone: "danger", title: "DEV publication failed", detail: cause instanceof Error ? cause.message : "DEV did not return a confirmed publication receipt." };
  } finally {
    actionBusy.value = false;
  }
}

async function captureSignal(): Promise<void> {
  signalNotice.value = null;
  if (!signalForm.productId || !signalForm.value.trim()) {
    signalNotice.value = { tone: "danger", title: "Signal needs context", detail: "Choose a project and add a public URL or a short discussion excerpt." };
    return;
  }
  if (signalForm.type === "url") {
    try { new URL(signalForm.value.trim()); } catch {
      signalNotice.value = { tone: "danger", title: "Enter a complete public URL", detail: "Include https:// so Distribution OS can read the source safely." };
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
    const result = await captureProductSignals(signalForm.productId, [source]);
    state.value = result.dashboard;
    signalForm.label = "";
    signalForm.value = "";
    signalNotice.value = result.insertedCount
      ? { tone: "success", title: "Signal saved for review", detail: "It cannot affect a plan until you accept it. Distribution OS will not treat it as a trend or proof of demand." }
      : { tone: "warning", title: "Signal already captured", detail: "An equivalent source is already represented in the inbox, so no duplicate was added." };
  } catch (cause) {
    signalNotice.value = { tone: "danger", title: "Signal could not be added", detail: cause instanceof Error ? cause.message : "The source could not be imported." };
  } finally {
    signalBusy.value = false;
  }
}

async function reviewSignal(id: string, action: "accept" | "dismiss" | "restore"): Promise<void> {
  signalActionId.value = id;
  signalNotice.value = null;
  try {
    state.value = await decideSignal(id, action);
    signalNotice.value = action === "accept"
      ? { tone: "success", title: "Signal accepted", detail: "This observation can now support a plan. It is still one audience signal, not proof of demand." }
      : action === "dismiss"
        ? { tone: "warning", title: "Signal dismissed", detail: "The candidate will not influence planning. You can restore it from reviewed signals." }
        : { tone: "success", title: "Signal restored", detail: "The candidate is back in the review inbox." };
  } catch (cause) {
    signalNotice.value = { tone: "danger", title: "Signal decision failed", detail: cause instanceof Error ? cause.message : "The decision could not be recorded." };
  } finally {
    signalActionId.value = "";
  }
}

function selectConnectorProduct(productId: string): void {
  connectorForm.productId = productId;
  const product = state.value?.products.find((item) => item.id === productId);
  if (!connectorForm.repository.trim() || connectorForm.repository.includes("github.com")) {
    connectorForm.repository = product?.repositoryUrl.includes("github.com") ? product.repositoryUrl : "";
  }
}

async function connectGitHub(): Promise<void> {
  connectorNotice.value = null;
  if (!connectorForm.productId || !connectorForm.repository.trim()) {
    connectorNotice.value = { tone: "danger", title: "Repository required", detail: "Choose a project and enter a GitHub repository URL or owner/repository." };
    return;
  }
  connectorBusyId.value = "new";
  try {
    const result = await connectGitHubSource(connectorForm.productId, connectorForm.repository.trim());
    state.value = result.dashboard;
    connectorNotice.value = result.importedCount
      ? { tone: "success", title: "GitHub source connected", detail: `${result.importedCount} new issue signal${result.importedCount === 1 ? "" : "s"} added for review. None was accepted automatically.` }
      : { tone: "warning", title: "GitHub source connected", detail: `Distribution OS checked ${result.inspectedCount} issue${result.inspectedCount === 1 ? "" : "s"}. No new signals were found.` };
  } catch (cause) {
    connectorNotice.value = { tone: "danger", title: "GitHub could not be connected", detail: cause instanceof Error ? cause.message : "The repository could not be read." };
  } finally {
    connectorBusyId.value = "";
  }
}

async function syncConnector(id: string): Promise<void> {
  connectorBusyId.value = id;
  connectorNotice.value = null;
  try {
    const result = await syncSourceConnector(id);
    state.value = result.dashboard;
    connectorNotice.value = result.importedCount
      ? { tone: "success", title: "GitHub signals refreshed", detail: `${result.importedCount} new issue signal${result.importedCount === 1 ? "" : "s"} entered the review inbox.` }
      : { tone: "success", title: "GitHub is up to date", detail: `${result.inspectedCount} recent issue${result.inspectedCount === 1 ? " was" : "s were"} inspected with no new candidates.` };
  } catch (cause) {
    connectorNotice.value = { tone: "danger", title: "GitHub sync failed", detail: cause instanceof Error ? cause.message : "The source could not be refreshed." };
  } finally {
    connectorBusyId.value = "";
  }
}

async function disconnectConnector(id: string): Promise<void> {
  connectorBusyId.value = id;
  connectorNotice.value = null;
  try {
    state.value = await disconnectSourceConnector(id);
    connectorNotice.value = { tone: "success", title: "Source disconnected", detail: "Distribution OS kept the imported signals and past decisions." };
  } catch (cause) {
    connectorNotice.value = { tone: "danger", title: "Source could not be disconnected", detail: cause instanceof Error ? cause.message : "Try again." };
  } finally {
    connectorBusyId.value = "";
  }
}

async function writeDraft(): Promise<void> {
  if (!selected.value) return;
  draftBusy.value = true;
  draftNotice.value = null;
  error.value = "";
  try {
    const response = await writeOpportunityDraft(selected.value.id);
    state.value = response.dashboard;
    draft.value = response.result.draftCopy;
    draftNotice.value = response.result.mode === "ai"
      ? { tone: "success", title: `${selected.value.channelName} draft written`, detail: `${response.result.provider} · ${response.result.model} produced a source-cited draft. Review and edit it before approval.` }
      : { tone: "warning", title: "Local draft preserved", detail: response.result.warning };
  } catch (cause) {
    draftNotice.value = { tone: "danger", title: "Draft could not be written", detail: cause instanceof Error ? cause.message : "The contribution writer failed." };
  } finally {
    draftBusy.value = false;
  }
}

async function runDistributionPlan(productId: string): Promise<void> {
  planBusy.value = true;
  planElapsedSeconds.value = 0;
  planNotice.value = null;
  error.value = "";
  planAbortController = new AbortController();
  const startedAt = Date.now();
  planTimer = window.setInterval(() => { planElapsedSeconds.value = Math.floor((Date.now() - startedAt) / 1_000); }, 1_000);
  try {
    const result = await generateProductPlan(productId, planAbortController.signal);
    state.value = result.dashboard;
    selectedId.value = result.application.opportunityIds[0] ?? selectedId.value;
    planNotice.value = result.plan.mode === "ai" && result.application.insertedCount > 0
      ? { tone: "success", title: "Recommendations ready", detail: `${result.application.insertedCount} new recommendation${result.application.insertedCount === 1 ? "" : "s"} added for review. Nothing was published.` }
      : result.application.insertedCount === 0
        ? { tone: "warning", title: "No new recommendations", detail: `The plan matched work already under review, so nothing was duplicated.${result.plan.warning ? ` ${result.plan.warning}` : ""}` }
      : { tone: "warning", title: "Local plan ready", detail: result.plan.warning || "A source-based recommendation was created without AI." };
    view.value = "command";
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") {
      planNotice.value = { tone: "warning", title: "Planning stopped", detail: "The request was stopped. No recommendation was added." };
    } else error.value = cause instanceof Error ? cause.message : "The distribution plan could not be generated.";
  } finally {
    if (planTimer !== null) window.clearInterval(planTimer);
    planTimer = null;
    planAbortController = null;
    planBusy.value = false;
  }
}

function cancelDistributionPlan(): void {
  planAbortController?.abort();
}

function productOptionLabel(product: DashboardState["products"][number]): string {
  const source = product.repositoryUrl || product.websiteUrl;
  let sourceLabel = "local brief";
  if (source) {
    try {
      const url = new URL(source);
      sourceLabel = url.protocol === "file:" ? url.pathname.split("/").filter(Boolean).at(-1) || "local repo" : `${url.hostname}${url.pathname.replace(/\/$/, "")}`;
    } catch {
      sourceLabel = source.replace(/^.*\//, "");
    }
  }
  return `${product.name} · ${product.stage} · ${sourceLabel} · ${product.id.slice(0, 6)}`;
}

async function copyCampaignDraft(opportunity: Opportunity): Promise<void> {
  campaignNotice.value = null;
  try {
    await navigator.clipboard.writeText(opportunity.draftCopy);
    copiedOpportunityId.value = opportunity.id;
    campaignNotice.value = { tone: "success", title: "Draft copied", detail: "The approved draft is ready to paste." };
    window.setTimeout(() => { if (copiedOpportunityId.value === opportunity.id) copiedOpportunityId.value = ""; }, 2_000);
  } catch {
    campaignNotice.value = { tone: "danger", title: "Copy was blocked", detail: "Select the draft text below and copy it manually." };
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
    channelNotice.value = { tone: "success", title: `${channel.name} settings saved`, detail: "The next plan will use this mode and daily limit." };
  } catch (cause) {
    channelNotice.value = { tone: "danger", title: "Channel settings were not saved", detail: cause instanceof Error ? cause.message : "Review the values and try again." };
  } finally {
    actionBusy.value = false;
  }
}

async function decide(action: "approve" | "skip" | "restore", target: Opportunity | null = selected.value): Promise<void> {
  if (!target) return;
  actionBusy.value = true;
  error.value = "";
  const currentId = target.id;
  try {
    state.value = await decideOpportunity(currentId, action, action === "restore" ? undefined : draft.value);
    if (action !== "restore") {
      selectedId.value = state.value.opportunities.find((item) => item.status === "ready")?.id ?? "";
    } else {
      selectedId.value = currentId;
      view.value = "command";
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

function reviewAutomationRun(run: AutomationRun): void {
  activeProductId.value = run.productId;
  selectedId.value = run.createdOpportunityIds[0] ?? selectedId.value;
  view.value = "command";
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(value));
}

const navItems: Array<{ id: View; label: string; icon: string; section?: string }> = [
  { id: "command", label: "Review", icon: "dashboard", section: "WORK" },
  { id: "automation", label: "Automation", icon: "refresh" },
  { id: "onboarding", label: "Add Project", icon: "plus", section: "SETUP" },
  { id: "memory", label: "Projects", icon: "boxes" },
  { id: "signals", label: "Signals", icon: "inbox" },
  { id: "audience", label: "Audience", icon: "user" },
  { id: "campaigns", label: "Approved Work", icon: "send", section: "PUBLISH" },
  { id: "channels", label: "Channels", icon: "activity" },
  { id: "journal", label: "History", icon: "book", section: "RESULTS" },
  { id: "harness", label: "AI Settings", icon: "sparkle", section: "SYSTEM" },
  { id: "settings", label: "Settings", icon: "settings" },
];
</script>

<template>
  <div class="app-stage" data-osx-theme="panther">
    <osx-app-shell
      :app-title="navItems.find((item) => item.id === view)?.label || 'Review'"
      sidebar-width="244px"
      inspector-width="410px"
      :inspector-open="view === 'command'"
      label="Distribution OS workspace"
    >
      <div slot="toolbar" class="toolbar-actions">
        <label v-if="state?.products.length" class="project-switcher"><span>Project</span>
          <select v-model="activeProductId" aria-label="Active project">
            <option value="">All Projects</option>
            <option v-for="product in state.products" :key="product.id" :value="product.id">{{ productOptionLabel(product) }}</option>
          </select>
        </label>
        <button v-if="ai" class="engine-chip" title="Open AI settings" @click="view = 'harness'">
          <osx-icon :name="ai.execution.runtimeId === 'native' ? 'sparkle' : 'terminal'" :size="14"></osx-icon>
          {{ ai.execution.runtimeId === 'native' ? 'Native' : activeRuntime?.name ?? 'AI setup' }}<span v-if="activeModelProfile && ai.execution.runtimeId === 'native'">· {{ activeModelProfile.model }}</span>
        </button>
      </div>

      <nav slot="sidebar" class="source-list" aria-label="Distribution workspace">
        <div class="brand-block">
          <span class="brand-mark">D</span>
          <div><strong>Distribution OS</strong><small>Find useful work</small></div>
        </div>
        <template v-for="item in navItems" :key="item.id">
          <p v-if="item.section" class="nav-section">{{ item.section }}</p>
          <button :class="['nav-item', { active: view === item.id }]" :aria-current="view === item.id ? 'page' : undefined" @click="view = item.id">
            <osx-icon :name="item.icon" :size="18"></osx-icon>
            <span>{{ item.label }}</span>
            <b v-if="item.id === 'command' && state">{{ readyOpportunities.length }}</b>
            <b v-else-if="item.id === 'signals' && state && newSignals.length">{{ newSignals.length }}</b>
            <b v-else-if="item.id === 'campaigns' && approved.length">{{ approved.length }}</b>
          </button>
        </template>
        <section class="privacy-card">
          <osx-icon name="lock" :size="18"></osx-icon>
          <div><strong>Private by default</strong><span>Your data stays local. AI providers receive only the context needed for each run.</span></div>
        </section>
      </nav>

      <osx-alert v-if="error && state && view !== 'command' && view !== 'onboarding'" class="global-alert" tone="danger" title="Action needs attention" dismissible @dismiss="error = ''">{{ error }}</osx-alert>
      <osx-alert v-if="productNotice && state && view === 'memory'" class="global-alert" :tone="productNotice.tone" :title="productNotice.title" dismissible @dismiss="productNotice = null">{{ productNotice.detail }}</osx-alert>
      <osx-alert v-if="planBusy" class="global-alert active-run-alert" tone="info" title="Creating recommendations">
        <span>{{ activeRuntime?.name || "Native AI" }} is reading the project brief, sources, signals, channel rules, and prior results · {{ planElapsedSeconds }}s</span>
        <osx-button slot="actions" size="small" icon="x" @click="cancelDistributionPlan">Stop</osx-button>
      </osx-alert>

      <section v-if="loading" class="loading-state" aria-live="polite">
        <osx-spinner size="large" label="Loading workspace"></osx-spinner>
        <strong>Loading local data…</strong>
      </section>

      <osx-alert v-else-if="error && !state" tone="danger" title="Local service unavailable">{{ error }}</osx-alert>

      <ProductOnboarding v-else-if="state && view === 'onboarding'" :busy="onboardingBusy" :error="error" @submit="createProduct" />

      <main v-else-if="state && view === 'command'" class="command-center">
        <osx-alert v-if="error" tone="danger" title="Action needs attention" dismissible @dismiss="error = ''">{{ error }}</osx-alert>
        <osx-alert v-if="planNotice" :tone="planNotice.tone" :title="planNotice.title" dismissible @dismiss="planNotice = null">{{ planNotice.detail }}</osx-alert>
        <header class="command-hero">
          <div>
            <p class="eyebrow">RECOMMENDATIONS</p>
            <h1>{{ readyOpportunities.length === 0 ? "Nothing needs your attention." : readyOpportunities.length === 1 ? "One recommendation to review." : `${readyOpportunities.length} recommendations to review.` }}</h1>
            <p><strong>{{ activeProduct?.name || "All Projects" }}</strong> · Each recommendation cites its sources and follows your channel rules.</p>
          </div>
          <div class="system-score"><span>Source coverage</span><strong>{{ scopedConfidence }}%</strong><small>Based on the project brief</small></div>
        </header>

        <section class="metric-grid" aria-label="Distribution metrics">
          <article><span>To review</span><strong>{{ readyOpportunities.length }}</strong><small>Ranked by usefulness</small></article>
          <article><span>Approved</span><strong>{{ approved.length }}</strong><small>Ready to publish</small></article>
          <article><span>Sources</span><strong>{{ scopedEvidenceCount }}</strong><small>Across {{ scopedProducts.length }} project{{ scopedProducts.length === 1 ? "" : "s" }}</small></article>
          <article><span>Signal connections</span><strong>{{ scopedConnectors.length + (devToChannel?.connector.configured && (!activeProductId || devToChannel.connector.productId === activeProductId) ? 1 : 0) }}</strong><small>Read only · reviewed by you</small></article>
        </section>

        <section class="queue-section">
          <div class="section-heading">
            <div><p class="eyebrow">TO REVIEW</p><h2>Help before you promote</h2></div>
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
                <div class="evidence-line"><osx-icon name="check" :size="15"></osx-icon>{{ opportunity.evidence.length }} supporting source{{ opportunity.evidence.length === 1 ? "" : "s" }}</div>
              </div>
              <div class="opportunity-score"><strong>{{ opportunity.score }}</strong><span>FIT</span><osx-icon name="chevron-right" :size="18"></osx-icon></div>
            </button>
            <osx-empty-state v-if="!readyOpportunities.length && !state.products.length" icon="boxes" title="Add your first project">
              Add a repository, URL, document, or pasted notes before Distribution OS creates a recommendation.
              <osx-button slot="actions" variant="primary" icon="plus" @click="view = 'onboarding'">Add project</osx-button>
            </osx-empty-state>
            <osx-empty-state v-else-if="!readyOpportunities.length" icon="check" title="Today's queue is clear">
              Approved work stays in Approved Work. Past decisions and results stay in History. Create another plan when you want new recommendations.
              <osx-button v-if="activeProduct" slot="actions" variant="primary" icon="sparkle" :loading="planBusy" @click="runDistributionPlan(activeProduct.id)">Create new plan</osx-button>
              <osx-button v-else slot="actions" variant="primary" icon="boxes" @click="view = 'memory'">Choose a project</osx-button>
            </osx-empty-state>
          </div>
        </section>
      </main>

      <main v-else-if="state && view === 'automation'" class="workspace-page automation-page">
        <header class="page-header-with-action">
          <div><p class="eyebrow">AUTOMATION</p><h1>Schedule research and drafts.</h1><p>Automation can refresh sources, create recommendations, and prepare cited drafts. You still approve every public action.</p></div>
          <osx-button :variant="state.automation.control.paused ? 'primary' : 'secondary'" :icon="state.automation.control.paused ? 'play' : 'pause'" :loading="automationBusyId === 'control'" @click="toggleAutomationControl">{{ state.automation.control.paused ? "Resume automation" : "Pause automation" }}</osx-button>
        </header>

        <osx-alert v-if="automationNotice" :tone="automationNotice.tone" :title="automationNotice.title" dismissible @dismiss="automationNotice = null">{{ automationNotice.detail }}</osx-alert>
        <osx-alert :tone="state.automation.control.paused ? 'warning' : 'info'" :title="state.automation.control.paused ? 'Automation is paused' : 'You approve every public action'">
          {{ state.automation.control.paused ? "No scheduled source sync, plan, or draft will start until you resume automation." : "Automation can create private drafts and recommendations. It cannot publish on a schedule." }}
        </osx-alert>

        <section class="automation-metrics" aria-label="Automation status">
          <article><span>Active schedules</span><strong>{{ scopedPlaybooks.filter((item) => item.enabled).length }}</strong><small>{{ scopedPlaybooks.length }} configured</small></article>
          <article><span>Needs review</span><strong>{{ scopedAutomationRuns.filter((item) => item.status === 'waiting-approval').length }}</strong><small>Prepared, not published</small></article>
          <article><span>Scheduled publishing</span><strong>OFF</strong><small>Approval is always required</small></article>
          <article><span>Draft limit</span><strong>{{ scopedPlaybooks.reduce((sum, item) => sum + (item.enabled ? item.maxActionsPerRun : 0), 0) }}</strong><small>Maximum per run</small></article>
        </section>

        <section v-if="state.products.length" class="automation-create-panel">
          <div class="section-heading"><div><p class="eyebrow">NEW SCHEDULE</p><h2>Choose what runs and when</h2><p>Each run refreshes sources, creates a small plan, prepares cited drafts, and stops for review. If there is no useful work, it creates nothing.</p></div><osx-badge tone="success" dot>Runs locally</osx-badge></div>
          <form class="automation-form" @submit.prevent="createPlaybook">
            <label>Product<select v-model="automationForm.productId"><option v-for="product in state.products" :key="product.id" :value="product.id">{{ productOptionLabel(product) }}</option></select></label>
            <label>Schedule name <small>Optional</small><input v-model="automationForm.name" maxlength="120" placeholder="Weekly project review" /></label>
            <label>Run every<select v-model.number="automationForm.intervalMinutes"><option :value="60">Hour</option><option :value="360">6 hours</option><option :value="720">12 hours</option><option :value="1440">Day</option><option :value="4320">3 days</option><option :value="10080">Week</option></select></label>
            <label>Recommendation limit<select v-model.number="automationForm.maxActionsPerRun"><option :value="1">1 per run</option><option :value="2">2 per run</option><option :value="3">3 per run</option></select></label>
            <footer><span><osx-icon name="lock" :size="15"></osx-icon> You always approve public work.</span><osx-button type="button" variant="primary" icon="plus" :loading="automationBusyId === 'new'" :disabled="Boolean(automationBusyId)" @click="createPlaybook">Create schedule</osx-button></footer>
          </form>
        </section>
        <osx-empty-state v-else class="page-empty-state" icon="refresh" title="Add a project first">Automation needs an approved project brief, sources, and a goal.<osx-button slot="actions" variant="primary" icon="plus" @click="view = 'onboarding'">Add project</osx-button></osx-empty-state>

        <section v-if="scopedPlaybooks.length" class="automation-section">
          <div class="section-heading"><div><p class="eyebrow">SCHEDULES</p><h2>Active automation</h2><p>Schedules keep running after the local service restarts. The same trigger cannot create a duplicate run.</p></div><osx-badge>{{ scopedPlaybooks.length }} configured</osx-badge></div>
          <div class="playbook-grid">
            <article v-for="playbook in scopedPlaybooks" :key="playbook.id" :class="['playbook-card', { paused: !playbook.enabled }]">
              <header><span class="playbook-icon"><osx-icon name="refresh" :size="20"></osx-icon></span><div><h3>{{ playbook.name }}</h3><small>{{ playbook.productName }}</small></div><osx-badge :tone="playbook.enabled ? 'success' : 'warning'" dot>{{ playbook.enabled ? "Active" : "Paused" }}</osx-badge></header>
              <dl><div><dt>Runs every</dt><dd>{{ playbook.intervalMinutes >= 1440 ? `${playbook.intervalMinutes / 1440} day${playbook.intervalMinutes === 1440 ? '' : 's'}` : `${playbook.intervalMinutes / 60} hour${playbook.intervalMinutes === 60 ? '' : 's'}` }}</dd></div><div><dt>Limit</dt><dd>{{ playbook.maxActionsPerRun }} recommendation{{ playbook.maxActionsPerRun === 1 ? "" : "s" }}</dd></div><div><dt>Approval</dt><dd>Always</dd></div></dl>
              <p>{{ playbook.lastRunAt ? `Last run ${formatDate(playbook.lastRunAt)} at ${formatTime(playbook.lastRunAt)}` : "Not run yet" }}<br />{{ playbook.enabled ? `Next due ${formatDate(playbook.nextRunAt)} at ${formatTime(playbook.nextRunAt)}` : "Schedule is paused" }}</p>
              <footer><osx-button size="small" variant="danger" icon="trash" :disabled="Boolean(automationBusyId)" @click="deletePlaybook(playbook)">Delete schedule</osx-button><span class="playbook-primary-actions"><osx-button size="small" :disabled="Boolean(automationBusyId)" @click="togglePlaybook(playbook.id, !playbook.enabled, playbook.intervalMinutes, playbook.maxActionsPerRun)">{{ playbook.enabled ? "Pause" : "Resume" }}</osx-button><osx-button size="small" variant="primary" icon="play" :loading="automationBusyId === playbook.id" :disabled="Boolean(automationBusyId) || !playbook.enabled || state.automation.control.paused" @click="runPlaybook(playbook.id)">Run now</osx-button></span></footer>
            </article>
          </div>
        </section>

        <section class="automation-section">
          <div class="section-heading">
            <div><p class="eyebrow">CONNECTIONS</p><h2>Connect tools without giving up control</h2><p>Add APIs, MCP servers, local CLIs, gateways, or manual handoffs. Distribution OS checks permissions before every action.</p></div>
            <div class="section-heading-actions"><osx-badge>{{ state.automation.adapters.length }} connections</osx-badge><osx-button size="small" icon="plus" @click="actionAdapterOpen = !actionAdapterOpen">{{ actionAdapterOpen ? "Close" : "Add connection" }}</osx-button></div>
          </div>
          <form v-if="actionAdapterOpen" class="action-adapter-form" @submit.prevent="saveActionAdapter">
            <header><div><strong>Add a connection</strong><p>This step stores no token and runs nothing. Credentials stay in an environment variable or secure storage.</p></div><osx-badge tone="success" dot>Local config</osx-badge></header>
            <div class="adapter-transport-picker" role="radiogroup" aria-label="Adapter transport">
              <button v-for="transport in state.automation.actionFabric.transports.filter((item) => item.id !== 'direct-api')" :key="transport.id" type="button" :class="{ active: actionAdapterForm.transport === transport.id }" @click="setAdapterTransport(transport.id as Exclude<ActionTransport, 'direct-api'>)"><strong>{{ transport.name }}</strong><small>{{ transport.description }}</small></button>
            </div>
            <div class="action-adapter-fields">
              <label>Connection name<input v-model="actionAdapterForm.name" required maxlength="80" placeholder="Research MCP" /></label>
              <template v-if="actionAdapterForm.transport === 'mcp'"><label>MCP HTTP endpoint<input v-model="actionAdapterForm.endpoint" required inputmode="url" placeholder="http://127.0.0.1:3001/mcp" /></label><label>Bearer-token environment variable <small>Optional. Distribution OS does not store the value.</small><input v-model="actionAdapterForm.credentialEnv" autocomplete="off" placeholder="RESEARCH_MCP_TOKEN" /></label></template>
              <label v-else-if="actionAdapterForm.transport === 'cli'">Allowed executable<select v-model="actionAdapterForm.command"><option value="gh">GitHub CLI · limited read access</option></select><small>Set up Claude Code, Cursor, OpenCode, and Codex in AI Settings. They are not publishing connections.</small></label>
              <template v-else-if="actionAdapterForm.transport === 'managed-gateway'"><label>Gateway<select v-model="actionAdapterForm.gateway"><option value="composio">Composio over MCP</option></select></label><label>MCP endpoint<input v-model="actionAdapterForm.endpoint" required inputmode="url" placeholder="https://your-gateway.example/mcp" /></label><label>Connection reference <small>Optional label, never a token</small><input v-model="actionAdapterForm.connectionRef" placeholder="founder-social" /></label><label>Bearer-token environment variable <small>Optional; read only by the local service</small><input v-model="actionAdapterForm.credentialEnv" autocomplete="off" placeholder="COMPOSIO_MCP_TOKEN" /></label></template>
              <label v-else>Execution owner<input value="Human handoff" disabled /></label>
            </div>
            <fieldset><legend>Allowed actions</legend><label v-for="capability in actionCapabilityOptions" :key="capability"><input type="checkbox" :checked="actionAdapterForm.capabilities.includes(capability)" @change="toggleAdapterCapability(capability)" />{{ capability }}</label></fieldset>
            <footer><span><osx-icon name="shield" :size="16"></osx-icon> Any action taken as you requires approval.</span><osx-button variant="primary" icon="plus" :loading="actionAdapterBusyId === 'new-adapter'" @click="saveActionAdapter">Add connection</osx-button></footer>
          </form>
          <div class="fabric-policy-strip"><span v-for="value in state.automation.actionFabric.ethos" :key="value"><osx-icon name="check" :size="14"></osx-icon>{{ value }}</span></div>
          <div class="adapter-list">
            <article v-for="adapter in state.automation.adapters" :key="adapter.id">
              <span class="adapter-icon"><osx-icon :name="adapter.publicSideEffect ? 'send' : adapter.transport === 'mcp' ? 'boxes' : adapter.transport === 'cli' ? 'terminal' : adapter.id === 'github-observer' ? 'git-branch' : 'sparkle'" :size="19"></osx-icon></span>
              <div><strong>{{ adapter.name }}</strong><p>{{ adapter.description }}</p><small>{{ adapter.transport.replace('-', ' ') }} · {{ adapter.capabilities.join(' · ') }}</small><span class="adapter-contract">{{ adapter.risk.replace('-', ' ') }} · {{ adapter.approval.replace('-', ' ') }} approval · {{ adapter.configSummary }}</span><span v-if="adapter.connection.lastCheckedAt" class="adapter-checked">Checked {{ formatDate(adapter.connection.lastCheckedAt) }} at {{ formatTime(adapter.connection.lastCheckedAt) }} · {{ adapter.connection.credentialSource.replace('-', ' ') }} credentials</span><span v-if="adapter.connection.lastError" class="adapter-error">{{ adapter.connection.lastError }}</span><div v-if="adapter.connection.tools.length" class="adapter-tools"><button v-for="tool in adapter.connection.tools" :key="tool.name" type="button" :title="adapter.origin === 'core' && adapter.id !== 'human-handoff' ? `${tool.description} Use its purpose-built workspace.` : tool.description" :disabled="adapter.origin === 'core' && adapter.id !== 'human-handoff'" @click="openActionInvocation(adapter, tool)"><osx-icon :name="tool.publicSideEffect ? 'send' : 'boxes'" :size="13"></osx-icon>{{ tool.name }}<small>{{ tool.capabilities.join(' · ') }}</small></button></div></div>
              <aside><osx-badge :tone="adapter.state === 'available' ? 'success' : adapter.state === 'disabled' ? 'warning' : 'neutral'" dot>{{ adapter.state === 'available' ? (adapter.transport === 'manual' ? 'handoff ready' : adapter.origin === 'core' ? 'ready' : 'verified') : adapter.state }}</osx-badge><osx-button v-if="adapter.origin === 'user' && adapter.state !== 'disabled'" size="small" icon="refresh" :loading="actionAdapterBusyId === adapter.id" @click="probeAdapter(adapter)">{{ adapter.transport === "manual" ? (adapter.connection.lastCheckedAt ? "Reconfirm handoff" : "Confirm handoff") : (adapter.connection.lastCheckedAt ? "Recheck" : "Test connection") }}</osx-button><osx-button size="small" :disabled="adapter.state !== 'available'" @click="inspectActionBoundary(adapter)">Check rules</osx-button><osx-button v-if="adapter.origin === 'user'" size="small" @click="toggleActionAdapter(adapter)">{{ adapter.state === "disabled" ? "Enable" : "Disable" }}</osx-button></aside>
            </article>
          </div>
          <form v-if="actionInvocationOpen" class="action-invocation-form" @submit.prevent="runActionInvocation">
            <header><div><p class="eyebrow">ACTION REQUEST</p><h3>{{ actionInvocation.adapterName }} · {{ actionInvocation.toolName }}</h3><p>Distribution OS checks the request before calling the connection. Any action taken as you stops for approval.</p></div><osx-button size="small" icon="close" aria-label="Close action request" @click="actionInvocationOpen = false">Close</osx-button></header>
            <div class="action-invocation-fields"><label>Action<select v-model="actionInvocation.capability"><option v-for="capability in state.automation.adapters.find((item) => item.id === actionInvocation.adapterId)?.connection.tools.find((item) => item.name === actionInvocation.toolName)?.capabilities || []" :key="capability" :value="capability">{{ capability }}</option></select></label><label>Purpose<input v-model="actionInvocation.purpose" required maxlength="500" placeholder="Learn which documented pain points recur in this repository" /></label><label>Source IDs <small>Separate IDs with commas</small><input v-model="actionInvocation.evidenceRefs" placeholder="source-id, signal-id" /></label><label>Arguments JSON<textarea v-model="actionInvocation.argumentsJson" rows="6" spellcheck="false"></textarea></label></div>
            <footer><span><osx-icon name="shield" :size="15"></osx-icon> Credential fields are rejected before the request is saved.</span><osx-button variant="primary" icon="play" :loading="actionAdapterBusyId === 'action-request'" @click="runActionInvocation">Check request</osx-button></footer>
          </form>

          <div class="connection-ledger-heading"><div><strong>Connection history</strong><p>Each request records its rules, safe preview, approval time, and confirmed result. A missing result counts as a failure.</p></div><osx-badge>{{ state.automation.actionFabric.executions.length }} recent</osx-badge></div>
          <div v-if="state.automation.actionFabric.executions.length" class="connection-ledger">
            <article v-for="record in state.automation.actionFabric.executions" :key="record.id">
              <header><div><strong>{{ record.adapterName }} · {{ record.toolName }}</strong><small>{{ record.capability }} · {{ formatDate(record.createdAt) }} at {{ formatTime(record.createdAt) }}</small></div><osx-badge :tone="record.status === 'completed' ? 'success' : record.status === 'failed' || record.status === 'blocked' ? 'danger' : 'warning'" dot>{{ record.status.replace('-', ' ') }}</osx-badge></header>
              <p>{{ record.summary || record.error || record.decision.reasons.join(' ') }}</p><small>Purpose: {{ record.purpose }} · Evidence: {{ record.evidenceRefs.join(', ') || 'none' }}<template v-if="record.approvedAt"> · Approved {{ formatDate(record.approvedAt) }} at {{ formatTime(record.approvedAt) }}</template></small>
              <details class="action-payload-preview" :open="record.status === 'approval-required'"><summary>Review sanitized action payload</summary><pre>{{ record.argumentPreview }}</pre></details>
              <footer v-if="record.status === 'approval-required'"><span><osx-icon name="lock" :size="14"></osx-icon>Review the exact sanitized payload and evidence before allowing one connection call.</span><osx-button variant="primary" size="small" icon="check" :loading="actionAdapterBusyId === record.id" @click="approveAction(record)">Approve and run once</osx-button></footer>
              <footer v-else-if="record.externalUrl"><span>Confirmed external result</span><osx-link :href="record.externalUrl" external>Open result</osx-link></footer>
            </article>
          </div>
          <osx-empty-state v-else icon="boxes" title="No connection actions yet">Verify a connection, choose one of its tools, and submit a request. Adding a connection never runs it.</osx-empty-state>
        </section>

        <section class="automation-section">
          <div class="section-heading"><div><p class="eyebrow">RUN HISTORY</p><h2>See what each schedule did</h2><p>Review triggers, steps, failures, prepared recommendations, and approval waits. Distribution OS does not store prompts, credentials, or hidden reasoning.</p></div><osx-badge>{{ scopedAutomationRuns.length }} recent</osx-badge></div>
          <div v-if="scopedAutomationRuns.length" class="automation-run-list">
            <article v-for="run in scopedAutomationRuns" :key="run.id">
              <header><div><strong>{{ run.playbookName }}</strong><small>{{ run.productName }} · {{ run.trigger }} · {{ formatDate(run.createdAt) }} at {{ formatTime(run.createdAt) }}</small></div><osx-badge :tone="run.status === 'waiting-approval' || run.status === 'completed' ? 'success' : run.status === 'failed' ? 'danger' : 'warning'" dot>{{ run.status.replace('-', ' ') }}</osx-badge></header>
              <p>{{ run.summary || run.error || "Run in progress" }}</p>
              <ol><li v-for="step in run.steps" :key="step.id"><span :class="['run-step-dot', step.status]"></span><div><strong>{{ step.name }}</strong><small>{{ step.detail }}</small></div></li></ol>
              <footer v-if="run.createdOpportunityIds.length"><osx-button size="small" icon="inbox" @click="reviewAutomationRun(run)">Review prepared work</osx-button></footer>
            </article>
          </div>
          <osx-empty-state v-else icon="activity" title="No automation runs yet">Create a schedule and run it once. Future runs start only while automation is active.</osx-empty-state>
        </section>
      </main>

      <main v-else-if="state && view === 'memory'" class="workspace-page">
        <header class="page-header-with-action"><div><p class="eyebrow">PROJECTS</p><h1>Choose a project.</h1><p>Your sources, signals, recommendations, drafts, and results stay with the selected project.</p></div><osx-button variant="primary" icon="plus" @click="view = 'onboarding'">Add project</osx-button></header>
        <div class="product-grid">
          <article v-for="product in state.products" :key="product.id" :class="['product-card', { active: activeProductId === product.id }]">
            <div><span class="product-monogram">{{ product.name.charAt(0) }}</span><osx-badge tone="success" size="small">{{ product.confidence }}% source coverage</osx-badge></div>
            <h2>{{ product.name }}</h2><p>{{ product.description }}</p>
            <dl class="product-brief"><div><dt>Audience</dt><dd>{{ product.audience }}</dd></div><div><dt>Objective</dt><dd>{{ product.objective }}</dd></div></dl>
            <footer>
              <strong>{{ product.evidenceCount }} sources · {{ product.stage }}</strong>
              <div class="product-actions">
                <osx-button size="small" variant="primary" icon="dashboard" @click="openProject(product.id)">Open workspace</osx-button>
                <span class="product-secondary-actions">
                  <osx-link v-if="product.websiteUrl || product.repositoryUrl" :href="product.websiteUrl || product.repositoryUrl" external>Open source</osx-link>
                  <osx-button size="small" icon="sparkle" :loading="planBusy" :disabled="Boolean(productDeleteBusyId)" @click="runDistributionPlan(product.id)">Generate plan</osx-button>
                  <osx-button class="product-delete-action" size="small" variant="danger" icon="trash" :loading="productDeleteBusyId === product.id" :disabled="Boolean(productDeleteBusyId)" @click="permanentlyDeleteProduct(product)">Delete</osx-button>
                </span>
              </div>
            </footer>
          </article>
          <osx-empty-state v-if="!state.products.length" class="page-empty-state" icon="boxes" title="No distribution projects yet">
            Start with whatever explains the product today. Code is useful, but it is not required.
            <osx-button slot="actions" variant="primary" icon="plus" @click="view = 'onboarding'">Add the first project</osx-button>
          </osx-empty-state>
          <button v-else class="add-product-card" @click="view = 'onboarding'"><osx-icon name="plus" :size="24"></osx-icon><strong>Add another project</strong><span>Repository, URL, document, or pasted context</span></button>
        </div>
      </main>

      <main v-else-if="state && view === 'signals'" class="workspace-page">
        <header class="page-header-with-action">
          <div><p class="eyebrow">SIGNALS</p><h1>Review what people are saying.</h1><p>New observations cannot affect a plan until you accept them. One comment never becomes a trend.</p></div>
          <osx-badge class="review-count-badge" :tone="newSignals.length ? 'warning' : 'success'" dot>{{ newSignals.length ? `${newSignals.length} awaiting review` : "Inbox clear" }}</osx-badge>
        </header>

        <section v-if="state.products.length" class="audience-signal-panel signal-capture-panel">
          <div class="section-heading"><div><p class="eyebrow">READ-ONLY SOURCE</p><h2>Connect GitHub issues</h2><p>Import recent repository issues as signals. Distribution OS skips pull requests and duplicates. You still review every observation.</p></div><osx-badge :tone="scopedConnectors.length ? 'success' : 'info'" dot>{{ scopedConnectors.length }} connected</osx-badge></div>
          <form class="connector-form" @submit.prevent="connectGitHub">
            <label>Project<select :value="connectorForm.productId" @change="selectConnectorProduct(($event.target as HTMLSelectElement).value)"><option v-for="product in scopedProducts" :key="product.id" :value="product.id">{{ productOptionLabel(product) }}</option></select></label>
            <label>GitHub repository <small>Public repos work without a token</small><input v-model="connectorForm.repository" inputmode="url" placeholder="owner/repository or https://github.com/…" /></label>
            <osx-button type="button" variant="primary" icon="git-branch" :loading="connectorBusyId === 'new'" :disabled="Boolean(connectorBusyId) || !connectorForm.repository.trim()" @click="connectGitHub">Connect & import</osx-button>
          </form>
          <div v-if="scopedConnectors.length" class="connector-list">
            <article v-for="connector in scopedConnectors" :key="connector.id">
              <span class="connector-mark"><osx-icon name="git-branch" :size="20"></osx-icon></span>
              <div><strong>{{ connector.name }}</strong><small>{{ connector.productName }} · {{ connector.lastSyncedAt ? `synced ${formatDate(connector.lastSyncedAt)} at ${formatTime(connector.lastSyncedAt)}` : 'not synced' }} · {{ connector.importedCount }} imported</small><p v-if="connector.lastError">{{ connector.lastError }}</p></div>
              <osx-badge :tone="connector.status === 'connected' ? 'success' : 'danger'" dot>{{ connector.status }}</osx-badge>
              <span class="connector-actions"><osx-button size="small" icon="refresh" :loading="connectorBusyId === connector.id" :disabled="Boolean(connectorBusyId)" @click="syncConnector(connector.id)">Sync</osx-button><osx-button size="small" :disabled="Boolean(connectorBusyId)" @click="disconnectConnector(connector.id)">Disconnect</osx-button></span>
            </article>
          </div>
          <osx-alert v-if="connectorNotice" :tone="connectorNotice.tone" :title="connectorNotice.title" dismissible @dismiss="connectorNotice = null">{{ connectorNotice.detail }}</osx-alert>
        </section>

        <section v-if="state.products.length" class="audience-signal-panel signal-capture-panel">
          <div class="section-heading"><div><p class="eyebrow">ADD SIGNAL</p><h2>Save one useful observation</h2><p>Paste the relevant part of a public discussion or add its URL.</p></div><osx-badge tone="info">Manual source</osx-badge></div>
          <form class="signal-form" @submit.prevent="captureSignal">
            <label>Project<select v-model="signalForm.productId"><option v-for="product in scopedProducts" :key="product.id" :value="product.id">{{ productOptionLabel(product) }}</option></select></label>
            <label>Source type<select v-model="signalForm.type"><option value="text">Paste discussion context</option><option value="url">Public URL</option></select></label>
            <label>Source label <small>Make citations recognizable</small><input v-model="signalForm.label" placeholder="Example: Hacker News launch discussion" /></label>
            <label class="wide">{{ signalForm.type === 'url' ? 'Public discussion URL' : 'What did the audience say or ask?' }}
              <input v-if="signalForm.type === 'url'" v-model="signalForm.value" type="url" placeholder="https://…" />
              <textarea v-else v-model="signalForm.value" rows="5" placeholder="Paste the relevant public excerpt or your own observation. Keep the original context."></textarea>
            </label>
            <footer><span>Saving a signal does not approve it, contact anyone, or publish anything.</span><osx-button type="button" variant="primary" icon="plus" :loading="signalBusy" :disabled="!signalForm.value.trim()" @click="captureSignal">Save signal</osx-button></footer>
          </form>
          <osx-alert v-if="signalNotice" :tone="signalNotice.tone" :title="signalNotice.title" dismissible @dismiss="signalNotice = null">{{ signalNotice.detail }}</osx-alert>
        </section>

        <osx-empty-state v-else class="page-empty-state" icon="inbox" title="Add a project before collecting signals">Signals need a project, audience, and goal so you can judge whether they matter.<osx-button slot="actions" variant="primary" icon="plus" @click="view = 'onboarding'">Add project</osx-button></osx-empty-state>

        <section v-if="state.products.length" class="signal-inbox-section">
          <div class="section-heading"><div><p class="eyebrow">TO REVIEW</p><h2>Could this change your next decision?</h2><p>Accept only specific observations that could change what you do next.</p></div><osx-badge>{{ newSignals.length }} new</osx-badge></div>
          <div v-if="newSignals.length" class="signal-inbox-list">
            <article v-for="signal in newSignals" :key="signal.id" class="signal-candidate-card">
              <span class="signal-icon"><osx-icon :name="signal.kind === 'question' ? 'help-circle' : signal.kind === 'pain' ? 'alert-circle' : signal.kind === 'request' ? 'message-circle' : 'search'" :size="19"></osx-icon></span>
              <div class="signal-candidate-copy"><div><osx-badge tone="info" size="small">{{ signal.kind }}</osx-badge><osx-badge v-if="signal.origin === 'github'" size="small">GitHub</osx-badge><osx-badge v-else-if="signal.origin === 'devto'" size="small">DEV</osx-badge><span>{{ signal.productName }} · {{ formatDate(signal.capturedAt) }}</span></div><h3>{{ signal.title }}</h3><p>{{ signal.summary }}</p><small>{{ signal.reason }}</small></div>
              <div class="signal-relevance"><strong>{{ signal.relevance }}</strong><span>RELEVANCE</span></div>
              <footer><osx-link v-if="signal.sourceUrl" :href="signal.sourceUrl" external>Inspect source</osx-link><span v-else>Founder-supplied excerpt</span><div><osx-button size="small" :disabled="Boolean(signalActionId)" @click="reviewSignal(signal.id, 'dismiss')">Dismiss</osx-button><osx-button size="small" variant="primary" icon="check" :loading="signalActionId === signal.id" :disabled="Boolean(signalActionId)" @click="reviewSignal(signal.id, 'accept')">Accept as evidence</osx-button></div></footer>
            </article>
          </div>
          <osx-empty-state v-else icon="check" title="All signals reviewed">Accepted signals appear in Audience and can support the next plan.</osx-empty-state>
        </section>

        <section v-if="reviewedSignals.length" class="reviewed-signals-section">
          <div class="section-heading"><div><p class="eyebrow">REVIEWED</p><h2>Decision history</h2></div><osx-badge>{{ reviewedSignals.length }} decisions</osx-badge></div>
          <div class="reviewed-signal-list"><article v-for="signal in reviewedSignals" :key="signal.id"><div><strong>{{ signal.title }}</strong><small>{{ signal.productName }} · {{ formatDate(signal.decidedAt || signal.capturedAt) }}</small></div><osx-badge :tone="signal.status === 'accepted' ? 'success' : 'neutral'" dot>{{ signal.status }}</osx-badge><osx-button v-if="signal.status === 'dismissed'" size="small" :loading="signalActionId === signal.id" @click="reviewSignal(signal.id, 'restore')">Restore</osx-button></article></div>
        </section>
      </main>

      <main v-else-if="state && view === 'audience'" class="workspace-page">
        <header><p class="eyebrow">AUDIENCE</p><h1>Who needs this, and why?</h1><p>Use real observations to choose where you can help.</p></header>
        <div v-if="scopedProducts.length" class="audience-grid">
          <article v-for="product in scopedProducts" :key="product.id"><osx-icon name="user" :size="24"></osx-icon><h2>{{ product.audience }}</h2><p>{{ product.name }} is working toward: {{ product.objective }}</p><div><osx-badge>{{ product.stage }}</osx-badge><osx-badge tone="info">{{ product.confidence }}% source coverage</osx-badge></div></article>
        </div>
        <osx-empty-state v-else class="page-empty-state" icon="user" title="No audience yet">Add and review a project first.<osx-button slot="actions" variant="primary" icon="plus" @click="view = 'onboarding'">Add project</osx-button></osx-empty-state>
        <section v-if="state.products.length" class="audience-signal-panel">
          <div class="section-heading"><div><p class="eyebrow">ACCEPTED SIGNALS</p><h2>Observations you chose to use</h2><p>These signals passed your review. Each one is still a single observation, not proof of demand or a broad trend.</p></div><span class="heading-actions"><osx-badge tone="info">{{ scopedAudienceSignals.length }} accepted</osx-badge><osx-button size="small" icon="inbox" @click="view = 'signals'">Open Signals</osx-button></span></div>
          <div v-if="scopedAudienceSignals.length" class="signal-list">
            <article v-for="signal in scopedAudienceSignals" :key="signal.id"><span class="signal-icon"><osx-icon :name="signal.sourceType === 'url' ? 'globe' : 'message-circle'" :size="18"></osx-icon></span><div><strong>{{ signal.title }}</strong><p>{{ signal.summary }}</p><small>{{ signal.productName }} · {{ formatDate(signal.occurredAt) }} · {{ signal.sourceUrl ? 'public source' : 'founder supplied' }}</small></div><osx-link v-if="signal.sourceUrl" :href="signal.sourceUrl" external>Open source</osx-link></article>
          </div>
          <osx-empty-state v-else icon="message-circle" title="No accepted signals yet">Project sources explain what you built. Audience signals show what people discuss. Review one real signal before creating another plan.<osx-button slot="actions" variant="primary" icon="inbox" @click="view = 'signals'">Open Signals</osx-button></osx-empty-state>
        </section>
      </main>

      <main v-else-if="state && view === 'campaigns'" class="workspace-page">
        <header><p class="eyebrow">APPROVED WORK</p><h1>Publish when you are ready.</h1><p>Copy drafts for manual channels. DEV can publish one approved draft after you confirm the exact action.</p></header>
        <osx-alert v-if="campaignNotice" :tone="campaignNotice.tone" :title="campaignNotice.title" dismissible @dismiss="campaignNotice = null">{{ campaignNotice.detail }}</osx-alert>
        <section class="data-panel">
          <article v-for="opportunity in approved" :key="opportunity.id" class="campaign-artifact">
            <header class="campaign-row">
              <span class="status-orb"></span><div><strong>{{ opportunity.title }}</strong><small>{{ opportunity.productName }} · {{ opportunity.channelName }}</small></div><osx-badge tone="success">Approved</osx-badge><span class="campaign-actions"><osx-button size="small" icon="copy" @click="copyCampaignDraft(opportunity)">{{ copiedOpportunityId === opportunity.id ? "Copied" : "Copy draft" }}</osx-button><osx-button size="small" @click="decide('restore', opportunity)">Return to queue</osx-button><osx-button v-if="opportunity.channelId === 'devto'" size="small" variant="primary" icon="send" :disabled="!devToChannel?.connector.authenticated" :loading="actionBusy" @click="publishToDev(opportunity)">Publish to DEV</osx-button><osx-button v-else size="small" variant="primary" icon="activity" @click="outcomeOpportunityId = opportunity.id">Record outcome</osx-button></span>
            </header>
            <pre class="campaign-draft">{{ opportunity.draftCopy }}</pre>
          </article>
          <form v-if="outcomeOpportunityId" class="outcome-form" @submit.prevent="saveOutcome">
            <div><p class="eyebrow">RESULT</p><h2>What happened after you published?</h2><p>This result will inform the next plan.</p></div>
            <label>Metric<select v-model="outcomeForm.metric"><option value="qualified-visits">Qualified visits</option><option value="replies">Replies</option><option value="conversations">Conversations</option><option value="signups">Signups</option><option value="stars">Stars</option><option value="revenue">Revenue</option></select></label>
            <label>Value<input v-model.number="outcomeForm.value" type="number" min="0" step="any" /></label>
            <label class="wide">What did you learn?<textarea v-model="outcomeForm.note" rows="3" placeholder="Optional context that should influence the next plan"></textarea></label>
            <footer><osx-button size="small" @click="outcomeOpportunityId = ''">Cancel</osx-button><osx-button type="button" variant="primary" icon="check" :loading="actionBusy" @click="saveOutcome">Save result</osx-button></footer>
          </form>
          <osx-empty-state v-if="!approved.length" icon="send" title="Nothing approved yet">Review a recommendation first. Distribution OS never publishes it automatically.</osx-empty-state>
        </section>
        <section v-if="published.length" class="data-panel">
          <div class="section-heading"><div><p class="eyebrow">PUBLISHED</p><h2>Receipts and results</h2><p>Metrics are snapshots. Distribution OS does not claim that one post caused them.</p></div><osx-badge>{{ published.length }} published</osx-badge></div>
          <article v-for="opportunity in published" :key="opportunity.id" class="campaign-artifact">
            <header class="campaign-row"><span class="status-orb"></span><div><strong>{{ opportunity.title }}</strong><small>{{ opportunity.productName }} · {{ opportunity.channelName }}</small></div><osx-badge tone="success">Published</osx-badge><osx-link v-if="opportunity.execution?.externalUrl" :href="opportunity.execution.externalUrl" external>Open receipt</osx-link></header>
            <div class="outcome-summary"><span v-for="outcome in opportunity.outcomes" :key="outcome.metric"><strong>{{ outcome.value }}</strong> {{ outcome.metric }}</span></div>
          </article>
        </section>
      </main>

      <main v-else-if="state && view === 'channels'" class="workspace-page">
        <header><p class="eyebrow">CHANNELS</p><h1>Choose where and how to publish.</h1><p>Set daily limits and approval rules. Every public action still needs your confirmation.</p></header>
        <section class="channel-grid">
          <article v-for="channel in state.channels" :key="channel.id" class="channel-card">
            <header><span class="channel-mark">{{ channel.name.charAt(0) }}</span><div><h2>{{ channel.name }}</h2><p>{{ channel.handle }}</p></div><osx-badge :tone="channel.connected ? 'success' : channel.status === 'manual' ? 'warning' : 'neutral'" dot>{{ channel.status }}</osx-badge></header>
            <dl><div><dt>Mode</dt><dd>{{ channel.mode }}</dd></div><div><dt>Daily limit</dt><dd>{{ channel.dailyLimit }}</dd></div><div><dt>Replies</dt><dd>Approval required</dd></div></dl>
            <form v-if="channelEditingId === channel.id" class="channel-policy-form" @submit.prevent="saveChannel(channel)">
              <label>Review mode<select v-model="channelForm.mode"><option value="draft">Draft only</option><option value="approval">Human approval</option></select></label>
              <label>Daily limit<input v-model.number="channelForm.dailyLimit" type="number" min="0" max="100" step="1" /></label>
              <small>{{ channel.id === 'devto' ? 'DEV publishes only one approved draft after you confirm it.' : 'These settings affect plans and review. Distribution OS does not publish to this channel.' }}</small>
              <footer><osx-button size="small" @click="channelEditingId = ''">Cancel</osx-button><osx-button type="button" size="small" variant="primary" icon="check" :loading="actionBusy" @click="saveChannel(channel)">Save settings</osx-button></footer>
            </form>
            <footer v-else><osx-toggle :checked="channel.connected" disabled>{{ channel.connected ? 'Connection enabled' : 'Not connected' }}</osx-toggle><osx-button size="small" icon="settings" @click="editChannel(channel)">Edit settings</osx-button></footer>
          </article>
        </section>
        <section v-if="state.products.length" class="devto-connector-panel">
          <div class="section-heading"><div><p class="eyebrow">DEV</p><h2>Find signals and publish approved drafts</h2><p>Public search adds observations to Signals. They do not affect a plan until you accept them.</p></div><osx-badge :tone="devToChannel?.connector.configured ? 'success' : 'info'" dot>{{ devToChannel?.connector.configured ? 'Signals connected' : 'Read only' }}</osx-badge></div>
          <div class="devto-credential-panel">
            <div><strong>1 · Add a DEV API key</strong><p>Reading public signals needs no key. Publishing and reading results do. Create a key in <a href="https://dev.to/settings/extensions" target="_blank" rel="noreferrer">DEV Settings → Extensions</a>. Distribution OS verifies it before saving it to macOS Keychain.</p></div>
            <osx-badge v-if="devToChannel?.connector.authenticated" tone="success" dot>{{ devToChannel.connector.credentialSource }} credential</osx-badge>
            <label>DEV API key<input v-model="devToApiKey" type="password" autocomplete="off" placeholder="Paste key from DEV" /></label>
            <osx-button variant="primary" icon="lock" :loading="devToBusy" :disabled="!devToApiKey.trim()" @click="saveDevToKey">Verify & save securely</osx-button>
          </div>
          <form class="devto-form" @submit.prevent="connectDevToSignals">
            <strong>2 · Choose signals for this project</strong>
            <label>Project<select v-model="devToForm.productId"><option v-for="product in scopedProducts" :key="product.id" :value="product.id">{{ productOptionLabel(product) }}</option></select></label>
            <label>Audience problem<input v-model="devToForm.signalQuery" maxlength="120" placeholder="Example: open source maintainer distribution" /></label>
            <label>Publish tags · up to 4<input v-model="devToForm.publishTags" placeholder="opensource, productivity" /></label>
            <footer><span>The search applies only to this project. Distribution OS never stores the API key in SQLite.</span><osx-button type="button" variant="primary" icon="refresh" :loading="devToBusy" :disabled="!devToForm.productId || !devToForm.signalQuery.trim()" @click="connectDevToSignals">Connect and sync</osx-button></footer>
          </form>
          <osx-alert v-if="devToNotice" :tone="devToNotice.tone" :title="devToNotice.title" dismissible @dismiss="devToNotice = null">{{ devToNotice.detail }}</osx-alert>
        </section>
        <osx-alert v-if="channelNotice" :tone="channelNotice.tone" :title="channelNotice.title" dismissible @dismiss="channelNotice = null">{{ channelNotice.detail }}</osx-alert>
      </main>

      <main v-else-if="state && view === 'journal'" class="workspace-page">
        <header><p class="eyebrow">HISTORY</p><h1>See what happened.</h1><p>Review past decisions, publications, results, and notes.</p></header>
        <ol class="journal-list">
          <li v-for="event in state.products.length ? scopedEvents : []" :key="event.id"><span class="timeline-dot"></span><time>{{ formatDate(event.occurredAt) }}<small>{{ formatTime(event.occurredAt) }}</small></time><div><strong>{{ event.type.replaceAll('.', ' ') }}</strong><p>{{ event.detail }}</p></div><osx-badge size="small">{{ event.entityType }}</osx-badge></li>
          <osx-empty-state v-if="!state.products.length || !scopedEvents.length" icon="book" title="No history yet">Projects, decisions, publications, and results will appear here in time order.</osx-empty-state>
        </ol>
      </main>

      <main v-else-if="state && view === 'harness'" class="workspace-page harness-page">
        <header class="page-header-with-action">
          <div><p class="eyebrow">AI SETTINGS</p><h1>Choose how AI runs.</h1><p>Use a model API or an installed coding agent to create project briefs and plans.</p></div>
          <osx-button icon="refresh" :loading="aiBusy" @click="discoverRuntimes">Check installed agents</osx-button>
        </header>

        <osx-alert v-if="aiError" tone="danger" title="AI setup needs attention" dismissible @dismiss="aiError = ''">{{ aiError }}</osx-alert>
        <section v-if="!ai" class="loading-state" aria-live="polite"><osx-spinner label="Checking AI options"></osx-spinner><strong>Checking model APIs and installed agents…</strong></section>

        <section v-if="ai" class="execution-summary">
          <div class="execution-mark"><osx-icon :name="ai.execution.runtimeId === 'native' ? 'sparkle' : 'terminal'" :size="24"></osx-icon></div>
          <div><span>ACTIVE AI</span><strong>{{ activeRuntime?.name }}</strong><small v-if="ai.execution.runtimeId === 'native'">{{ activeModelProfile ? `${activeModelProfile.name} · ${activeModelProfile.model}` : "Add a model profile to use AI." }}</small><small v-else>{{ ai.execution.runtimeModel || "Default model" }} · used for project briefs and plans</small></div>
          <osx-badge :tone="activeExecutionReady ? 'success' : 'warning'" dot>{{ activeExecutionReady ? "Ready" : ai.execution.runtimeId === 'native' ? "Setup required" : activeRuntime?.verification === 'failed' ? "Test failed" : "Unverified" }}</osx-badge>
        </section>

        <section class="ownership-grid" aria-label="AI options">
          <article><osx-icon name="sparkle" :size="22"></osx-icon><div><h2>Model APIs</h2><p>Distribution OS controls the tools, retries, sources, and approvals. The provider supplies the model.</p></div></article>
          <article><osx-icon name="terminal" :size="22"></osx-icon><div><h2>Coding agents</h2><p>Claude Code, Cursor, OpenCode, or Codex control their own model and session. Distribution OS supplies the task and sources.</p></div></article>
        </section>

        <section v-if="ai" class="harness-section">
          <div class="section-heading">
            <div><p class="eyebrow">CODING AGENTS</p><h2>Use an agent installed on this computer</h2><p>Detection only proves that the command exists. Test runs one small read-only task and saves the result, duration, and error type.</p></div>
            <span>Last checked {{ formatTime(ai.generatedAt) }}</span>
          </div>
          <osx-alert v-if="runtimeNotice" class="runtime-notice" :tone="runtimeNotice.tone" :title="runtimeNotice.title" dismissible @dismiss="runtimeNotice = null">{{ runtimeNotice.detail }}</osx-alert>
          <div class="runtime-grid">
            <article v-for="runtime in ai.runtimes" :key="runtime.id" :class="['runtime-card', { selected: ai.execution.runtimeId === runtime.id, unavailable: !runtime.available }]">
              <header><span class="runtime-icon"><osx-icon :name="runtime.id === 'native' ? 'sparkle' : 'terminal'" :size="20"></osx-icon></span><div><h3>{{ runtime.name }}</h3><small>{{ runtime.version || (runtime.id === 'native' ? 'Built in' : runtime.command) }}</small></div><osx-badge :tone="runtimeStatusTone(runtime)" size="small" dot>{{ runtimeStatusLabel(runtime) }}</osx-badge></header>
              <p>{{ runtime.verificationDetail || runtime.detail }}<small v-if="runtime.verifiedAt">Tested {{ formatDate(runtime.verifiedAt) }} at {{ formatTime(runtime.verifiedAt) }}<template v-if="runtime.verificationDurationMs"> · {{ runtime.verificationDurationMs }}ms</template></small></p>
              <ul><li v-for="capability in runtime.capabilities" :key="capability"><osx-icon name="check" :size="13"></osx-icon>{{ capability }}</li></ul>
              <label v-if="runtime.id !== 'native' && runtime.ownsModelSelection && ai.execution.runtimeId === runtime.id">Model override <input v-model="runtimeModel" placeholder="Optional. Use the agent default." /></label>
              <footer><span>{{ runtime.ownsModelSelection ? "Agent chooses the model" : "Uses the active model profile" }}</span><span class="runtime-actions"><osx-button v-if="runtime.id !== 'native'" size="small" icon="activity" :loading="testingRuntimeId === runtime.id" :disabled="!runtime.available || Boolean(testingRuntimeId) || aiBusy" @click="verifyAgentRuntime(runtime)">Test</osx-button><osx-button size="small" :variant="ai.execution.runtimeId === runtime.id ? 'secondary' : 'primary'" :disabled="!runtime.available || aiBusy || ai.execution.runtimeId === runtime.id" @click="chooseRuntime(runtime.id)">{{ ai.execution.runtimeId === runtime.id ? "Active" : "Use agent" }}</osx-button></span></footer>
            </article>
          </div>
        </section>

        <section v-if="ai" class="harness-section">
          <div class="section-heading">
            <div><p class="eyebrow">MODEL APIS</p><h2>Connect a model provider</h2><p>The active profile creates project briefs and plans when Native is selected. API keys come from environment variables or {{ ai.secureStorage }}.</p></div>
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
                <label v-if="profileForm.provider !== 'ollama'" class="wide">API key <input v-model="profileForm.apiKey" type="password" autocomplete="off" :placeholder="selectedProvider?.environmentVariables.length ? `Optional if ${selectedProvider.environmentVariables.join(' or ')} is set` : 'Stored securely'" /><small>Leave blank to use an environment variable. Distribution OS saves a supplied key only to {{ ai.secureStorage }}.</small></label>
              </div>
              <osx-alert v-if="profileNotice" class="profile-notice" :tone="profileNotice.tone" :title="profileNotice.title">{{ profileNotice.detail }}</osx-alert>
              <footer><span>Saving adds this API to Native. It does not change the selected coding agent.</span><osx-button type="button" variant="primary" icon="plus" :loading="aiBusy" @click="saveProfile">Save profile</osx-button></footer>
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
          <osx-empty-state v-else icon="sparkle" title="No model profiles">Local project analysis still works. Add a provider to use AI for briefs, plans, and drafts.</osx-empty-state>
        </section>

        <section v-if="scopedHarnessRuns.length" class="harness-section">
          <div class="section-heading"><div><p class="eyebrow">RUN HISTORY</p><h2>See how each AI run finished</h2><p>Review model calls, tool steps, fallbacks, and failures. Distribution OS does not store prompts or credentials.</p></div><osx-badge>{{ scopedHarnessRuns.length }} recent</osx-badge></div>
          <div class="run-ledger">
            <article v-for="run in scopedHarnessRuns" :key="run.id">
              <header><div><strong>{{ run.kind.replaceAll('-', ' ') }}</strong><small>{{ run.provider ? `${run.provider} · ${run.model}` : run.runtimeId }}</small></div><osx-badge :tone="run.status === 'completed' ? 'success' : run.status === 'failed' ? 'danger' : 'warning'" dot>{{ run.status }}</osx-badge></header>
              <p>{{ run.summary || run.error || 'Run in progress' }}</p>
              <ol><li v-for="step in run.steps" :key="step.id"><span :class="['run-step-dot', step.status]"></span><div><strong>{{ step.name }}</strong><small>{{ step.detail }}</small></div></li></ol>
            </article>
          </div>
        </section>
        <section v-else class="harness-section">
          <div class="section-heading"><div><p class="eyebrow">RUN HISTORY</p><h2>No AI runs yet</h2><p>Your first AI project brief or plan will record its model, steps, retries, fallback, and result here.</p></div><osx-badge>0 runs</osx-badge></div>
          <osx-empty-state icon="activity" title="AI run details will appear here">
            {{ state.products.length ? "Create a plan to test the active AI. Nothing will be published." : "Add a project before running AI." }}
            <osx-button slot="actions" variant="primary" :icon="state.products.length ? 'sparkle' : 'plus'" @click="view = state.products.length ? 'memory' : 'onboarding'">{{ state.products.length ? "Open projects" : "Add project" }}</osx-button>
          </osx-empty-state>
        </section>
      </main>

      <main v-else-if="state && view === 'settings'" class="workspace-page">
        <header><p class="eyebrow">SETTINGS</p><h1>Your data stays on this computer.</h1><p>Project sources, signals, drafts, approvals, and results stay in local storage.</p></header>
        <section class="settings-grid">
          <article><osx-icon name="lock" :size="24"></osx-icon><div><h2>Local storage</h2><p>{{ state.storage.location }}</p></div><osx-badge tone="success">Active</osx-badge></article>
          <article><osx-icon name="activity" :size="24"></osx-icon><div><h2>Cloud service</h2><p>A future option for teams, monitoring, and scheduled publishing.</p></div><osx-badge>Not enabled</osx-badge></article>
          <article><osx-icon name="user" :size="24"></osx-icon><div><h2>Public action approval</h2><p>You must approve replies, new channels, and sensitive claims.</p></div><osx-badge tone="info">Required</osx-badge></article>
        </section>
      </main>

      <aside v-if="view === 'command'" slot="inspector" :class="['inspector-panel', { empty: !selected }]">
        <template v-if="selected">
          <header>
          <div><p class="eyebrow">RECOMMENDATION</p><h2>{{ selected.channelName }}</h2></div>
          <osx-badge :tone="selected.promotionRisk < 15 ? 'success' : 'warning'">{{ selected.promotionRisk }} risk</osx-badge>
          </header>
          <section class="reason-card"><h3>Why now</h3><p>{{ selected.whyNow }}</p></section>
          <section class="reason-card"><h3>Contribution angle</h3><p>{{ selected.suggestedAngle }}</p><small>{{ selected.audience }}</small></section>
          <section class="score-panel">
            <h3>Why it ranked here</h3>
            <div><span>Relevance</span><osx-progress :value="selected.relevanceScore" :max="100"></osx-progress><b>{{ selected.relevanceScore }}</b></div>
            <div><span>Audience value</span><osx-progress :value="selected.valueScore" :max="100"></osx-progress><b>{{ selected.valueScore }}</b></div>
            <div><span>Freshness</span><osx-progress :value="selected.freshnessScore" :max="100"></osx-progress><b>{{ selected.freshnessScore }}</b></div>
          </section>
          <section class="evidence-panel">
            <h3>Supporting sources</h3>
            <template v-for="item in selected.evidence" :key="item.id">
              <a v-if="item.sourceUrl" :href="item.sourceUrl" target="_blank" rel="noreferrer"><osx-icon name="file-text" :size="16"></osx-icon><span><strong>{{ item.title }}</strong><small>{{ item.summary }}</small></span><osx-icon name="external" :size="14"></osx-icon></a>
              <div v-else class="evidence-static"><osx-icon name="file-text" :size="16"></osx-icon><span><strong>{{ item.title }}</strong><small>{{ item.summary }}</small></span><osx-badge size="small">{{ item.classification }}</osx-badge></div>
            </template>
          </section>
          <section class="draft-panel">
            <div><span><h3>Draft</h3><small>Edit the exact copy before approval.</small></span><osx-badge size="small">Editable</osx-badge></div>
            <osx-alert v-if="draftNotice" :tone="draftNotice.tone" :title="draftNotice.title" dismissible @dismiss="draftNotice = null">{{ draftNotice.detail }}</osx-alert>
            <textarea v-model="draft" aria-label="Proposed contribution draft"></textarea>
            <footer><span>Uses this recommendation and its cited sources. This action publishes nothing.</span><osx-button size="small" icon="sparkle" :loading="draftBusy" :disabled="actionBusy" @click="writeDraft">Rewrite draft</osx-button></footer>
          </section>
          <footer class="decision-bar">
            <osx-button size="small" :disabled="actionBusy" @click="decide('skip')">Skip for now</osx-button>
            <osx-button variant="primary" icon="check" :loading="actionBusy" @click="decide('approve')">Approve</osx-button>
          </footer>
        </template>
        <osx-empty-state v-else icon="search" title="Nothing to inspect">
          Select a recommendation to review its sources and draft. Add a project first if the list is empty.
          <osx-button slot="actions" variant="primary" icon="plus" @click="view = 'onboarding'">Add project</osx-button>
        </osx-empty-state>
      </aside>

      <osx-status-bar slot="status" :label="state?.onboarding.required ? 'Add a project to start' : state ? `${activeProduct?.name || 'All Projects'} · local data ready` : 'Starting local service'" :status="error ? 'offline' : loading ? 'working' : 'ready'" :detail="state ? `Updated ${formatTime(state.generatedAt)}` : ''">
        <span v-if="state">· You approve every public action</span>
      </osx-status-bar>
    </osx-app-shell>
  </div>
</template>
