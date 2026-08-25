export type ChannelMode = "draft" | "approval" | "autopilot";
export type OpportunityStatus = "ready" | "approved" | "skipped" | "published";

export interface Product {
  id: string;
  name: string;
  description: string;
  stage: string;
  repositoryUrl: string;
  websiteUrl: string;
  evidenceCount: number;
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
