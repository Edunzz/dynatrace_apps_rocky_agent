# Contributing to Rocky Agent

Thanks for helping. Everything in this repository is written in English: code,
comments, UI text, documentation, tests and commit messages.

## Ground rules

- Never commit secrets, tenant URLs, environment IDs or customer data. Use
  placeholders such as `https://abc12345.apps.dynatrace.com`.
- Keep the safety model intact: do not widen the gateway allowlist, relax the
  baseline `AGENTS.md`, or add permission `allow` rules for commands that can
  change state without discussing it in an issue first.
- Pin every external input: image digests, tool versions with checksums,
  skill commits and GitHub Actions by commit SHA.
- Do not claim that something works without a test or a reproducible check.

## Workflow

1. Create a branch from `main` (`feat/...`, `fix/...`, `docs/...`).
2. Make focused commits using [Conventional Commits](https://www.conventionalcommits.org/)
   (`feat:`, `fix:`, `docs:`, `test:`, `ci:`, `chore:`, `refactor:`).
3. Run the checks below.
4. Open a pull request. CI must pass before review.

## Local checks

```bash
# Runtime: gateway, scripts, draw.io skill (Node.js 24; jq for some tests)
cd agent-runtime && npm test

# Dynatrace App: types, lint, tests, build
cd dynatrace-app && npm ci && npm run typecheck && npm run lint && npm test && npm run build

# Container (requires Docker)
docker build -t rocky-agent:ci agent-runtime
bash agent-runtime/tests/container/image-checks.sh rocky-agent:ci
docker compose -f deploy/local/docker-compose.ci.yml up -d
bash agent-runtime/tests/container/compose-checks.sh
(cd agent-runtime && ROCKY_IT_URL=http://127.0.0.1:4096 ROCKY_IT_PASSWORD=ci-integration-password-0123 npm run test:integration)
docker compose -f deploy/local/docker-compose.ci.yml down -v
```

## Updating pinned versions

| Input | Where | How to verify |
|---|---|---|
| Node.js base image | `agent-runtime/Dockerfile` (`NODE_IMAGE`) | Resolve the new digest from the registry |
| OpenCode | `OPENCODE_VERSION` | Re-run the end-to-end tests; check the OpenAPI document for route changes |
| dtctl | `DTCTL_VERSION`, `DTCTL_SHA256_*` | Digests from the release `checksums.txt` |
| draw.io Desktop | `DRAWIO_VERSION`, `DRAWIO_SHA256_*` | Digests from `Files-SHA256-Hashes.txt` |
| Skills | `DT_SKILLS_REF`, `RCA_SKILLS_REF` | Review the upstream diff; container tests check discovery |
| GitHub Actions | `.github/workflows/*.yml` | Resolve the release tag to its commit SHA |
