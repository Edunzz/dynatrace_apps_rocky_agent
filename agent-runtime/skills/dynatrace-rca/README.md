# Custom RCA skill

The RCA skill comes from
[Edunzz/dynatrace_ai_skills_rca](https://github.com/Edunzz/dynatrace_ai_skills_rca)
and is installed at image build time from a pinned commit:

| Build argument | Default |
|---|---|
| `RCA_SKILLS_REPO` | `https://github.com/Edunzz/dynatrace_ai_skills_rca.git` |
| `RCA_SKILLS_REF` | `02a6a1483f8ecca2fe19415a1188bf46bcf727e6` |

At that commit the repository contains one valid skill,
**`dt-custom-rca-jromero`** (version 2.2.0). It is installed under its real
name; renaming it would break its own prerequisite checker and documentation.

## What it needs (verified by inspection)

| Requirement | Provided by the Rocky image |
|---|---|
| `dtctl` with an authenticated SaaS context | `/usr/local/bin/dtctl`, context `rocky` written at startup |
| Python 3.9+ | `python3` (Debian bookworm) |
| `dt-dql-essentials`, `dt-obs-problems`, `dt-app-notebooks` and domain `dt-obs-*` skills | official skills |
| Any draw.io skill | first-party [`drawio`](../drawio/SKILL.md) skill |
| draw.io Desktop CLI that answers `--version` | headless wrapper `/usr/local/bin/drawio` (`xvfb-run`, `--no-sandbox`), build argument `INSTALL_DRAWIO_DESKTOP=true` |

The skill exports PNG files with draw.io Desktop and its notebook builder only
accepts PNG images. With `INSTALL_DRAWIO_DESKTOP=false` its gate reports the
draw.io CLI as missing and the RCA stops before touching data, as designed.

## Validation and failure behavior

`install-skills.sh` accepts a skill only when `SKILL.md` has Agent Skills
frontmatter with a `name` equal to its directory and a non-empty `description`.
If the pinned commit contains no valid skill, the build **fails** with this
expected structure:

```text
skills/
└── <skill-name>/
    ├── SKILL.md
    ├── references/
    ├── scripts/
    └── assets/
```

No placeholder or generated RCA instructions are ever installed in its place.
