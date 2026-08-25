export const ACTION_TRANSPORTS = ["direct-api", "mcp", "cli", "managed-gateway", "manual"] as const;
export type ActionTransport = typeof ACTION_TRANSPORTS[number];

export const ACTION_CAPABILITIES = ["observe", "search", "read", "prepare", "execute", "measure"] as const;
export type ActionCapability = typeof ACTION_CAPABILITIES[number];

export const ACTION_RISKS = ["read-only", "private-write", "identity-bearing", "irreversible"] as const;
export type ActionRisk = typeof ACTION_RISKS[number];

export type ActionApproval = "none" | "first-use" | "every-time";
export type ActionAdapterState = "available" | "setup-required" | "disabled" | "planned";

export interface ActionToolDescriptor {
  name: string;
  description: string;
  capabilities: ActionCapability[];
  risk: ActionRisk;
  publicSideEffect: boolean;
}

export interface ActionAdapterDescriptor {
  id: string;
  name: string;
  version: string;
  description: string;
  transport: ActionTransport;
  capabilities: ActionCapability[];
  risk: ActionRisk;
  approval: ActionApproval;
  state: ActionAdapterState;
  publicSideEffect: boolean;
  origin: "core" | "user";
  configSummary: string;
  connection: {
    lastCheckedAt: string;
    lastError: string;
    credentialSource: "none" | "environment" | "external-runtime";
    tools: ActionToolDescriptor[];
  };
}

export interface ActionIntent {
  id: string;
  adapterId: string;
  capability: ActionCapability;
  actorId: string;
  resourceId: string;
  purpose: string;
  evidenceRefs: string[];
  idempotencyKey: string;
  requestedAt: string;
  approved: boolean;
  dryRun: boolean;
  budget: {
    used: number;
    limit: number;
  };
}

export type ActionDecisionStatus = "allowed" | "approval-required" | "blocked";

export interface ActionDecision {
  status: ActionDecisionStatus;
  reasons: string[];
  adapterId: string;
  capability: ActionCapability;
  approval: ActionApproval;
  publicSideEffect: boolean;
  evaluatedAt: string;
}

export interface ActionResult {
  actionId: string;
  adapterId: string;
  capability: ActionCapability;
  status: "completed" | "failed" | "cancelled";
  summary: string;
  externalId: string;
  externalUrl: string;
  diagnostics: string;
  startedAt: string;
  completedAt: string;
}

export type ActionExecutionStatus = "approval-required" | "running" | "completed" | "failed" | "blocked" | "cancelled";

export interface ActionExecutionRecord {
  id: string;
  adapterId: string;
  adapterName: string;
  capability: ActionCapability;
  toolName: string;
  status: ActionExecutionStatus;
  purpose: string;
  evidenceRefs: string[];
  argumentKeys: string[];
  argumentPreview: string;
  decision: ActionDecision;
  summary: string;
  error: string;
  externalId: string;
  externalUrl: string;
  idempotencyKey: string;
  dryRun: boolean;
  createdAt: string;
  approvedAt: string;
  completedAt: string;
}

export interface ActionAdapter {
  descriptor: ActionAdapterDescriptor;
  execute(intent: ActionIntent, signal?: AbortSignal): Promise<ActionResult>;
}

export interface ActionFabricState {
  version: 1;
  ethos: readonly string[];
  transports: Array<{
    id: ActionTransport;
    name: string;
    description: string;
  }>;
  adapters: ActionAdapterDescriptor[];
  executions: ActionExecutionRecord[];
  policy: {
    identityBearingApproval: "every-time";
    arbitraryShell: "forbidden";
    secretPersistence: "forbidden";
    publicAutopilot: false;
  };
}

export const ACTION_FABRIC_ETHOS = [
  "Usefulness over volume",
  "Contribution before promotion",
  "Evidence before claims",
  "Consent before identity-bearing action",
  "Measurable learning over vanity metrics",
] as const;

export const ACTION_TRANSPORT_CATALOG: ActionFabricState["transports"] = [
  { id: "direct-api", name: "Direct API", description: "A first-party integration with an explicit, narrow permission surface." },
  { id: "mcp", name: "MCP", description: "A host-controlled tool server whose discovered tools are mapped to declared capabilities." },
  { id: "cli", name: "Local CLI", description: "A bounded executable invoked without a shell and constrained by an allowlist." },
  { id: "managed-gateway", name: "Managed gateway", description: "An optional integration broker such as Composio; never a core dependency." },
  { id: "manual", name: "Human handoff", description: "The system prepares context while the human performs the identity-bearing action." },
];
