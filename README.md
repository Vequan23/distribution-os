# Distribution-OS

Distribution-OS is a local-first AI harness that turns product evidence into a governed distribution practice: understand the product, propose a small number of source-cited moves, require a human decision, and learn from measured outcomes.

It is built for technical founders who want consistent distribution without becoming spammers. It is not a bulk outreach engine, a fake-trend generator, or a social scheduler wearing an AI label.

## The loop

```text
evidence → cited product memory → agent plan → editable draft
         → human approval → manual execution → measured outcome
         └────────────────────── learning memory ─────────────┘
```

What works today:

- Onboarding from local repository folders, public URLs, PDF, DOCX, Markdown, text, JSON, YAML, HTML, or pasted context
- Local deterministic extraction plus optional source-cited AI synthesis
- Separate evidence classes for intent, public claims, implementation, and outcomes
- Founder-supplied audience evidence from public discussion URLs or bounded excerpts, kept distinct from verified demand
- Multi-provider model profiles with Keychain or environment-variable credentials
- A native `ToolLoopAgent` that reads product memory, evidence, channel policy, and prior outcomes before planning
- Bounded Claude Code, OpenCode, Codex CLI, and Cursor Agent runtime adapters
- Schema-validated plans, exact citation checks, one repair attempt, and visible fallback behavior
- A human review queue with editable drafts, approve/skip decisions, and no implicit publishing
- A durable run ledger showing steps, runtime/model, tool chaining, failures, and fallbacks
- Manual outcome capture that feeds the next planning cycle
- A private SQLite ledger stored outside the repository
- A Vue interface built with [`osx-components`](https://www.npmjs.com/package/osx-components)

## Quick start

Requires Node.js 22.12 or later. Node.js 24 LTS is recommended.

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:4190`. The Vue app proxies the local service at `http://127.0.0.1:4191`.

1. Choose **Add Product** and add at least one source.
2. Generate the product brief. Without a model profile, local extraction remains available and is labeled honestly.
3. Correct the brief and approve product memory.
4. Open **AI Harness** to add a model API or select an installed agent runtime.
5. Add real audience context in **Audience Map** when you have a public discussion or bounded observation worth citing.
6. Use **Generate plan** from Product Memory or the Command Center.
7. Edit, approve, or skip every move. Distribution-OS never publishes during this flow.
8. After manually executing an approved move, record its outcome in Campaigns.

Run the quality gate:

```bash
npm run check
```

For a production-local build:

```bash
npm run build
npm start
```

## Model APIs and agent runtimes

These are intentionally different layers.

**Model APIs** provide inference. The selected API profile powers cited onboarding and the native Distribution-OS harness. Supported profiles include OpenAI, Anthropic, Google Gemini, DeepSeek, OpenRouter, Groq, Ollama, and custom OpenAI-compatible endpoints.

**Agent runtimes** own their internal model selection, authentication, and agent behavior. Distribution-OS gives Claude Code, OpenCode, Codex CLI, or Cursor Agent a temporary evidence workspace, blocks repository mutation through read-only modes where supported, validates the returned plan, records the result, and retains the human approval gate.

The native harness uses the Vercel AI SDK's `ToolLoopAgent`. Tool results are returned to the next model step; the agent cannot finish a plan without source citations that match product evidence.

Configure credentials through the UI or environment:

```bash
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GOOGLE_API_KEY=
DEEPSEEK_API_KEY=
OPENROUTER_API_KEY=
GROQ_API_KEY=
```

Keys entered in the macOS UI are stored in Keychain. They are never written to SQLite, prompts, events, or the repository. Use **Test** on a profile to verify the endpoint before running onboarding or a plan.

## Local-first data and privacy

The default data directory is `~/.distribution-os`:

- `distribution-os.sqlite` — products, bounded evidence, drafts, decisions, run metadata, and outcomes
- `ai-settings.json` — non-secret provider/runtime configuration
- macOS Keychain — API keys entered through the UI

Set `DISTRIBUTION_OS_DATA_DIR` to use another location. The run ledger stores step metadata and concise diagnostics, not raw prompts, chain-of-thought, credentials, or full provider responses. External runtimes use disposable temporary workspaces that are removed after each run.

See [Privacy and trust](docs/PRIVACY.md) and [Harness architecture](docs/ARCHITECTURE.md).

## Honest product boundary

Distribution-OS currently creates evidence-grounded plans and drafts, accepts founder-supplied audience observations, records human decisions, and learns from outcomes you enter. It does **not** yet claim automated community listening, representative trend detection, predictive CAC/LTV, automatic attribution, or autonomous social publishing. Those require authenticated connectors and product analytics; they will remain explicit capabilities rather than simulated signals.

The future managed layer can add always-on monitoring, OAuth connectors, team approvals, scheduling, and outcome ingestion without moving the private product-memory core into the cloud by default.

## Design principles

1. Contribution before promotion.
2. Product claims require visible evidence.
3. Public identity remains under human control.
4. Provider inference and harness behavior remain separate.
5. Failures fall back visibly; they never masquerade as AI success.
6. The system optimizes for qualified outcomes, not empty impressions.
7. Memory prevents repetition and makes the next move more informed.
8. Confidence is calculated from evidence coverage, never model certainty.

## Status

Distribution-OS is an early local-first product. The governed evidence-to-outcome loop is usable; managed connectors, background monitoring, and collaborative workspaces are roadmap items.
