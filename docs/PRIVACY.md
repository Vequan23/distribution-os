# Privacy and trust

Distribution-OS is local-first because product positioning, founder voice, draft content, and distribution outcomes can be commercially sensitive.

## Stored locally

- Approved product memory and bounded source excerpts
- Public discussion URLs or bounded audience excerpts the founder explicitly adds
- Generated drafts and opportunity evidence links
- Human decisions and manually captured outcomes
- Harness run/step metadata and concise failure diagnostics
- Non-secret model and runtime configuration

## Not stored in the ledger

- API keys or OAuth tokens
- Raw model prompts
- Chain-of-thought or hidden reasoning
- Complete provider/runtime responses
- Unbounded dependency trees, build output, repository history, or binary files

API keys entered in the macOS UI use Keychain. Environment variables are supported for automated setups. Runtime workspaces are created in the operating system's temporary directory and deleted after the run.

## Public actions

The current product does not publish automatically. Every proposed move enters a review queue. A future connector must expose its permissions, channel mode, limits, and side effect before it can execute; high-impact actions will retain explicit human approval.
