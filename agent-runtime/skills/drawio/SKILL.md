---
name: drawio
description: Create, validate and export draw.io diagrams as editable .drawio XML without opening a GUI. Use for architecture diagrams, RCA dependency and propagation diagrams, incident timelines, service dependency maps and remediation flowcharts. Builds diagrams from a JSON spec with Dynatrace semantic colors, validates the XML before delivery, saves files under /workspace/artifacts/drawio/ and exports PNG or SVG previews with the headless draw.io CLI only when requested.
license: MIT
compatibility: Requires Node.js 18+. PNG/SVG/PDF export requires the headless draw.io Desktop CLI (`drawio`), which the Rocky Agent image installs by default.
metadata:
  author: Rocky Agent
  version: "1.0.0"
---

# draw.io diagrams (programmatic)

Diagrams are always written as **draw.io XML**. Never open a graphical
application to draw. Export images only when the user asks for them or another
skill requires them (for example the RCA skill needs PNG files).

## Workflow

1. **Plan** the diagram: diagram type, nodes, edges, groups and the message the
   reader should take away. Keep it under ~30 nodes; split larger systems into
   several pages or files.
2. **Write a spec** (JSON) and build the file:

   ```bash
   node <skill-dir>/scripts/drawio-build.mjs spec.json -o /workspace/artifacts/drawio/<name>.drawio
   ```

   The builder lays out nodes automatically when `x`/`y` are omitted and
   validates its own output.
3. **Hand-edit** the XML only when the spec cannot express something. Follow
   [references/xml-rules.md](references/xml-rules.md).
4. **Validate** every file before presenting it as complete:

   ```bash
   node <skill-dir>/scripts/drawio-validate.mjs /workspace/artifacts/drawio/<name>.drawio
   ```

   Fix every error. Review warnings.
5. **Export** only when requested:

   ```bash
   drawio -x -f png -e -s 2 -b 10 -o /workspace/artifacts/drawio/<name>.png /workspace/artifacts/drawio/<name>.drawio
   drawio -x -f svg -o /workspace/artifacts/drawio/<name>.svg /workspace/artifacts/drawio/<name>.drawio
   ```

   `-e` embeds the XML in the PNG so the image stays editable in draw.io.
   Validate first; the exporter does not report structural errors.

`<skill-dir>` is the directory that contains this file (in Rocky Agent:
`/workspace/.opencode/skills/drawio`).

## Spec format

```json
{
  "title": "Checkout incident - propagation",
  "type": "graph",
  "direction": "LR",
  "nodes": [
    { "id": "lb", "label": "Load balancer", "kind": "external" },
    { "id": "checkout", "label": "Checkout service", "kind": "error", "root": true },
    { "id": "payments", "label": "Payments service", "kind": "degraded" },
    { "id": "db", "label": "Orders DB", "kind": "database" }
  ],
  "edges": [
    { "source": "lb", "target": "checkout", "label": "HTTP" },
    { "source": "checkout", "target": "payments", "kind": "failure", "label": "timeouts" },
    { "source": "checkout", "target": "db", "kind": "dependency" }
  ],
  "groups": [{ "id": "k8s", "label": "Kubernetes: prod", "members": ["checkout", "payments"] }],
  "legend": true
}
```

| Field | Notes |
|---|---|
| `type` | `graph` (architecture, dependency map, propagation, flowchart) or `timeline` |
| `direction` | `LR` (default) or `TB` for automatic layout |
| `nodes[].kind` | `service`, `database`, `queue`, `external`, `host`, `user`, `process`, `decision`, `start`, `end`, `note`, `healthy`, `degraded`, `error`, `change`, `unknown` |
| `nodes[].root` | `true` marks the root cause: thick red border and a `ROOT CAUSE` tag (`rootLabel` overrides the tag text, e.g. `CAUSA RAÍZ`) |
| `nodes[].x/y/width/height` | Optional manual geometry (pixels) |
| `edges[].kind` | `flow` (default), `failure`, `dependency`, `async`, `change` |
| `groups[]` | Background containers drawn around their `members` |
| `events[]` | Timeline only: `{ "time": "10:02 UTC", "label": "Deploy v2.3", "kind": "change" }` |
| `legend` | Adds a color legend for the semantic kinds that are used |

## Semantic colors (Dynatrace Strato palette)

| Meaning | Kind | Color |
|---|---|---|
| Failure / error | `error`, edge `failure` | red |
| Degraded | `degraded` | orange |
| Healthy | `healthy` | green |
| Change (deploy, config) | `change`, edge `change` | blue |
| No visibility | `unknown` | gray, dashed |

Red always means failure. Do not use red for decoration.

## Diagram recipes

- **Architecture / service dependency map:** `type: graph`, `direction: LR`,
  groups for clusters, clouds or teams; edges labelled with protocols.
- **RCA propagation:** mark the root cause node with `root: true`; affected
  nodes `error` or `degraded`; unaffected `healthy`; failure edges `failure`.
- **Incident timeline:** `type: timeline` with ordered `events` (detection,
  change, impact start, mitigation, recovery).
- **Remediation flowchart:** `direction: TB`, `start` → `process` /
  `decision` → `end`; decision edges labelled `yes` / `no`.

## Rules

- Save editable files under `/workspace/artifacts/drawio/`.
- Every diagram must pass `drawio-validate.mjs` before you present it.
- Never put secrets, tokens, customer personal data or raw credentials in labels.
- Use the language of the conversation for labels; keep technical names as is.
