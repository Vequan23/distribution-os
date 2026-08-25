# Harness architecture

Distribution-OS treats distribution as a governed evidence-to-outcome loop, not a single prompt.

## Stages

1. **Ingest** bounds source material and classifies it as intent, public claim, implementation, or outcome evidence.
2. **Understand** performs deterministic extraction and, when configured, schema-valid source-cited AI synthesis.
3. **Observe** captures founder-supplied public discussions or bounded audience excerpts in a quarantined Signal Inbox. Human acceptance promotes a candidate into a separate audience-evidence class. One observation is never promoted into a trend or proof of demand.
4. **Plan** runs either the native AI SDK `ToolLoopAgent` or a selected external runtime against product memory, product evidence, audience observations, channel policy, and prior outcomes.
5. **Verify** rejects moves without exact evidence-label citations and validates all output through Zod schemas.
6. **Write** runs a separate native contribution loop that must read the selected opportunity and its supporting evidence before updating the editable channel draft.
7. **Approve** gives the founder an explicit approve/skip decision. No public side effect exists in this stage.
8. **Learn** records an observed metric and exposes aggregated outcome memory to the next agent run.

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

SQLite records the run, step names/statuses, selected runtime/model, concise diagnostics, decisions, and outcomes. It does not record secrets, raw prompts, private chain-of-thought, or complete runtime transcripts.
