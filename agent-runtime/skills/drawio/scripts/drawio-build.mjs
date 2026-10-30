#!/usr/bin/env node
// Builds an editable .drawio file from a JSON spec (see ../SKILL.md).
//
//   node drawio-build.mjs spec.json -o /workspace/artifacts/drawio/name.drawio
//   node drawio-build.mjs spec.json            # writes XML to stdout
//
// The output is validated with drawio-validate.mjs before it is written.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { validateDrawio } from "./drawio-validate.mjs";

const BASE = "whiteSpace=wrap;html=1;fontFamily=Helvetica;fontSize=13;";
const BOX = `rounded=1;arcSize=12;${BASE}`;

// Dynatrace Strato-inspired semantic palette.
export const NODE_STYLES = {
  service: `${BOX}fillColor=#f0f3ff;strokeColor=#4556d7;fontColor=#1b1c2e;`,
  process: `${BOX}fillColor=#f0f3ff;strokeColor=#4556d7;fontColor=#1b1c2e;`,
  host: `${BOX}fillColor=#f5f5fa;strokeColor=#5c5d66;fontColor=#1b1c2e;`,
  external: `${BOX}fillColor=#ffffff;strokeColor=#5c5d66;dashed=1;fontColor=#1b1c2e;`,
  user: `shape=umlActor;verticalLabelPosition=bottom;verticalAlign=top;${BASE}fillColor=#ffffff;strokeColor=#5c5d66;`,
  database: `shape=cylinder3;boundedLbl=1;backgroundOutline=1;size=12;${BASE}fillColor=#f0f3ff;strokeColor=#4556d7;fontColor=#1b1c2e;`,
  queue: `shape=mxgraph.flowchart.direct_data;${BASE}fillColor=#f0f3ff;strokeColor=#4556d7;fontColor=#1b1c2e;`,
  decision: `rhombus;${BASE}fillColor=#fff9e6;strokeColor=#b38600;fontColor=#4d3a00;`,
  start: `ellipse;${BASE}fillColor=#e8f6ee;strokeColor=#1e8a4c;fontColor=#0d4a28;`,
  end: `ellipse;${BASE}fillColor=#f4f4f6;strokeColor=#5c5d66;fontColor=#1b1c2e;`,
  note: `shape=note;size=14;${BASE}fillColor=#fffbe6;strokeColor=#b38600;fontColor=#4d3a00;align=left;spacingLeft=8;`,
  healthy: `${BOX}fillColor=#e8f6ee;strokeColor=#1e8a4c;fontColor=#0d4a28;`,
  degraded: `${BOX}fillColor=#fff4e5;strokeColor=#d56b00;fontColor=#6b3500;`,
  error: `${BOX}fillColor=#fdecee;strokeColor=#c4233b;fontColor=#7a0c1e;`,
  change: `${BOX}fillColor=#e6f1ff;strokeColor=#1966ff;fontColor=#0b3a8c;`,
  unknown: `${BOX}fillColor=#f4f4f6;strokeColor=#8e8f99;dashed=1;fontColor=#4a4b55;`,
};

export const EDGE_STYLES = {
  flow: "endArrow=block;endFill=1;html=1;rounded=0;strokeColor=#5c5d66;fontSize=11;",
  dependency: "endArrow=open;html=1;rounded=0;strokeColor=#8e8f99;dashed=1;fontSize=11;",
  async: "endArrow=open;html=1;rounded=0;strokeColor=#4556d7;dashed=1;dashPattern=1 3;fontSize=11;",
  failure: "endArrow=block;endFill=1;html=1;rounded=0;strokeColor=#c4233b;strokeWidth=2;fontColor=#7a0c1e;fontSize=11;",
  change: "endArrow=block;endFill=1;html=1;rounded=0;strokeColor=#1966ff;strokeWidth=2;fontColor=#0b3a8c;fontSize=11;",
};

const LEGEND_LABELS = {
  error: "Failure / error",
  degraded: "Degraded",
  healthy: "Healthy",
  change: "Change (deploy / config)",
  unknown: "No visibility",
};

const SIZES = {
  user: [40, 70],
  database: [140, 80],
  decision: [150, 90],
  start: [120, 60],
  end: [120, 60],
  note: [200, 80],
};

export function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\r?\n/g, "&#xa;");
}

function slug(value) {
  return String(value).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 60) || "x";
}

// Longest-path ranking from sources; cycles are broken by visit order.
export function rankNodes(nodes, edges) {
  const ids = nodes.map((n) => n.id);
  const incoming = new Map(ids.map((id) => [id, 0]));
  const outgoing = new Map(ids.map((id) => [id, []]));
  for (const e of edges) {
    if (!incoming.has(e.source) || !incoming.has(e.target) || e.source === e.target) continue;
    outgoing.get(e.source).push(e.target);
    incoming.set(e.target, incoming.get(e.target) + 1);
  }
  const rank = new Map();
  const queue = ids.filter((id) => incoming.get(id) === 0);
  if (queue.length === 0 && ids.length > 0) queue.push(ids[0]);
  queue.forEach((id) => rank.set(id, 0));
  const remaining = new Map(incoming);
  while (queue.length > 0) {
    const id = queue.shift();
    for (const next of outgoing.get(id)) {
      rank.set(next, Math.max(rank.get(next) ?? 0, rank.get(id) + 1));
      remaining.set(next, remaining.get(next) - 1);
      if (remaining.get(next) === 0) queue.push(next);
    }
  }
  for (const id of ids) if (!rank.has(id)) rank.set(id, 0);
  return rank;
}

function layoutGraph(spec) {
  const direction = spec.direction === "TB" ? "TB" : "LR";
  const nodes = spec.nodes.map((n) => {
    const [w, h] = SIZES[n.kind] ?? [160, 64];
    return { ...n, width: n.width ?? w, height: n.height ?? h };
  });
  if (nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y))) return nodes;
  const rank = rankNodes(nodes, spec.edges ?? []);
  const lanes = new Map();
  for (const n of nodes) {
    const r = rank.get(n.id);
    if (!lanes.has(r)) lanes.set(r, []);
    lanes.get(r).push(n);
  }
  const rankGap = direction === "LR" ? 240 : 150;
  const laneGap = direction === "LR" ? 120 : 220;
  const top = spec.title ? 90 : 40;
  for (const [r, members] of lanes) {
    members.forEach((n, i) => {
      if (Number.isFinite(n.x) && Number.isFinite(n.y)) return;
      if (direction === "LR") {
        n.x = 40 + r * rankGap;
        n.y = top + i * laneGap;
      } else {
        n.x = 40 + i * laneGap;
        n.y = top + r * rankGap;
      }
    });
  }
  return nodes;
}

function vertex(id, label, style, x, y, width, height, parent = "1") {
  return `<mxCell id="${escapeXml(id)}" value="${escapeXml(label)}" style="${style}" vertex="1" parent="${parent}"><mxGeometry x="${Math.round(x)}" y="${Math.round(y)}" width="${Math.round(width)}" height="${Math.round(height)}" as="geometry"/></mxCell>`;
}

function edge(id, label, style, source, target) {
  return `<mxCell id="${escapeXml(id)}" value="${escapeXml(label ?? "")}" style="${style}" edge="1" parent="1" source="${escapeXml(source)}" target="${escapeXml(target)}"><mxGeometry relative="1" as="geometry"/></mxCell>`;
}

function legendCells(kinds, x, y) {
  const used = kinds.filter((k) => k in LEGEND_LABELS);
  if (used.length === 0) return [];
  const cells = [vertex("legend-title", "Legend", `text;${BASE}fontStyle=1;align=left;`, x, y, 200, 24)];
  used.forEach((kind, i) => {
    cells.push(vertex(`legend-${kind}`, LEGEND_LABELS[kind], `${NODE_STYLES[kind]}fontSize=11;`, x, y + 30 + i * 36, 200, 28));
  });
  return cells;
}

function buildGraphCells(spec) {
  const nodes = layoutGraph(spec);
  const ids = new Set();
  for (const n of nodes) {
    if (!n.id) throw new Error("every node needs an id");
    if (ids.has(n.id)) throw new Error(`duplicate node id "${n.id}"`);
    ids.add(n.id);
  }
  const cells = [];
  for (const group of spec.groups ?? []) {
    const members = nodes.filter((n) => (group.members ?? []).includes(n.id));
    if (members.length === 0) continue;
    const x = Math.min(...members.map((n) => n.x)) - 24;
    const y = Math.min(...members.map((n) => n.y)) - 40;
    const w = Math.max(...members.map((n) => n.x + n.width)) - x + 24;
    const h = Math.max(...members.map((n) => n.y + n.height)) - y + 24;
    const style = `rounded=1;arcSize=4;${BASE}fillColor=#fafafc;strokeColor=#b7b8c2;dashed=1;verticalAlign=top;align=left;spacingLeft=10;fontStyle=1;fontColor=#4a4b55;`;
    cells.push(vertex(`group-${slug(group.id ?? group.label)}`, group.label ?? "", style, x, y, w, h));
  }
  for (const n of nodes) {
    let style = NODE_STYLES[n.kind] ?? NODE_STYLES.service;
    let label = n.label ?? n.id;
    if (n.root) {
      style = `${NODE_STYLES.error}strokeWidth=4;fontStyle=1;`;
      label = `${n.rootLabel ?? "ROOT CAUSE"}\n${label}`;
    }
    cells.push(vertex(n.id, label, style, n.x, n.y, n.width, n.height));
  }
  (spec.edges ?? []).forEach((e, i) => {
    if (!ids.has(e.source) || !ids.has(e.target)) throw new Error(`edge ${i + 1} references an unknown node`);
    cells.push(edge(e.id ?? `edge-${i + 1}`, e.label, EDGE_STYLES[e.kind] ?? EDGE_STYLES.flow, e.source, e.target));
  });
  if (spec.legend) {
    const kinds = [...new Set(nodes.map((n) => (n.root ? "error" : n.kind)))];
    const right = Math.max(...nodes.map((n) => n.x + n.width), 0) + 60;
    cells.push(...legendCells(kinds, right, spec.title ? 90 : 40));
  }
  return cells;
}

function buildTimelineCells(spec) {
  const events = spec.events ?? [];
  if (events.length === 0) throw new Error("a timeline needs at least one event");
  const gap = 200;
  const axisY = (spec.title ? 90 : 40) + 120;
  const cells = [];
  const width = (events.length - 1) * gap + 160;
  cells.push(`<mxCell id="axis" value="" style="endArrow=block;endFill=1;html=1;strokeColor=#5c5d66;strokeWidth=2;" edge="1" parent="1"><mxGeometry relative="1" as="geometry"><mxPoint x="40" y="${axisY}" as="sourcePoint"/><mxPoint x="${40 + width + 60}" y="${axisY}" as="targetPoint"/></mxGeometry></mxCell>`);
  events.forEach((ev, i) => {
    const x = 80 + i * gap;
    const kind = ev.kind ?? "service";
    const color = /strokeColor=(#[0-9a-f]{6})/i.exec(NODE_STYLES[kind] ?? NODE_STYLES.service)[1];
    cells.push(vertex(`event-${i + 1}-marker`, "", `ellipse;html=1;fillColor=${color};strokeColor=${color};`, x - 8, axisY - 8, 16, 16));
    cells.push(vertex(`event-${i + 1}`, ev.label ?? "", `${NODE_STYLES[kind] ?? NODE_STYLES.service}fontSize=12;`, x - 80, axisY - 100, 160, 64));
    cells.push(vertex(`event-${i + 1}-time`, ev.time ?? "", `text;${BASE}align=center;fontSize=11;fontColor=#4a4b55;`, x - 80, axisY + 14, 160, 24));
  });
  if (spec.legend) {
    const kinds = [...new Set(events.map((e) => e.kind ?? "service"))];
    cells.push(...legendCells(kinds, 40 + width + 100, axisY - 100));
  }
  return cells;
}

export function buildDrawio(spec) {
  if (!spec || typeof spec !== "object") throw new Error("spec must be an object");
  const type = spec.type ?? "graph";
  if (type === "graph" && !Array.isArray(spec.nodes)) throw new Error("a graph spec needs a nodes array");
  const cells = type === "timeline" ? buildTimelineCells(spec) : buildGraphCells(spec);
  if (spec.title) {
    cells.unshift(vertex("title", spec.title, `text;${BASE}fontSize=20;fontStyle=1;align=left;fontColor=#1b1c2e;`, 40, 24, 900, 36));
  }
  const page = escapeXml(spec.page ?? spec.title ?? "Page 1");
  return [
    `<mxfile host="rocky-agent" type="device">`,
    `<diagram id="${slug(spec.id ?? "page-1")}" name="${page}">`,
    `<mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1600" pageHeight="900" math="0" shadow="0">`,
    `<root>`,
    `<mxCell id="0"/>`,
    `<mxCell id="1" parent="0"/>`,
    ...cells,
    `</root>`,
    `</mxGraphModel>`,
    `</diagram>`,
    `</mxfile>`,
    "",
  ].join("\n");
}

function main(argv) {
  const out = argv.indexOf("-o");
  const output = out >= 0 ? argv[out + 1] : null;
  const input = argv.find((a, i) => !a.startsWith("-") && (out < 0 || i !== out + 1));
  if (!input) {
    process.stderr.write("usage: drawio-build.mjs <spec.json> [-o output.drawio]\n");
    return 2;
  }
  const spec = JSON.parse(readFileSync(input, "utf8"));
  const xml = buildDrawio(spec);
  const report = validateDrawio(xml);
  if (!report.ok) {
    process.stderr.write(`generated XML failed validation:\n${report.errors.join("\n")}\n`);
    return 1;
  }
  if (output) {
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, xml, "utf8");
    process.stdout.write(`wrote ${output} (${report.stats.vertices} vertices, ${report.stats.edges} edges)\n`);
  } else {
    process.stdout.write(xml);
  }
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(`drawio-build: ${error.message}\n`);
    process.exit(1);
  }
}
