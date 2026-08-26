export type ChannelMode = "draft" | "approval" | "autopilot";
export const PRODUCT_STAGES = ["idea", "prototype", "early", "public-beta", "launched"] as const;
export type ProductStage = typeof PRODUCT_STAGES[number];
export function isProductStage(value: string): value is ProductStage {
  return (PRODUCT_STAGES as readonly string[]).includes(value);
}
export type OpportunityStatus = "ready" | "approved" | "skipped" | "published";
export type OnboardingSourceType = "text" | "url" | "document" | "repository";
export type EvidenceClassification = "intent" | "public-claim" | "implementation" | "audience-signal" | "outcome";
export type ModelProviderId = "openai" | "anthropic" | "google" | "deepseek" | "openrouter" | "groq" | "ollama" | "openai-compatible";
export type AgentRuntimeId = "native" | "claude-code" | "cursor" | "opencode" | "codex";
export type RuntimeAvailability = "available" | "setup-required" | "missing";
export type RuntimeVerification = "not-applicable" | "unverified" | "ready" | "failed";
export type RuntimeFailureCode = "authentication-required" | "timeout" | "invocation-failed" | "empty-response" | "invalid-json" | "schema-invalid";
export type AnalysisMode = "local" | "ai" | "fallback";
export type HarnessRunKind = "onboarding" | "distribution-plan" | "contribution-draft" | "runtime-task";
export type HarnessRunStatus = "running" | "completed" | "failed" | "fallback";
export type HarnessStepStatus = "pending" | "running" | "completed" | "failed" | "skipped";
export type SignalStatus = "new" | "accepted" | "dismissed";
export type SignalKind = "question" | "pain" | "request" | "mention" | "unknown";
export type SignalOrigin = "manual" | "github" | "devto";
export type ConnectorKind = "github";
export type ConnectorStatus = "connected" | "error";
export type AutomationTriggerKind = "manual" | "schedule";
export type AutomationRunStatus = "queued" | "running" | "waiting-approval" | "completed" | "failed" | "cancelled";
export type AutomationStepStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export interface ProviderCatalogEntry {
  id: ModelProviderId;
  name: string;
  category: "Direct" | "Gateway" | "Local" | "Advanced";
  description: string;
  defaultBaseUrl: string;
  environmentVariables: string[];
}

export interface ModelProfile {
  id: string;
  name: string;
  provider: ModelProviderId;
  model: string;
  baseUrl: string;
  credentialSource: "environment" | "keychain" | "none";
  credentialConfigured: boolean;
  readiness: "ready" | "needs-model" | "needs-credential";
}

export interface AgentRuntimeStatus {
  id: AgentRuntimeId;
  name: string;
  command: string;
  available: boolean;
  availability: RuntimeAvailability;
  verification: RuntimeVerification;
  verifiedAt?: string;
  verificationDurationMs?: number;
  failureCode?: RuntimeFailureCode;
  verificationDetail: string;
  version?: string;
  detail: string;
  ownsModelSelection: boolean;
  capabilities: string[];
}

export interface RuntimeTestResult {
  ok: boolean;
  runtimeId: AgentRuntimeId;
  durationMs: number;
  failureCode?: RuntimeFailureCode;
  detail: string;
  controlPlane: AIControlPlane;
}

export interface AIExecutionProfile {
  runtimeId: AgentRuntimeId;
  modelProfileId: string | null;
  runtimeModel: string;
  updatedAt: string;
}

export interface AIControlPlane {
  generatedAt: string;
  secureStorage: "macOS Keychain" | "environment variables";
  providers: ProviderCatalogEntry[];
  profiles: ModelProfile[];
  runtimes: AgentRuntimeStatus[];
  execution: AIExecutionProfile;
}

export interface Product {
  id: string;
  name: string;
  description: string;
  stage: ProductStage;
  repositoryUrl: string;
  websiteUrl: string;
  evidenceCount: number;
  audience: string;
  objective: string;
  positioning: string;
  voiceGuidance: string;
  confidence: number;
  onboardingStatus: "draft" | "ready";
}

export interface Channel {
  id: string;
  name: string;
  handle: string;
  mode: ChannelMode;
  status: "connected" | "manual" | "planned";
  dailyLimit: number;
  connected: boolean;
  connector: {
    kind: "devto" | "none";
    configured: boolean;
    authenticated: boolean;
    credentialSource: "environment" | "keychain" | "none";
    productId: string;
    signalQuery: string;
    publishTags: string[];
    lastSignalSyncAt: string;
    lastOutcomeSyncAt: string;
    detail: string;
  };
}

export interface ChannelExecution {
  id: string;
  opportunityId: string;
  channelId: string;
  externalId: string;
  externalUrl: string;
  status: "pending" | "published" | "failed";
  executedAt: string;
  lastSyncedAt: string;
}

export interface OutcomeObservation {
  metric: string;
  value: number;
  source: "manual" | "connector";
  capturedAt: string;
}

export interface ChannelPolicyInput {
  mode: ChannelMode;
  dailyLimit: number;
}

export interface Evidence {
  id: string;
  kind: string;
  title: string;
  summary: string;
  sourceUrl: string;
  occurredAt: string;
  sourceType: OnboardingSourceType;
  classification: EvidenceClassification;
  confidence: number;
}

export interface AudienceSignal extends Evidence {
  productId: string;
  productName: string;
}

export interface SignalCandidate {
  id: string;
  productId: string;
  productName: string;
  kind: SignalKind;
  title: string;
  summary: string;
  excerpt: string;
  sourceUrl: string;
  sourceType: "text" | "url";
  confidence: number;
  relevance: number;
  reason: string;
  status: SignalStatus;
  capturedAt: string;
  decidedAt: string;
  origin: SignalOrigin;
  externalId: string;
}

export interface SourceConnector {
  id: string;
  productId: string;
  productName: string;
  kind: ConnectorKind;
  name: string;
  externalId: string;
  sourceUrl: string;
  status: ConnectorStatus;
  lastSyncedAt: string;
  lastError: string;
  importedCount: number;
  rateLimitRemaining: number | null;
  createdAt: string;
}

export interface AutomationControl {
  paused: boolean;
  publicExecutionEnabled: false;
  approvalBoundary: "always";
  updatedAt: string;
}

export interface AutomationPlaybook {
  id: string;
  productId: string;
  productName: string;
  name: string;
  enabled: boolean;
  intervalMinutes: number;
  maxActionsPerRun: number;
  requireApproval: true;
  lastRunAt: string;
  nextRunAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationStep {
  id: string;
  runId: string;
  sequence: number;
  name: string;
  status: AutomationStepStatus;
  detail: string;
  startedAt: string;
  completedAt: string;
}

export interface AutomationRun {
  id: string;
  playbookId: string;
  playbookName: string;
  productId: string;
  productName: string;
  trigger: AutomationTriggerKind;
  status: AutomationRunStatus;
  idempotencyKey: string;
  summary: string;
  error: string;
  createdOpportunityIds: string[];
  createdAt: string;
  completedAt: string;
  steps: AutomationStep[];
}

export type AutomationAdapterCapability = ActionAdapterDescriptor;

export interface AutomationState {
  control: AutomationControl;
  playbooks: AutomationPlaybook[];
  runs: AutomationRun[];
  adapters: AutomationAdapterCapability[];
  actionFabric: ActionFabricState;
}

export interface OnboardingSourceInput {
  type: OnboardingSourceType;
  label: string;
  value?: string;
  contentBase64?: string;
  mimeType?: string;
  filename?: string;
}

export interface OnboardProductInput {
  name: string;
  description: string;
  stage: ProductStage;
  audience: string;
  objective: string;
  positioning: string;
  voiceGuidance?: string;
  websiteUrl?: string;
  repositoryUrl?: string;
  sources: OnboardingSourceInput[];
}

export interface IngestedSource {
  type: OnboardingSourceType;
  label: string;
  sourceUrl: string;
  summary: string;
  excerpt: string;
  classification: EvidenceClassification;
  confidence: number;
}

export interface ProductBriefField {
  value: string;
  confidence: number;
  sourceLabels: string[];
  needsReview: boolean;
}

export interface ProductBriefDraft {
  name: ProductBriefField;
  description: ProductBriefField;
  audience: ProductBriefField;
  positioning: ProductBriefField;
  stage: ProductStage;
  suggestedObjectives: string[];
  overallConfidence: number;
  sourceCount: number;
  evidenceClasses: Array<{
    classification: EvidenceClassification;
    count: number;
  }>;
  analysis: {
    mode: AnalysisMode;
    runId: string | null;
    provider: string;
    model: string;
    warning: string;
  };
}

export interface HarnessStep {
  id: string;
  runId: string;
  sequence: number;
  name: string;
  status: HarnessStepStatus;
  detail: string;
  startedAt: string;
  completedAt: string;
}

export interface HarnessRun {
  id: string;
  kind: HarnessRunKind;
  productId: string;
  runtimeId: AgentRuntimeId;
  provider: string;
  model: string;
  status: HarnessRunStatus;
  summary: string;
  error: string;
  createdAt: string;
  completedAt: string;
  steps: HarnessStep[];
}

export interface DistributionPlanMove {
  channelId: string;
  type: "owned-post" | "community-contribution" | "durable-content";
  title: string;
  whyNow: string;
  suggestedAngle: string;
  draftCopy: string;
  citationLabels: string[];
  relevanceScore: number;
  valueScore: number;
  freshnessScore: number;
  promotionRisk: number;
}

export interface DistributionPlan {
  runId: string;
  productId: string;
  summary: string;
  assumptions: string[];
  moves: DistributionPlanMove[];
  mode: AnalysisMode;
  warning: string;
}

export interface PlanApplication {
  insertedCount: number;
  opportunityIds: string[];
}

export interface ContributionDraftResult {
  runId: string;
  opportunityId: string;
  draftCopy: string;
  hook: string;
  callToAction: string;
  citationLabels: string[];
  mode: AnalysisMode;
  provider: string;
  model: string;
  warning: string;
}

export interface Opportunity {
  id: string;
  productId: string;
  productName: string;
  channelId: string;
  channelName: string;
  channelMode: ChannelMode;
  type: "owned-post" | "community-contribution" | "durable-content";
  title: string;
  context: string;
  whyNow: string;
  suggestedAngle: string;
  audience: string;
  sourceUrl: string;
  draftCopy: string;
  relevanceScore: number;
  valueScore: number;
  freshnessScore: number;
  promotionRisk: number;
  score: number;
  status: OpportunityStatus;
  discoveredAt: string;
  evidence: Evidence[];
  execution: ChannelExecution | null;
  outcomes: OutcomeObservation[];
}

export interface DistributionEvent {
  id: number;
  type: string;
  entityType: string;
  entityId: string;
  productId: string;
  detail: string;
  occurredAt: string;
}

export interface DashboardState {
  generatedAt: string;
  storage: {
    mode: "local";
    location: string;
  };
  metrics: {
    readyMoves: number;
    approvedMoves: number;
    evidenceItems: number;
    newSignals: number;
    connectedChannels: number;
    connectedSources: number;
    analysisConfidence: number;
  };
  onboarding: {
    required: boolean;
    supportedSources: OnboardingSourceType[];
  };
  products: Product[];
  channels: Channel[];
  opportunities: Opportunity[];
  signalInbox: SignalCandidate[];
  connectors: SourceConnector[];
  audienceSignals: AudienceSignal[];
  recentEvents: DistributionEvent[];
  harnessRuns: HarnessRun[];
  automation: AutomationState;
}

export interface OpportunityScoreInput {
  relevance: number;
  value: number;
  freshness: number;
  promotionRisk: number;
}

export function scoreOpportunity(input: OpportunityScoreInput): number {
  const bounded = Object.fromEntries(
    Object.entries(input).map(([key, value]) => [key, Math.max(0, Math.min(100, value))]),
  ) as unknown as OpportunityScoreInput;

  const positive = bounded.relevance * 0.42 + bounded.value * 0.34 + bounded.freshness * 0.24;
  const riskPenalty = bounded.promotionRisk * 0.18;
  return Math.round(Math.max(0, Math.min(100, positive - riskPenalty)));
}
import type { ActionAdapterDescriptor, ActionFabricState } from "../packages/action-fabric/src/index.ts";
