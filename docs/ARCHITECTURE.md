# Harness architecture

Distribution-OS treats distribution as a governed evidence-to-outcome loop, not a single prompt.

## Stages

1. **Ingest** bounds source material and classifies it as intent, public claim, implementation, or outcome evidence.
2. **Understand** performs deterministic extraction and, when configured, schema-valid source-cited AI synthesis.
3. **Observe** captures founder-supplied public discussions or imports recent GitHub issues through a read-only connector into a quarantined Signal Inbox. Pull requests and duplicate issues are excluded. Human acceptance promotes a candidate into a separate audience-evidence class. One observation is never promoted into a trend or proof of demand.
4. **Plan** runs either the native AI SDK `ToolLoopAgent` or a selected external runtime against product memory, product evidence, audience observations, channel policy, and prior outcomes.
5. **Verify** rejects moves without exact evidence-label citations and validates all output through Zod schemas.
6. **Write** runs a separate native contribution loop that must read the selected opportunity and its supporting evidence before updating the editable channel draft.
7. **Approve** gives the founder an explicit approve/skip decision. No public side effect exists in this stage.
8. **Learn** records an observed metric and exposes aggregated outcome memory to the next agent run.

## Automation Kernel

Automation orchestrates the governed stages; it does not replace their boundaries.

An evidence-loop playbook stores a product, schedule, and maximum number of prepared actions per run. A manual or scheduled trigger creates an idempotent durable run in SQLite, then proceeds through four inspectable steps:

1. **Observe** refreshes attached read-only source connectors. New candidates remain quarantined in Signal Inbox.
2. **Plan** generates no more than the playbook action budget and preserves exact evidence-citation requirements.
3. **Prepare** writes founder-editable, source-cited contributions for new moves.
4. **Gate** stops in `waiting-approval`. No connector can cross the public identity boundary.

The run remains linked to the exact opportunities it prepared. Once each receives an approve or skip decision, the automation run closes as completed; restoring a move to review reopens the approval wait.

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

Distribution-OS currently supplies three core adapters: read-only GitHub observation, private AI preparation, and founder-owned public handoff. User manifests can also be registered for MCP, the bounded GitHub CLI reader, an MCP-compatible managed gateway such as Composio, or a manual handoff. Registration stores no token and grants no execution rights; external transports start in `setup-required`.

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

Tool outputs are returned to subsequent model steps by `ToolLoopAgent`. The loop stops after ten steps. Structured-output failures receive one bounded repair attempt; unrecoverable errors create a visible local fallback plan.

The contribution writer is also a `ToolLoopAgent`, but it has a narrower job. It must read the opportunity and exact supporting evidence before returning one channel-native draft. The result is citation-checked, persisted as editable copy, and recorded as a `contribution-draft` harness run. It cannot approve or publish the contribution.

## External runtime loop

Claude Code, OpenCode, Codex CLI, and Cursor Agent receive JSON evidence files in a disposable temporary workspace. Distribution-OS requests read-only behavior, normalizes the runtime's final output, validates it against the same plan schema, verifies citations, and deletes the workspace. Runtime authentication and model selection remain owned by the runtime.

## Durable ledger

SQLite records harness and automation runs, step names/statuses, triggers, selected runtime/model, concise diagnostics, decisions, prepared opportunity IDs, and outcomes. It does not record secrets, raw prompts, private chain-of-thought, or complete runtime transcripts.

## Connector boundary

The first connector is deliberately narrow. GitHub repository metadata and recent issues are read from fixed `api.github.com` endpoints only. A sync never comments, edits, reacts, subscribes, or publishes. Connector metadata and safe rate-limit state are stored locally; `GITHUB_TOKEN`, when supplied, remains an environment credential. Imported issues enter the Signal Inbox and cannot influence a plan until the founder accepts them as bounded audience evidence.
