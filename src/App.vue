<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from "vue";
import { activateAgentRuntime, activateModelProfile, approveActionExecution, captureProductSignals, connectGitHubSource, createActionAdapter, createAutomationPlaybook, decideOpportunity, decideSignal, disconnectSourceConnector, discoverAIRuntimes, generateProductPlan, loadAIControlPlane, loadDashboard, onboardProduct, previewActionPolicy, probeActionAdapter, recordOpportunityOutcome, refreshWorkspace, requestActionExecution, runAutomationPlaybook, saveModelProfile, setActionAdapterEnabled, setAutomationPaused, syncSourceConnector, testModelProfile, updateAutomationPlaybook, updateChannelPolicy, writeOpportunityDraft } from "./api.ts";
import type { AIControlPlane, AutomationRun, Channel, ChannelMode, DashboardState, ModelProviderId, OnboardProductInput, OnboardingSourceInput, Opportunity } from "../server/domain.ts";
import type { ActionAdapterDescriptor, ActionCapability, ActionExecutionRecord, ActionToolDescriptor, ActionTransport } from "../packages/action-fabric/src/index.ts";
import ProductOnboarding from "./ProductOnboarding.vue";

type View = "command" | "automation" | "onboarding" | "memory" | "signals" | "audience" | "campaigns" | "channels" | "journal" | "harness" | "settings";

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
const signalActionId = ref("");
const signalNotice = ref<{ tone: "success" | "warning" | "danger"; title: string; detail: string } | null>(null);
const signalForm = reactive({ productId: "", type: "text" as "text" | "url", label: "", value: "" });
const connectorBusyId = ref("");
const connectorNotice = ref<{ tone: "success" | "warning" | "danger"; title: string; detail: string } | null>(null);
const connectorForm = reactive({ productId: "", repository: "" });
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

const readyOpportunities = computed(() => state.value?.opportunities.filter((item) => item.status === "ready") ?? []);
const selected = computed(() => {
  if (!state.value) return null;
  return state.value.opportunities.find((item) => item.id === selectedId.value && item.status === "ready")
    ?? readyOpportunities.value[0]
    ?? null;
});
const approved = computed(() => state.value?.opportunities.filter((item) => item.status === "approved") ?? []);
const newSignals = computed(() => state.value?.signalInbox.filter((item) => item.status === "new") ?? []);
const reviewedSignals = computed(() => state.value?.signalInbox.filter((item) => item.status !== "new") ?? []);
const activeRuntime = computed(() => ai.value?.runtimes.find((runtime) => runtime.id === ai.value?.execution.runtimeId) ?? null);
const activeModelProfile = computed(() => ai.value?.profiles.find((profile) => profile.id === ai.value?.execution.modelProfileId) ?? null);
const selectedProvider = computed(() => ai.value?.providers.find((provider) => provider.id === profileForm.provider));
const actionCapabilityOptions = computed<ActionCapability[]>(() => actionAdapterForm.transport === "cli"
  ? ["observe", "search", "read"]
  : actionAdapterForm.transport === "manual"
    ? ["execute", "measure"]
    : ["observe", "search", "read", "prepare", "execute", "measure"]);

watch(selected, (opportunity) => {
  draft.value = opportunity?.draftCopy ?? "";
}, { immediate: true });

onMounted(async () => {
  try {
    state.value = await loadDashboard();
    signalForm.productId = state.value.products[0]?.id ?? "";
    connectorForm.productId = state.value.products[0]?.id ?? "";
    automationForm.productId = state.value.products[0]?.id ?? "";
    connectorForm.repository = state.value.products[0]?.repositoryUrl.includes("github.com") ? state.value.products[0].repositoryUrl : "";
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

async function toggleAutomationControl(): Promise<void> {
  if (!state.value) return;
  automationBusyId.value = "control";
  automationNotice.value = null;
  const paused = !state.value.automation.control.paused;
  try {
    state.value = (await setAutomationPaused(paused)).dashboard;
    automationNotice.value = paused
      ? { tone: "warning", title: "Automation paused", detail: "Scheduled sensing and preparation are stopped. The ledger and approval queue remain available." }
      : { tone: "success", title: "Automation resumed", detail: "Due playbooks may observe and prepare work again. Public actions still require your approval." };
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
    automationNotice.value = { tone: "success", title: "Evidence loop created", detail: "The loop may observe and prepare bounded work on schedule. It cannot publish, reply, or impersonate you." };
  } catch (cause) {
    automationNotice.value = { tone: "danger", title: "Playbook was not created", detail: cause instanceof Error ? cause.message : "Review the automation limits and try again." };
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
    automationNotice.value = { tone: enabled ? "success" : "warning", title: enabled ? "Playbook resumed" : "Playbook paused", detail: enabled ? "The next due run may observe and prepare work." : "This playbook will not run until you resume it." };
  } catch (cause) {
    automationNotice.value = { tone: "danger", title: "Playbook could not be updated", detail: cause instanceof Error ? cause.message : "Try again." };
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
    automationNotice.value = { tone: "success", title: "Capability contract registered", detail: `${result.adapter.name} is visible to the host policy. Setup remains explicit; registration did not grant credentials or execute an action.` };
  } catch (cause) {
    automationNotice.value = { tone: "danger", title: "Adapter was not registered", detail: cause instanceof Error ? cause.message : "Review its capability contract and try again." };
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
      : { tone: "success", title: "Connection verified", detail: `${result.adapter.name} exposed ${result.adapter.connection.tools.length} bounded tool${result.adapter.connection.tools.length === 1 ? "" : "s"}. Only those discovered capabilities can be requested.` };
  } catch (cause) {
    state.value = await loadDashboard();
    automationNotice.value = { tone: "danger", title: "Connection was not activated", detail: cause instanceof Error ? cause.message : "Discovery failed. The adapter remains in setup and cannot execute." };
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
      ? { tone: "warning", title: "Stopped for human approval", detail: "The policy decision and bounded argument keys were recorded. Nothing has been sent yet." }
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
    automationNotice.value = { tone: result.adapter.state === "disabled" ? "warning" : "success", title: result.adapter.state === "disabled" ? "Adapter disabled" : "Adapter returned to setup", detail: "The host policy updated immediately. No credential or external state was changed." };
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
    const product = state.value?.products[0];
    const decision = await previewActionPolicy({ adapterId: adapter.id, capability, productId: product?.id, evidenceRefs: product ? [product.id] : ["preview"], purpose: `Preview the ${adapter.name} boundary.`, budgetLimit: 1 });
    automationNotice.value = {
      tone: decision.status === "blocked" ? "danger" : decision.status === "approval-required" ? "warning" : "success",
      title: decision.status === "allowed" ? "Policy allows this bounded action" : decision.status === "approval-required" ? "Human approval required" : "Policy blocks this action",
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
    signalForm.productId = result.productId;
    automationForm.productId = result.productId;
    selectedId.value = state.value.opportunities.find((item) => item.productId === result.productId)?.id ?? "";
    view.value = "memory";
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "The product could not be onboarded.";
  } finally {
    onboardingBusy.value = false;
  }
}

async function captureSignal(): Promise<void> {
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
    const result = await captureProductSignals(signalForm.productId, [source]);
    state.value = result.dashboard;
    signalForm.label = "";
    signalForm.value = "";
    signalNotice.value = result.insertedCount
      ? { tone: "success", title: "Signal captured for review", detail: "It remains outside product evidence until you inspect and accept it. Nothing has been promoted into a trend or demand claim." }
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
      ? { tone: "success", title: "Signal accepted as evidence", detail: "The bounded observation can now support a plan, but it remains labeled as audience evidence—not verified demand." }
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
    connectorNotice.value = { tone: "danger", title: "Repository required", detail: "Choose a product and enter a GitHub repository URL or owner/repository." };
    return;
  }
  connectorBusyId.value = "new";
  try {
    const result = await connectGitHubSource(connectorForm.productId, connectorForm.repository.trim());
    state.value = result.dashboard;
    connectorNotice.value = result.importedCount
      ? { tone: "success", title: "GitHub source connected", detail: `${result.importedCount} new issue signal${result.importedCount === 1 ? "" : "s"} entered the review inbox. Nothing became evidence automatically.` }
      : { tone: "warning", title: "GitHub source connected", detail: `Distribution-OS inspected ${result.inspectedCount} issue${result.inspectedCount === 1 ? "" : "s"}; all were already represented or no issues were available.` };
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
    connectorNotice.value = { tone: "success", title: "Source disconnected", detail: "Previously imported candidates, accepted evidence, and decisions were preserved." };
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
  { id: "command", label: "Command Center", icon: "dashboard", section: "OPERATE" },
  { id: "automation", label: "Automation", icon: "refresh" },
  { id: "onboarding", label: "Add Product", icon: "plus", section: "UNDERSTAND" },
  { id: "memory", label: "Product Memory", icon: "boxes" },
  { id: "signals", label: "Signal Inbox", icon: "inbox" },
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
      inspector-width="410px"
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
            <b v-else-if="item.id === 'signals' && state && state.metrics.newSignals">{{ state.metrics.newSignals }}</b>
            <b v-else-if="item.id === 'campaigns' && approved.length">{{ approved.length }}</b>
          </button>
        </template>
        <section class="privacy-card">
          <osx-icon name="lock" :size="18"></osx-icon>
          <div><strong>Private by default</strong><span>The ledger stays local. Configured AI providers receive only bounded run evidence.</span></div>
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
          <article><span>Signal sources</span><strong>{{ state.metrics.connectedSources }}</strong><small>Read-only · human reviewed</small></article>
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

      <main v-else-if="state && view === 'automation'" class="workspace-page automation-page">
        <header class="page-header-with-action">
          <div><p class="eyebrow">AUTOMATION KERNEL</p><h1>Automate the practice, not your identity.</h1><p>Scheduled loops may observe bounded sources, prepare evidence-cited work, and learn from outcomes. Every public action stops for human judgment.</p></div>
          <osx-button :variant="state.automation.control.paused ? 'primary' : 'secondary'" :icon="state.automation.control.paused ? 'play' : 'pause'" :loading="automationBusyId === 'control'" @click="toggleAutomationControl">{{ state.automation.control.paused ? "Resume automation" : "Pause automation" }}</osx-button>
        </header>

        <osx-alert v-if="automationNotice" :tone="automationNotice.tone" :title="automationNotice.title" dismissible @dismiss="automationNotice = null">{{ automationNotice.detail }}</osx-alert>
        <osx-alert :tone="state.automation.control.paused ? 'warning' : 'info'" :title="state.automation.control.paused ? 'All automated loops are paused' : 'Human approval is a hard boundary'">
          {{ state.automation.control.paused ? "No scheduled source sync, plan, or draft preparation will begin until you resume it." : "Automation can create private drafts and review-queue items. Scheduled public execution is disabled; every identity-bearing connection call still stops for one-time human approval." }}
        </osx-alert>

        <section class="automation-metrics" aria-label="Automation status">
          <article><span>Active loops</span><strong>{{ state.automation.playbooks.filter((item) => item.enabled).length }}</strong><small>{{ state.automation.playbooks.length }} configured</small></article>
          <article><span>Awaiting judgment</span><strong>{{ state.automation.runs.filter((item) => item.status === 'waiting-approval').length }}</strong><small>Prepared, never published</small></article>
          <article><span>Scheduled public execution</span><strong>OFF</strong><small>One-time approval only</small></article>
          <article><span>Action budget</span><strong>{{ state.automation.playbooks.reduce((sum, item) => sum + (item.enabled ? item.maxActionsPerRun : 0), 0) }}</strong><small>Maximum prepared per cycle</small></article>
        </section>

        <section v-if="state.products.length" class="automation-create-panel">
          <div class="section-heading"><div><p class="eyebrow">NEW EVIDENCE LOOP</p><h2>Create a bounded operating rhythm</h2><p>Each cycle refreshes read-only sources, generates a small plan, prepares cited drafts, and stops at approval. Empty cycles are valid; the system will not manufacture activity.</p></div><osx-badge tone="success" dot>Local scheduler</osx-badge></div>
          <form class="automation-form" @submit.prevent="createPlaybook">
            <label>Product<select v-model="automationForm.productId"><option v-for="product in state.products" :key="product.id" :value="product.id">{{ product.name }}</option></select></label>
            <label>Loop name <small>Optional</small><input v-model="automationForm.name" maxlength="120" placeholder="Weekly evidence-to-contribution loop" /></label>
            <label>Run cadence<select v-model.number="automationForm.intervalMinutes"><option :value="60">Every hour</option><option :value="360">Every 6 hours</option><option :value="720">Every 12 hours</option><option :value="1440">Daily</option><option :value="4320">Every 3 days</option><option :value="10080">Weekly</option></select></label>
            <label>Preparation budget<select v-model.number="automationForm.maxActionsPerRun"><option :value="1">1 move per run</option><option :value="2">2 moves per run</option><option :value="3">3 moves per run</option></select></label>
            <footer><span><osx-icon name="lock" :size="15"></osx-icon> Approval is always required. This cannot be disabled.</span><osx-button type="button" variant="primary" icon="plus" :loading="automationBusyId === 'new'" :disabled="Boolean(automationBusyId)" @click="createPlaybook">Create evidence loop</osx-button></footer>
          </form>
        </section>
        <osx-empty-state v-else class="page-empty-state" icon="refresh" title="Automation needs product truth first">Onboard a product before scheduling decisions. The kernel refuses to automate without bounded evidence and an explicit objective.<osx-button slot="actions" variant="primary" icon="plus" @click="view = 'onboarding'">Onboard a product</osx-button></osx-empty-state>

        <section v-if="state.automation.playbooks.length" class="automation-section">
          <div class="section-heading"><div><p class="eyebrow">PLAYBOOKS</p><h2>Governed loops</h2><p>Schedules survive service restarts through the local ledger. A duplicate trigger cannot create a duplicate run.</p></div><osx-badge>{{ state.automation.playbooks.length }} configured</osx-badge></div>
          <div class="playbook-grid">
            <article v-for="playbook in state.automation.playbooks" :key="playbook.id" :class="['playbook-card', { paused: !playbook.enabled }]">
              <header><span class="playbook-icon"><osx-icon name="refresh" :size="20"></osx-icon></span><div><h3>{{ playbook.name }}</h3><small>{{ playbook.productName }}</small></div><osx-badge :tone="playbook.enabled ? 'success' : 'warning'" dot>{{ playbook.enabled ? "Active" : "Paused" }}</osx-badge></header>
              <dl><div><dt>Cadence</dt><dd>{{ playbook.intervalMinutes >= 1440 ? `${playbook.intervalMinutes / 1440} day${playbook.intervalMinutes === 1440 ? '' : 's'}` : `${playbook.intervalMinutes / 60} hour${playbook.intervalMinutes === 60 ? '' : 's'}` }}</dd></div><div><dt>Budget</dt><dd>{{ playbook.maxActionsPerRun }} move{{ playbook.maxActionsPerRun === 1 ? "" : "s" }}</dd></div><div><dt>Approval</dt><dd>Always</dd></div></dl>
              <p>{{ playbook.lastRunAt ? `Last run ${formatDate(playbook.lastRunAt)} at ${formatTime(playbook.lastRunAt)}` : "Not run yet" }}<br />{{ playbook.enabled ? `Next due ${formatDate(playbook.nextRunAt)} at ${formatTime(playbook.nextRunAt)}` : "Schedule is paused" }}</p>
              <footer><osx-button size="small" :disabled="Boolean(automationBusyId)" @click="togglePlaybook(playbook.id, !playbook.enabled, playbook.intervalMinutes, playbook.maxActionsPerRun)">{{ playbook.enabled ? "Pause" : "Resume" }}</osx-button><osx-button size="small" variant="primary" icon="play" :loading="automationBusyId === playbook.id" :disabled="Boolean(automationBusyId) || !playbook.enabled || state.automation.control.paused" @click="runPlaybook(playbook.id)">Run now</osx-button></footer>
            </article>
          </div>
        </section>

        <section class="automation-section">
          <div class="section-heading">
            <div><p class="eyebrow">ACTION FABRIC</p><h2>One trustworthy capability layer</h2><p>Direct APIs, MCP servers, local CLIs, managed gateways, and human handoffs share the same contract. The host—not the adapter—owns permissions and approval.</p></div>
            <div class="section-heading-actions"><osx-badge>{{ state.automation.adapters.length }} adapters</osx-badge><osx-button size="small" icon="plus" @click="actionAdapterOpen = !actionAdapterOpen">{{ actionAdapterOpen ? "Close" : "Add capability" }}</osx-button></div>
          </div>
          <form v-if="actionAdapterOpen" class="action-adapter-form" @submit.prevent="saveActionAdapter">
            <header><div><strong>Register a capability contract</strong><p>This stores no token and executes nothing. Credentials stay in environment or secure storage when a transport is activated.</p></div><osx-badge tone="success" dot>Local manifest</osx-badge></header>
            <div class="adapter-transport-picker" role="radiogroup" aria-label="Adapter transport">
              <button v-for="transport in state.automation.actionFabric.transports.filter((item) => item.id !== 'direct-api')" :key="transport.id" type="button" :class="{ active: actionAdapterForm.transport === transport.id }" @click="setAdapterTransport(transport.id as Exclude<ActionTransport, 'direct-api'>)"><strong>{{ transport.name }}</strong><small>{{ transport.description }}</small></button>
            </div>
            <div class="action-adapter-fields">
              <label>Adapter name<input v-model="actionAdapterForm.name" required maxlength="80" placeholder="Founder research MCP" /></label>
              <template v-if="actionAdapterForm.transport === 'mcp'"><label>MCP HTTP endpoint<input v-model="actionAdapterForm.endpoint" required inputmode="url" placeholder="http://127.0.0.1:3001/mcp" /></label><label>Bearer-token environment variable <small>Optional; value is never stored</small><input v-model="actionAdapterForm.credentialEnv" autocomplete="off" placeholder="RESEARCH_MCP_TOKEN" /></label></template>
              <label v-else-if="actionAdapterForm.transport === 'cli'">Allowed executable<select v-model="actionAdapterForm.command"><option value="gh">GitHub CLI · bounded read operations</option></select><small>Claude Code, Cursor, OpenCode, and Codex are agent runtimes configured in AI Harness—not distribution transports.</small></label>
              <template v-else-if="actionAdapterForm.transport === 'managed-gateway'"><label>Gateway<select v-model="actionAdapterForm.gateway"><option value="composio">Composio over MCP</option></select></label><label>MCP endpoint<input v-model="actionAdapterForm.endpoint" required inputmode="url" placeholder="https://your-gateway.example/mcp" /></label><label>Connection reference <small>Optional label, never a token</small><input v-model="actionAdapterForm.connectionRef" placeholder="founder-social" /></label><label>Bearer-token environment variable <small>Optional; read only by the local service</small><input v-model="actionAdapterForm.credentialEnv" autocomplete="off" placeholder="COMPOSIO_MCP_TOKEN" /></label></template>
              <label v-else>Execution owner<input value="Human handoff" disabled /></label>
            </div>
            <fieldset><legend>Declared capabilities</legend><label v-for="capability in actionCapabilityOptions" :key="capability"><input type="checkbox" :checked="actionAdapterForm.capabilities.includes(capability)" @change="toggleAdapterCapability(capability)" />{{ capability }}</label></fieldset>
            <footer><span><osx-icon name="shield" :size="16"></osx-icon> Execute always becomes identity-bearing and requires approval.</span><osx-button variant="primary" icon="plus" :loading="actionAdapterBusyId === 'new-adapter'" @click="saveActionAdapter">Register adapter</osx-button></footer>
          </form>
          <div class="fabric-policy-strip"><span v-for="value in state.automation.actionFabric.ethos" :key="value"><osx-icon name="check" :size="14"></osx-icon>{{ value }}</span></div>
          <div class="adapter-list">
            <article v-for="adapter in state.automation.adapters" :key="adapter.id">
              <span class="adapter-icon"><osx-icon :name="adapter.publicSideEffect ? 'send' : adapter.transport === 'mcp' ? 'boxes' : adapter.transport === 'cli' ? 'terminal' : adapter.id === 'github-observer' ? 'git-branch' : 'sparkle'" :size="19"></osx-icon></span>
              <div><strong>{{ adapter.name }}</strong><p>{{ adapter.description }}</p><small>{{ adapter.transport.replace('-', ' ') }} · {{ adapter.capabilities.join(' · ') }}</small><span class="adapter-contract">{{ adapter.risk.replace('-', ' ') }} · {{ adapter.approval.replace('-', ' ') }} approval · {{ adapter.configSummary }}</span><span v-if="adapter.connection.lastCheckedAt" class="adapter-checked">Checked {{ formatDate(adapter.connection.lastCheckedAt) }} at {{ formatTime(adapter.connection.lastCheckedAt) }} · {{ adapter.connection.credentialSource.replace('-', ' ') }} credentials</span><span v-if="adapter.connection.lastError" class="adapter-error">{{ adapter.connection.lastError }}</span><div v-if="adapter.connection.tools.length" class="adapter-tools"><button v-for="tool in adapter.connection.tools" :key="tool.name" type="button" :title="adapter.origin === 'core' && adapter.id !== 'human-handoff' ? `${tool.description} Use its purpose-built workspace.` : tool.description" :disabled="adapter.origin === 'core' && adapter.id !== 'human-handoff'" @click="openActionInvocation(adapter, tool)"><osx-icon :name="tool.publicSideEffect ? 'send' : 'boxes'" :size="13"></osx-icon>{{ tool.name }}<small>{{ tool.capabilities.join(' · ') }}</small></button></div></div>
              <aside><osx-badge :tone="adapter.state === 'available' ? 'success' : adapter.state === 'disabled' ? 'warning' : 'neutral'" dot>{{ adapter.state === 'available' ? (adapter.transport === 'manual' ? 'handoff ready' : adapter.origin === 'core' ? 'ready' : 'verified') : adapter.state }}</osx-badge><osx-button v-if="adapter.origin === 'user' && adapter.state !== 'disabled'" size="small" icon="refresh" :loading="actionAdapterBusyId === adapter.id" @click="probeAdapter(adapter)">{{ adapter.transport === "manual" ? (adapter.connection.lastCheckedAt ? "Reconfirm handoff" : "Confirm handoff") : (adapter.connection.lastCheckedAt ? "Recheck" : "Test connection") }}</osx-button><osx-button size="small" :disabled="adapter.state !== 'available'" @click="inspectActionBoundary(adapter)">Inspect policy</osx-button><osx-button v-if="adapter.origin === 'user'" size="small" @click="toggleActionAdapter(adapter)">{{ adapter.state === "disabled" ? "Enable" : "Disable" }}</osx-button></aside>
            </article>
          </div>
          <form v-if="actionInvocationOpen" class="action-invocation-form" @submit.prevent="runActionInvocation">
            <header><div><p class="eyebrow">BOUNDED ACTION REQUEST</p><h3>{{ actionInvocation.adapterName }} · {{ actionInvocation.toolName }}</h3><p>Distribution OS will evaluate policy before transport execution. Identity-bearing work is recorded as approval-required and stops before the connection is called.</p></div><osx-button size="small" icon="close" aria-label="Close action request" @click="actionInvocationOpen = false">Close</osx-button></header>
            <div class="action-invocation-fields"><label>Capability<select v-model="actionInvocation.capability"><option v-for="capability in state.automation.adapters.find((item) => item.id === actionInvocation.adapterId)?.connection.tools.find((item) => item.name === actionInvocation.toolName)?.capabilities || []" :key="capability" :value="capability">{{ capability }}</option></select></label><label>Purpose<input v-model="actionInvocation.purpose" required maxlength="500" placeholder="Learn which documented pain points recur in this repository" /></label><label>Evidence references <small>Comma-separated local record IDs</small><input v-model="actionInvocation.evidenceRefs" placeholder="evidence-id, signal-id" /></label><label>Arguments JSON<textarea v-model="actionInvocation.argumentsJson" rows="6" spellcheck="false"></textarea></label></div>
            <footer><span><osx-icon name="shield" :size="15"></osx-icon> Credential-like argument keys are rejected before persistence.</span><osx-button variant="primary" icon="play" :loading="actionAdapterBusyId === 'action-request'" @click="runActionInvocation">Evaluate and continue</osx-button></footer>
          </form>

          <div class="connection-ledger-heading"><div><strong>Connection ledger</strong><p>Every request records policy, a sanitized payload preview, approval time, and confirmed result. A missing result is a failure—not success.</p></div><osx-badge>{{ state.automation.actionFabric.executions.length }} recent</osx-badge></div>
          <div v-if="state.automation.actionFabric.executions.length" class="connection-ledger">
            <article v-for="record in state.automation.actionFabric.executions" :key="record.id">
              <header><div><strong>{{ record.adapterName }} · {{ record.toolName }}</strong><small>{{ record.capability }} · {{ formatDate(record.createdAt) }} at {{ formatTime(record.createdAt) }}</small></div><osx-badge :tone="record.status === 'completed' ? 'success' : record.status === 'failed' || record.status === 'blocked' ? 'danger' : 'warning'" dot>{{ record.status.replace('-', ' ') }}</osx-badge></header>
              <p>{{ record.summary || record.error || record.decision.reasons.join(' ') }}</p><small>Purpose: {{ record.purpose }} · Evidence: {{ record.evidenceRefs.join(', ') || 'none' }}<template v-if="record.approvedAt"> · Approved {{ formatDate(record.approvedAt) }} at {{ formatTime(record.approvedAt) }}</template></small>
              <details class="action-payload-preview" :open="record.status === 'approval-required'"><summary>Review sanitized action payload</summary><pre>{{ record.argumentPreview }}</pre></details>
              <footer v-if="record.status === 'approval-required'"><span><osx-icon name="lock" :size="14"></osx-icon>Review the exact sanitized payload and evidence before allowing one connection call.</span><osx-button variant="primary" size="small" icon="check" :loading="actionAdapterBusyId === record.id" @click="approveAction(record)">Approve and run once</osx-button></footer>
              <footer v-else-if="record.externalUrl"><span>Confirmed external result</span><osx-link :href="record.externalUrl" external>Open result</osx-link></footer>
            </article>
          </div>
          <osx-empty-state v-else icon="boxes" title="No connection actions yet">Verify an adapter, choose one of its discovered tools, and submit a bounded request. Setup alone never creates external activity.</osx-empty-state>
        </section>

        <section class="automation-section">
          <div class="section-heading"><div><p class="eyebrow">EXECUTION LEDGER</p><h2>Every cycle is inspectable</h2><p>Triggers, steps, failures, prepared moves, and approval waits are durable. Raw prompts, credentials, and hidden reasoning are not stored.</p></div><osx-badge>{{ state.automation.runs.length }} recent</osx-badge></div>
          <div v-if="state.automation.runs.length" class="automation-run-list">
            <article v-for="run in state.automation.runs" :key="run.id">
              <header><div><strong>{{ run.playbookName }}</strong><small>{{ run.productName }} · {{ run.trigger }} · {{ formatDate(run.createdAt) }} at {{ formatTime(run.createdAt) }}</small></div><osx-badge :tone="run.status === 'waiting-approval' || run.status === 'completed' ? 'success' : run.status === 'failed' ? 'danger' : 'warning'" dot>{{ run.status.replace('-', ' ') }}</osx-badge></header>
              <p>{{ run.summary || run.error || "Run in progress" }}</p>
              <ol><li v-for="step in run.steps" :key="step.id"><span :class="['run-step-dot', step.status]"></span><div><strong>{{ step.name }}</strong><small>{{ step.detail }}</small></div></li></ol>
              <footer v-if="run.createdOpportunityIds.length"><osx-button size="small" icon="inbox" @click="reviewAutomationRun(run)">Review prepared work</osx-button></footer>
            </article>
          </div>
          <osx-empty-state v-else icon="activity" title="No automation cycles yet">Create an evidence loop, then run it once manually. Scheduled execution begins only after you choose a cadence and the global control remains active.</osx-empty-state>
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

      <main v-else-if="state && view === 'signals'" class="workspace-page">
        <header class="page-header-with-action">
          <div><p class="eyebrow">SIGNAL INBOX</p><h1>Observe first. Infer carefully.</h1><p>Potential audience evidence stays quarantined until you inspect it. Accepting a signal makes the bounded observation citable; it never turns one comment into a trend.</p></div>
          <osx-badge :tone="newSignals.length ? 'warning' : 'success'" dot>{{ newSignals.length }} awaiting review</osx-badge>
        </header>

        <section v-if="state.products.length" class="audience-signal-panel signal-capture-panel">
          <div class="section-heading"><div><p class="eyebrow">READ-ONLY SOURCE</p><h2>Connect GitHub issues</h2><p>Import recent repository issues as candidates. Pull requests are excluded, duplicate issues are ignored, and every observation still requires your review.</p></div><osx-badge :tone="state.connectors.length ? 'success' : 'info'" dot>{{ state.connectors.length }} connected</osx-badge></div>
          <form class="connector-form" @submit.prevent="connectGitHub">
            <label>Product<select :value="connectorForm.productId" @change="selectConnectorProduct(($event.target as HTMLSelectElement).value)"><option v-for="product in state.products" :key="product.id" :value="product.id">{{ product.name }}</option></select></label>
            <label>GitHub repository <small>Public repos work without a token</small><input v-model="connectorForm.repository" inputmode="url" placeholder="owner/repository or https://github.com/…" /></label>
            <osx-button type="button" variant="primary" icon="git-branch" :loading="connectorBusyId === 'new'" :disabled="Boolean(connectorBusyId) || !connectorForm.repository.trim()" @click="connectGitHub">Connect & import</osx-button>
          </form>
          <div v-if="state.connectors.length" class="connector-list">
            <article v-for="connector in state.connectors" :key="connector.id">
              <span class="connector-mark"><osx-icon name="git-branch" :size="20"></osx-icon></span>
              <div><strong>{{ connector.name }}</strong><small>{{ connector.productName }} · {{ connector.lastSyncedAt ? `synced ${formatDate(connector.lastSyncedAt)} at ${formatTime(connector.lastSyncedAt)}` : 'not synced' }} · {{ connector.importedCount }} imported</small><p v-if="connector.lastError">{{ connector.lastError }}</p></div>
              <osx-badge :tone="connector.status === 'connected' ? 'success' : 'danger'" dot>{{ connector.status }}</osx-badge>
              <span class="connector-actions"><osx-button size="small" icon="refresh" :loading="connectorBusyId === connector.id" :disabled="Boolean(connectorBusyId)" @click="syncConnector(connector.id)">Sync</osx-button><osx-button size="small" :disabled="Boolean(connectorBusyId)" @click="disconnectConnector(connector.id)">Disconnect</osx-button></span>
            </article>
          </div>
          <osx-alert v-if="connectorNotice" :tone="connectorNotice.tone" :title="connectorNotice.title" dismissible @dismiss="connectorNotice = null">{{ connectorNotice.detail }}</osx-alert>
        </section>

        <section v-if="state.products.length" class="audience-signal-panel signal-capture-panel">
          <div class="section-heading"><div><p class="eyebrow">MANUAL CAPTURE</p><h2>Add a bounded observation</h2><p>Paste only the relevant public discussion context or import its URL when no connector exists.</p></div><osx-badge tone="info">Manual source</osx-badge></div>
          <form class="signal-form" @submit.prevent="captureSignal">
            <label>Product<select v-model="signalForm.productId"><option v-for="product in state.products" :key="product.id" :value="product.id">{{ product.name }}</option></select></label>
            <label>Source type<select v-model="signalForm.type"><option value="text">Paste discussion context</option><option value="url">Public URL</option></select></label>
            <label>Source label <small>Make citations recognizable</small><input v-model="signalForm.label" placeholder="Example: Hacker News launch discussion" /></label>
            <label class="wide">{{ signalForm.type === 'url' ? 'Public discussion URL' : 'What did the audience say or ask?' }}
              <input v-if="signalForm.type === 'url'" v-model="signalForm.value" type="url" placeholder="https://…" />
              <textarea v-else v-model="signalForm.value" rows="5" placeholder="Paste only the relevant public excerpt or your own bounded observation. Preserve uncertainty and context."></textarea>
            </label>
            <footer><span>Capture does not approve evidence, contact anyone, or publish anything.</span><osx-button type="button" variant="primary" icon="plus" :loading="signalBusy" :disabled="!signalForm.value.trim()" @click="captureSignal">Capture signal</osx-button></footer>
          </form>
          <osx-alert v-if="signalNotice" :tone="signalNotice.tone" :title="signalNotice.title" dismissible @dismiss="signalNotice = null">{{ signalNotice.detail }}</osx-alert>
        </section>

        <osx-empty-state v-else class="page-empty-state" icon="inbox" title="Add a product before collecting signals">Signals need a product, audience hypothesis, and objective so their relevance can be judged.<osx-button slot="actions" variant="primary" icon="plus" @click="view = 'onboarding'">Onboard a product</osx-button></osx-empty-state>

        <section v-if="state.products.length" class="signal-inbox-section">
          <div class="section-heading"><div><p class="eyebrow">REVIEW QUEUE</p><h2>Is this useful evidence?</h2><p>Accept only observations specific enough to change a distribution decision.</p></div><osx-badge>{{ newSignals.length }} new</osx-badge></div>
          <div v-if="newSignals.length" class="signal-inbox-list">
            <article v-for="signal in newSignals" :key="signal.id" class="signal-candidate-card">
              <span class="signal-icon"><osx-icon :name="signal.kind === 'question' ? 'help-circle' : signal.kind === 'pain' ? 'alert-circle' : signal.kind === 'request' ? 'message-circle' : 'search'" :size="19"></osx-icon></span>
              <div class="signal-candidate-copy"><div><osx-badge tone="info" size="small">{{ signal.kind }}</osx-badge><osx-badge v-if="signal.origin === 'github'" size="small">GitHub</osx-badge><span>{{ signal.productName }} · {{ formatDate(signal.capturedAt) }}</span></div><h3>{{ signal.title }}</h3><p>{{ signal.summary }}</p><small>{{ signal.reason }}</small></div>
              <div class="signal-relevance"><strong>{{ signal.relevance }}</strong><span>RELEVANCE</span></div>
              <footer><osx-link v-if="signal.sourceUrl" :href="signal.sourceUrl" external>Inspect source</osx-link><span v-else>Founder-supplied excerpt</span><div><osx-button size="small" :disabled="Boolean(signalActionId)" @click="reviewSignal(signal.id, 'dismiss')">Dismiss</osx-button><osx-button size="small" variant="primary" icon="check" :loading="signalActionId === signal.id" :disabled="Boolean(signalActionId)" @click="reviewSignal(signal.id, 'accept')">Accept as evidence</osx-button></div></footer>
            </article>
          </div>
          <osx-empty-state v-else icon="check" title="Signal inbox reviewed">There are no unreviewed observations. Accepted evidence appears in Audience Map and becomes available to the next planning run.</osx-empty-state>
        </section>

        <section v-if="reviewedSignals.length" class="reviewed-signals-section">
          <div class="section-heading"><div><p class="eyebrow">REVIEWED</p><h2>Decision history</h2></div><osx-badge>{{ reviewedSignals.length }} decisions</osx-badge></div>
          <div class="reviewed-signal-list"><article v-for="signal in reviewedSignals" :key="signal.id"><div><strong>{{ signal.title }}</strong><small>{{ signal.productName }} · {{ formatDate(signal.decidedAt || signal.capturedAt) }}</small></div><osx-badge :tone="signal.status === 'accepted' ? 'success' : 'neutral'" dot>{{ signal.status }}</osx-badge><osx-button v-if="signal.status === 'dismissed'" size="small" :loading="signalActionId === signal.id" @click="reviewSignal(signal.id, 'restore')">Restore</osx-button></article></div>
        </section>
      </main>

      <main v-else-if="state && view === 'audience'" class="workspace-page">
        <header><p class="eyebrow">AUDIENCE MAP</p><h1>Problems, people, and places.</h1><p>The system optimizes for relevance—not reach without context.</p></header>
        <div v-if="state.products.length" class="audience-grid">
          <article v-for="product in state.products" :key="product.id"><osx-icon name="user" :size="24"></osx-icon><h2>{{ product.audience }}</h2><p>{{ product.name }} is currently optimizing for: {{ product.objective }}</p><div><osx-badge>{{ product.stage }}</osx-badge><osx-badge tone="info">{{ product.confidence }}% evidence</osx-badge></div></article>
        </div>
        <osx-empty-state v-else class="page-empty-state" icon="user" title="No audience has been established">Audience hypotheses appear only after a product has been onboarded and reviewed.<osx-button slot="actions" variant="primary" icon="plus" @click="view = 'onboarding'">Onboard a product</osx-button></osx-empty-state>
        <section v-if="state.products.length" class="audience-signal-panel">
          <div class="section-heading"><div><p class="eyebrow">ACCEPTED AUDIENCE EVIDENCE</p><h2>Observations allowed into the loop.</h2><p>These signals passed human review. They remain bounded observations and are never represented as verified demand or a representative trend.</p></div><span class="heading-actions"><osx-badge tone="info">{{ state.audienceSignals?.length || 0 }} accepted</osx-badge><osx-button size="small" icon="inbox" @click="view = 'signals'">Open Signal Inbox</osx-button></span></div>
          <div v-if="state.audienceSignals?.length" class="signal-list">
            <article v-for="signal in state.audienceSignals" :key="signal.id"><span class="signal-icon"><osx-icon :name="signal.sourceType === 'url' ? 'globe' : 'message-circle'" :size="18"></osx-icon></span><div><strong>{{ signal.title }}</strong><p>{{ signal.summary }}</p><small>{{ signal.productName }} · {{ formatDate(signal.occurredAt) }} · {{ signal.sourceUrl ? 'public source' : 'founder supplied' }}</small></div><osx-link v-if="signal.sourceUrl" :href="signal.sourceUrl" external>Open source</osx-link></article>
          </div>
          <osx-empty-state v-else icon="message-circle" title="No accepted audience evidence yet">Product evidence explains what you built. Audience evidence explains what people are discussing. Capture and review one real observation before asking the agent to infer where to contribute.<osx-button slot="actions" variant="primary" icon="inbox" @click="view = 'signals'">Open Signal Inbox</osx-button></osx-empty-state>
        </section>
      </main>

      <main v-else-if="state && view === 'campaigns'" class="workspace-page">
        <header><p class="eyebrow">CAMPAIGNS</p><h1>Approved work awaiting execution.</h1><p>These contributions passed review. Execute them manually, then record what actually happened so the next plan can learn.</p></header>
        <section class="data-panel">
          <div v-for="opportunity in approved" :key="opportunity.id" class="campaign-row">
            <span class="status-orb"></span><div><strong>{{ opportunity.title }}</strong><small>{{ opportunity.productName }} · {{ opportunity.channelName }}</small></div><osx-badge tone="success">Approved</osx-badge><span class="campaign-actions"><osx-button size="small" @click="decide('restore', opportunity)">Return to queue</osx-button><osx-button size="small" variant="primary" icon="activity" @click="outcomeOpportunityId = opportunity.id">Record outcome</osx-button></span>
          </div>
          <form v-if="outcomeOpportunityId" class="outcome-form" @submit.prevent="saveOutcome">
            <div><p class="eyebrow">CLOSE THE LOOP</p><h2>What happened after the approved move?</h2><p>Measured outcomes become evidence for the next planning run.</p></div>
            <label>Metric<select v-model="outcomeForm.metric"><option value="qualified-visits">Qualified visits</option><option value="replies">Replies</option><option value="conversations">Conversations</option><option value="signups">Signups</option><option value="stars">Stars</option><option value="revenue">Revenue</option></select></label>
            <label>Value<input v-model.number="outcomeForm.value" type="number" min="0" step="any" /></label>
            <label class="wide">What did you learn?<textarea v-model="outcomeForm.note" rows="3" placeholder="Optional context that should influence the next plan"></textarea></label>
            <footer><osx-button size="small" @click="outcomeOpportunityId = ''">Cancel</osx-button><osx-button type="button" variant="primary" icon="check" :loading="actionBusy" @click="saveOutcome">Record & learn</osx-button></footer>
          </form>
          <osx-empty-state v-if="!approved.length" icon="send" title="Nothing approved for execution">Review a move in the Command Center. Approved work appears here; Distribution-OS does not publish it automatically.</osx-empty-state>
        </section>
      </main>

      <main v-else-if="state && view === 'channels'" class="workspace-page">
        <header><p class="eyebrow">CHANNEL POLICY</p><h1>Decide how work reaches each channel.</h1><p>Set planning limits and whether a channel produces drafts or requires approval. Publishing connections are not enabled yet.</p></header>
        <section class="channel-grid">
          <article v-for="channel in state.channels" :key="channel.id" class="channel-card">
            <header><span class="channel-mark">{{ channel.name.charAt(0) }}</span><div><h2>{{ channel.name }}</h2><p>{{ channel.handle }}</p></div><osx-badge :tone="channel.connected ? 'success' : channel.status === 'manual' ? 'warning' : 'neutral'" dot>{{ channel.status }}</osx-badge></header>
            <dl><div><dt>Execution mode</dt><dd>{{ channel.mode }}</dd></div><div><dt>Daily limit</dt><dd>{{ channel.dailyLimit }}</dd></div><div><dt>Reply automation</dt><dd>Approval required</dd></div></dl>
            <form v-if="channelEditingId === channel.id" class="channel-policy-form" @submit.prevent="saveChannel(channel)">
              <label>Review mode<select v-model="channelForm.mode"><option value="draft">Draft only</option><option value="approval">Human approval</option></select></label>
              <label>Daily limit<input v-model.number="channelForm.dailyLimit" type="number" min="0" max="100" step="1" /></label>
              <small>This governs planning and review only. Distribution-OS does not currently publish to this channel.</small>
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
        <header><p class="eyebrow">SYSTEM</p><h1>Local control plane.</h1><p>Product evidence, signal decisions, drafts, and approval history remain in your local ledger.</p></header>
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
            <div><span><h3>Channel draft</h3><small>Strategy becomes publishable copy here.</small></span><osx-badge size="small">Editable</osx-badge></div>
            <osx-alert v-if="draftNotice" :tone="draftNotice.tone" :title="draftNotice.title" dismissible @dismiss="draftNotice = null">{{ draftNotice.detail }}</osx-alert>
            <textarea v-model="draft" aria-label="Proposed contribution draft"></textarea>
            <footer><span>Uses the opportunity, channel, and cited evidence. Nothing is published.</span><osx-button size="small" icon="sparkle" :loading="draftBusy" :disabled="actionBusy" @click="writeDraft">Write channel draft</osx-button></footer>
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
