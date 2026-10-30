# Official Dynatrace skills

The official `dt-*` Agent Skills from
[Dynatrace/dynatrace-for-ai](https://github.com/Dynatrace/dynatrace-for-ai) are
**not vendored** in this repository. They are installed at image build time by
[`scripts/install-skills.sh`](../../scripts/install-skills.sh) from a pinned
commit:

| Build argument | Default |
|---|---|
| `DT_SKILLS_REPO` | `https://github.com/Dynatrace/dynatrace-for-ai.git` |
| `DT_SKILLS_REF` | `f1abd8dae1f067e485bbd508a1ebe6003f9fc624` |

Every `skills/dt-*` directory with a valid `SKILL.md` is installed, so new
skills in the upstream catalog are picked up when the ref is updated. At the
pinned commit that is 36 skills, including `dt-dql-essentials`,
`dt-app-dashboards`, `dt-app-notebooks`, `dt-obs-*`, `dt-alerting`,
`dt-js-runtime`, `dt-sec-*` and `dt-platform-costs`.

At runtime the entrypoint copies them to `/workspace/.opencode/skills/`, the
project-level directory OpenCode scans. The installed inventory is written to
`/opt/rocky/skills-manifest.json` and reported by `GET /rocky/v1/status`.

## Updating

1. Pick a commit from the upstream `main` branch and review the diff.
2. Update `DT_SKILLS_REF` in `agent-runtime/Dockerfile`.
3. Rebuild; the container tests verify that the skills are discoverable.
