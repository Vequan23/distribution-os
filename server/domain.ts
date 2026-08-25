export type ChannelMode = "draft" | "approval" | "autopilot";
export type OpportunityStatus = "ready" | "approved" | "skipped" | "published";
export type OnboardingSourceType = "text" | "url" | "document" | "repository";
export type EvidenceClassification = "intent" | "public-claim" | "implementation" | "outcome";

export interface Product {
  id: string;
  name: string;
  description: string;
  stage: string;
  repositoryUrl: string;
  websiteUrl: string;
  evidenceCount: number;
  audience: string;
  objective: string;
  positioning: string;
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
  stage: string;
  audience: string;
  objective: string;
  positioning: string;
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
  stage: string;
  suggestedObjectives: string[];
  overallConfidence: number;
  sourceCount: number;
  evidenceClasses: Array<{
    classification: EvidenceClassification;
    count: number;
  }>;
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
}

export interface DistributionEvent {
  id: number;
  type: string;
  entityType: string;
  entityId: string;
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
    connectedChannels: number;
    analysisConfidence: number;
  };
  onboarding: {
    required: boolean;
    supportedSources: OnboardingSourceType[];
  };
  products: Product[];
  channels: Channel[];
  opportunities: Opportunity[];
  recentEvents: DistributionEvent[];
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
