# Privacy and trust

Distribution-OS is local-first because product positioning, founder voice, draft content, and distribution outcomes can be commercially sensitive.

## Stored locally

- Approved product memory and bounded source excerpts
- Public discussion URLs or bounded audience excerpts the founder explicitly captures, including dismissed Signal Inbox candidates retained as decision history
- Read-only connector metadata, sync timestamps, safe rate-limit state, and bounded GitHub issue excerpts imported for review
- Generated drafts and opportunity evidence links
- Human decisions and manually captured outcomes
- Harness run/step metadata and concise failure diagnostics
- Automation playbooks, trigger type, run/step status, action budgets, approval waits, and prepared opportunity IDs
- Action connection checks, discovered tool names/descriptions/capabilities, policy decisions, purpose, evidence references, sanitized payload previews, approval timestamps, and bounded action payloads needed to execute an approved request
- Non-secret model and runtime configuration
- Action-adapter capability manifests, lifecycle state, and non-secret configuration summaries

## Not stored in the ledger

- API keys or OAuth tokens
- Raw model prompts
- Chain-of-thought or hidden reasoning
- Complete provider/runtime responses
- Unbounded dependency trees, build output, repository history, or binary files
- Connector passwords, embedded URL credentials, arbitrary shell commands, or managed-gateway tokens

API keys entered in the macOS UI use Keychain. Environment variables are supported for automated setups. Runtime workspaces are created in the operating system's temporary directory and deleted after the run.

`GITHUB_TOKEN` is read only from the service environment. It is never copied into SQLite, UI state, events, or imported signal records.

Action Fabric registration follows the same rule. MCP URLs cannot include credentials, remote MCP endpoints must use HTTPS, private/reserved resolution and HTTP redirects are rejected, the CLI adapter is limited to a fixed authenticated GitHub issue-list operation and never invokes a shell, and managed gateways store only an endpoint plus an optional opaque connection reference. Authentication material must remain in environment variables, Keychain, or the external runtime's own secure store. The UI stores an environment-variable *name*, never its value. Tool arguments with credential-like key names are rejected and common credential patterns in values and bounded results are redacted before persistence.

## Public actions

The current product does not publish automatically. Automation may refresh a configured read-only source, generate a bounded plan, and prepare an editable draft, but the kernel stops in a human approval state. The global pause control stops new scheduled observation and preparation. A separately requested identity-bearing connection call requires review of its sanitized payload and one-time explicit approval. Every future connector must expose its transport, capabilities, permissions, limits, and public side effects before it can execute.
