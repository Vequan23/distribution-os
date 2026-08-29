# Working on Distribution-OS

Distribution-OS is the evidence-grounded distribution environment for technical founders. It helps users make a small number of deliberate, reviewed moves; it is not an autonomous spam or bulk-publishing engine.

## Boundaries

- Own product evidence, distribution plans, reviewed drafts, action policy, connections, and measured outcomes.
- Use `@vraxis/agent-v` for provider-neutral execution, tools, approvals, sessions, and runtime provenance.
- Use `osx-components` for interface primitives and themes.
- Keep distribution schemas, citation verification, channel policy, prompts, and human review inside Distribution-OS.
- Require explicit approval before publication or another external side effect.
- Keep credentials in the local service and redact them from browser responses, logs, and ledgers.
- Treat MCP servers, GitHub CLI access, gateways, and handoffs as governed connections rather than ambient authority.

Read `README.md` and the relevant server, agent, evidence, action, or Vue code before changing behavior.

## Tests and UX

- Add unit tests for schemas, policy, citations, and state transitions.
- Add integration tests for service APIs, model/runtime boundaries, and action execution.
- Verify changed user flows in a real browser.
- Use the `build-with-osx-components` skill for UI work and `devtool-copy` for product copy when available.

## Verification

Run:

```bash
npm run check
```

For marketing changes, also run:

```bash
npm run build:marketing
```

For cross-product decisions, use the `vraxis-ecosystem` skill or consult `../vraxis-platform`.
