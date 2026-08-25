# Distribution-OS

Distribution-OS is a local-first distribution harness for technical products. It turns product evidence into a small queue of useful, channel-aware distribution moves, keeps a human in control of public actions, and learns from what happens afterward.

It is not a bulk outreach tool or a generic social scheduler.

## Product loop

```text
Product evidence
  → audience and channel context
  → ranked contribution opportunity
  → channel-native draft
  → human decision
  → execution
  → outcome evidence
  → distribution memory
```

The first vertical slice includes:

- A private SQLite ledger stored outside the repository
- Product memory for Aperta and OSX Components
- Evidence-backed opportunity scoring
- A three-move daily command center
- Editable drafts and approve/skip decisions
- Channel autonomy policies
- A durable distribution journal
- A Vue interface built with `osx-components`

## Local-first architecture

Distribution-OS separates the private control plane from optional execution infrastructure.

**Local core**

- Product source material and positioning
- Voice and approval memory
- Opportunity decisions
- Drafts and private notes
- Credentials where direct local execution is possible
- The distribution proof graph

**Optional managed layer**

- Always-on signal monitoring
- Scheduled publishing while a computer is offline
- Hosted OAuth callbacks and token refresh
- Team approvals and shared workspaces
- Cross-channel outcome collection

The local database defaults to `~/.distribution-os/distribution-os.sqlite`. Set `DISTRIBUTION_OS_DATA_DIR` to override it.

## Monetization boundary

The free/local product should remain genuinely useful. Monetization belongs at the operational boundary:

- Managed connectors and hosted scheduling
- Always-on monitoring agents
- Team workspaces and approval policies
- Higher signal volume and longer outcome history
- Advanced attribution and learning reports
- Managed model execution

This preserves trust: users do not have to upload their product memory or founder voice merely to use the core system.

## Development

Requires Node.js 22.12 or later.

```bash
npm install
npm run dev
```

The Vue application runs at `http://127.0.0.1:4190` and proxies its local API to `http://127.0.0.1:4191`.

```bash
npm run check
```

For a production build:

```bash
npm run build
npm start
```

## Design principles

1. Contribution before promotion.
2. Product claims require evidence.
3. Public identity remains under human control.
4. Autonomy is granted per channel and action class.
5. The system optimizes for qualified outcomes, not empty impressions.
6. Memory prevents repetition, audience fatigue, and synthetic engagement.
