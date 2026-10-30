# Rocky Agent

A portable [OpenCode](https://opencode.ai) agent runtime with the Dynatrace
skills and `dtctl`, plus a Dynatrace App to connect to it and work with it.

> Work in progress on branch `feat/rocky-agent-initial`. See
> [docs/implementation-plan.md](docs/implementation-plan.md) for decisions,
> assumptions and open limitations.

| Component | Path | Status |
|---|---|---|
| Agent runtime (container) | [`agent-runtime/`](agent-runtime/README.md) | Phase 1 |
| Dynatrace App | `dynatrace-app/` | Phase 2–3 |
| Deployment templates | `deploy/` | Phase 4 |
