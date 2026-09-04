# Harness architecture

Distribution-OS treats distribution as a governed evidence-to-outcome loop, not a single prompt.

## Stages

1. **Ingest** bounds source material and classifies it as intent, public claim, implementation, or outcome evidence.
2. **Understand** performs deterministic extraction and, when configured, schema-valid source-cited AI synthesis.
3. **Observe** captures founder-supplied public discussions or imports recent GitHub issues and bounded DEV article search results through read-only connectors into a quarantined Signal Inbox. Human acceptance promotes a candidate into a separate audience-evidence class. One observation is never promoted into a trend or proof of demand.
4. **Plan** runs either the native Vraxis tool-agent contract over the AI SDK or a selected external runtime against product memory, product evidence, audience observations, channel policy, and prior outcomes.
5. **Verify** rejects moves without exact evidence-label citations and validates all output through Zod schemas.
6. **Write** runs a separate native contribution loop that must read the selected opportunity and its supporting evidence before updating the editable channel draft.
7. **Approve** gives the founder an explicit approve/skip decision. No public side effect exists in this stage.
8. **Execute** routes an approved contribution through a channel publisher registry. DEV and LinkedIn may cross the public boundary only through a separate founder confirmation, daily channel policy, verified credential, duplicate guard, and durable receipt. Other channels remain manual handoffs or Action Fabric connections.
9. **Learn** records manual outcomes or refreshes the metrics permitted by DEV and LinkedIn as connector snapshots, then exposes the latest observations to the next agent run. A metric permission failure is recorded without invalidating a confirmed publication receipt.

## Automation Kernel

Automation orchestrates the governed stages; it does not replace their boundaries.

An evidence-loop playbook stores a product, schedule, and maximum number of prepared actions per run. A manual or scheduled trigger creates an idempotent durable run in SQLite, then proceeds through four inspectable steps:

1. **Observe** refreshes attached read-only source connectors. New candidates remain quarantined in Signal Inbox.
2. **Plan** generates no more than the playbook action budget and preserves exact evidence-citation requirements.
3. **Prepare** writes founder-editable, source-cited contributions for new moves.
4. **Gate** stops in `waiting-approval`. No connector can cross the public identity boundary.

The run remains linked to the exact opportunities it prepared. Once each receives an approve or skip decision, the automation run closes as completed; restoring a move to review reopens the approval wait.

Evidence-loop deletion is an archive operation: it disables and hides the schedule while preserving completed runs and downstream outcomes for learning. Project deletion is a separate, typed-confirmation boundary and performs a permanent local cascade across every project-owned table plus non-foreign-key run, action, connector-configuration, and event records. Both operations refuse to proceed while a related automation run is queued or running.

Schedules and run state survive service restarts. Duplicate trigger keys reuse the existing run, active runs do not overlap, and the global pause control prevents new automated work. If the local service stops mid-cycle, startup recovery closes the interrupted run safely, records that no public action occurred, and returns the playbook to the due schedule. A source failure is visible but does not turn missing observations into fabricated evidence. Empty cycles complete successfully without manufacturing activity.

## Action Fabric

The Action Fabric is a framework-neutral TypeScript package under `packages/action-fabric`. It deliberately does not know about products, campaigns, social networks, or Vue. That makes it usable by Distribution-OS today and extractable into Aperta or future products later.

Every adapter declares:

- transport: direct API, MCP, bounded local CLI, optional managed gateway, or human handoff
- capabilities: observe, search, read, prepare, execute, and/or measure
- risk: read-only, private write, identity-bearing, or irreversible
- approval: none, first use, or every time
- lifecycle state and whether a public side effect is possible

The host policy always wins. It rejects unknown adapters, undeclared capabilities, missing purpose or idempotency keys, invalid/exhausted budgets, and preparation/execution without evidence. Identity-bearing and irreversible actions are upgraded to approval on every invocation even if an adapter claims otherwise. Idempotency keys are bound to the exact adapter, tool, capability, purpose, evidence, sanitized arguments, and dry-run mode; a collision with different input is rejected.

Distribution-OS currently supplies four core adapters: read-only GitHub observation, read-only DEV observation, private AI preparation, and founder-owned public handoff. User manifests can also be registered for MCP, the bounded GitHub CLI reader, an MCP-compatible managed gateway such as Composio, or a manual handoff. Registration stores no token and grants no execution rights; external transports start in `setup-required`.

The connection lifecycle is explicit:

1. Register a non-secret manifest and optional credential environment-variable name.
2. Probe the transport and discover its live tools.
3. Intersect inferred tool capabilities with the manifest's declared capabilities. MCP annotations and mutation verbs take precedence; an unclassified operation is not silently treated as read-only.
4. Mark the adapter verified only when at least one bounded tool survives that mapping.
5. Create an idempotent action request with purpose, evidence references, and sanitized arguments.
6. Re-evaluate host policy and either block, stop for approval, complete a no-transport dry run, or execute.
7. Refresh the live tool list immediately before an MCP call to detect capability drift.
8. Persist a bounded result or an explicit failure. Absence of confirmation never becomes success.

Public execution remains disabled inside scheduled Automation Kernel runs. A user may explicitly approve a single identity-bearing Action Fabric request after reviewing its sanitized payload; approval is atomically claimed once, timestamped, applies only to that durable action record, and is rechecked immediately before execution. Interrupted `running` records recover as failed without automatic replay or a success claim.

## Native loop

The native agent can call only five read tools:

- product memory
- bounded evidence
- founder-supplied audience signals
- channel policy
- prior outcome memory

Vraxis forces those tools in that exact order through the AI SDK adapter, returns their outputs to subsequent model steps, then removes every tool during final synthesis. The loop stops after ten steps. Structured-output failures receive one bounded repair attempt; unrecoverable errors create a visible local fallback plan.

The contribution writer is a separate Vraxis agent with a narrower sequence: it must read the opportunity and exact supporting evidence before returning one channel-native draft. The result is citation-checked, persisted as editable copy, and recorded as a `contribution-draft` harness run. It cannot approve or publish the contribution.

Native planning and contribution writing run through `@vraxis/agent-v`'s `AiSdkToolAgentEngine`; onboarding and the single bounded plan/contribution repair attempt use its `AiSdkStructuredModelEngine`. Every call receives an explicit confidential local project scope and returns Vraxis engine, adapter strategy, provider, model, and AI SDK runtime provenance. Tool-agent runs additionally return normalized sequence evidence: tool identity, version, model step, status, duration, and approval disposition. Distribution-OS records that redacted audit in its harness ledger without persisting tool inputs or outputs. Distribution-OS continues to resolve credentials, define the read tools and Zod schemas, verify exact evidence labels, bound retries, decide when to fall back, and own the human approval/publication boundary.

## External runtime loop

Claude Code, OpenCode, Codex CLI, and Cursor Agent receive JSON evidence files in a disposable temporary workspace. Distribution-OS requests read-only behavior, normalizes the runtime's final output, validates it against the same plan schema, verifies citations, and deletes the workspace. Runtime authentication and model selection remain owned by the runtime.

Installation discovery and execution readiness are separate states. A bounded readiness probe sends only a synthetic `runtime-probe` JSON file through the real runtime adapter and requires an exact schema-valid response. The result is tied to the discovered CLI version and stores only ready/failed state, timestamp, duration, and a normalized failure category such as authentication, timeout, invocation, empty output, invalid JSON, or schema mismatch. Raw CLI output is not retained. A version change invalidates the prior readiness result.

The active execution profile also owns product-brief synthesis. When an external runtime such as Codex CLI is selected, onboarding sends only bounded source evidence into its disposable read-only workspace and records that runtime in the harness ledger. A runtime failure returns the deterministic local extraction; it never silently switches to a configured model API.

## Durable ledger

SQLite records harness and automation runs, step names/statuses, triggers, selected runtime/model, concise diagnostics, decisions, prepared opportunity IDs, and outcomes. It does not record secrets, raw prompts, private chain-of-thought, or complete runtime transcripts.

## Connector boundary

Reusable authorization mechanics live in `packages/connection-broker`. The package owns provider manifests, Authorization Code + PKCE sessions, state validation, random-port loopback callbacks, default-browser launch, opaque credential serialization, refresh-token rotation, secure-store adapters, verified connection identity, and disconnect lifecycle. It does not know about products, drafts, evidence, approval, publishing, or Vue. Distribution OS supplies the LinkedIn provider definition and maps a verified member into channel state, so the directory can later be extracted into a Vraxis package without moving distribution policy with it.

LinkedIn connection is a public-client flow: no client secret enters the browser, local service, database, or Keychain. Each authorization attempt receives a new state value and PKCE verifier, expires after five minutes, accepts one matching callback on `127.0.0.1`, and never returns a token through the Distribution OS API. The resulting access and optional refresh credential are stored as an opaque versioned Keychain value. The previous manually pasted token path remains an explicit advanced fallback.

The connector boundary is deliberately narrow. GitHub repository metadata and recent issues are read from fixed `api.github.com` endpoints only. DEV public article search imports at most eight bounded candidates per sync. Both enter the Signal Inbox and cannot influence a plan until the founder accepts them as audience evidence.

DEV and LinkedIn are the built-in direct publishing connectors. Public DEV search needs no credential; publishing and authenticated outcome capture require a key verified against DEV and read from macOS Keychain or `DEVTO_API_KEY`. LinkedIn uses the connection broker's PKCE flow, verifies the member through OpenID user info, and stores the OAuth credential in Keychain; `LINKEDIN_ACCESS_TOKEN` remains an environment fallback. Publishing uses the versioned Posts API and engagement refresh uses Social Actions only when the app has access. Both connectors keep approval and execution separate, enforce the channel daily limit immediately before transport, require a platform receipt, prevent duplicate execution, and remain unavailable to scheduled Automation Kernel runs.
