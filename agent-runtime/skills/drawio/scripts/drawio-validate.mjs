#!/usr/bin/env node
// Validates draw.io (.drawio) XML without third-party dependencies.
//
//   node drawio-validate.mjs <file.drawio> [more files] [--json]
//
// Checks XML well-formedness, rejects DOCTYPE/custom entities, decodes
// compressed pages and verifies the mxGraph structure (root cells, unique IDs,
// parents, vertex geometry and edge endpoints). Exit code 1 on any error.

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { inflateRawSync } from "node:zlib";

const NAME = /^[A-Za-z_][\w.:-]*/;
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeEntities(text, errors, where) {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z]+);|&/g, (match, body) => {
    if (body === undefined) {
      errors.push(`${where}: unescaped '&'`);
      return match;
    }
    if (body.startsWith("#x")) return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
    if (body.startsWith("#")) return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
    if (body in ENTITIES) return ENTITIES[body];
    errors.push(`${where}: unknown entity &${body};`);
    return match;
  });
}

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
}

// Minimal non-validating XML parser producing {name, attrs, children, text}.
export function parseXml(text) {
  const errors = [];
  const root = { name: "#document", attrs: {}, children: [], text: "" };
  const stack = [root];
  let i = 0;
  while (i < text.length) {
    const lt = text.indexOf("<", i);
    const chunk = lt < 0 ? text.slice(i) : text.slice(i, lt);
    if (chunk.length > 0) {
      const top = stack[stack.length - 1];
      if (top === root) {
        if (chunk.trim().length > 0) errors.push(`line ${lineOf(text, i)}: text outside the root element`);
      } else {
        top.text += decodeEntities(chunk, errors, `line ${lineOf(text, i)}`);
      }
    }
    if (lt < 0) break;
    i = lt;
    if (text.startsWith("<?", i)) {
      const end = text.indexOf("?>", i);
      if (end < 0) { errors.push(`line ${lineOf(text, i)}: unterminated processing instruction`); break; }
      i = end + 2;
    } else if (text.startsWith("<!--", i)) {
      const end = text.indexOf("-->", i);
      if (end < 0) { errors.push(`line ${lineOf(text, i)}: unterminated comment`); break; }
      i = end + 3;
    } else if (text.startsWith("<![CDATA[", i)) {
      const end = text.indexOf("]]>", i);
      if (end < 0) { errors.push(`line ${lineOf(text, i)}: unterminated CDATA`); break; }
      stack[stack.length - 1].text += text.slice(i + 9, end);
      i = end + 3;
    } else if (text.startsWith("<!", i)) {
      errors.push(`line ${lineOf(text, i)}: DOCTYPE and entity declarations are not allowed`);
      const end = text.indexOf(">", i);
      i = end < 0 ? text.length : end + 1;
    } else if (text.startsWith("</", i)) {
      const end = text.indexOf(">", i);
      if (end < 0) { errors.push(`line ${lineOf(text, i)}: unterminated end tag`); break; }
      const name = text.slice(i + 2, end).trim();
      const top = stack.pop();
      if (!top || top === root || top.name !== name) {
        errors.push(`line ${lineOf(text, i)}: unexpected </${name}>${top && top !== root ? ` (expected </${top.name}>)` : ""}`);
        if (top) stack.push(top);
      }
      i = end + 1;
    } else {
      let j = i + 1;
      const nameMatch = NAME.exec(text.slice(j));
      if (!nameMatch) { errors.push(`line ${lineOf(text, i)}: invalid tag`); i += 1; continue; }
      const node = { name: nameMatch[0], attrs: {}, children: [], text: "", line: lineOf(text, i) };
      j += nameMatch[0].length;
      let selfClosing = false;
      for (;;) {
        while (/\s/.test(text[j] ?? "")) j += 1;
        if (text.startsWith("/>", j)) { selfClosing = true; j += 2; break; }
        if (text[j] === ">") { j += 1; break; }
        const attr = NAME.exec(text.slice(j));
        if (!attr) { errors.push(`line ${lineOf(text, j)}: malformed attribute in <${node.name}>`); j = text.indexOf(">", j) + 1 || text.length; break; }
        j += attr[0].length;
        while (/\s/.test(text[j] ?? "")) j += 1;
        if (text[j] !== "=") { errors.push(`line ${lineOf(text, j)}: attribute ${attr[0]} has no value`); break; }
        j += 1;
        while (/\s/.test(text[j] ?? "")) j += 1;
        const quote = text[j];
        if (quote !== '"' && quote !== "'") { errors.push(`line ${lineOf(text, j)}: attribute ${attr[0]} must be quoted`); break; }
        const close = text.indexOf(quote, j + 1);
        if (close < 0) { errors.push(`line ${lineOf(text, j)}: unterminated attribute ${attr[0]}`); j = text.length; break; }
        const raw = text.slice(j + 1, close);
        if (raw.includes("<")) errors.push(`line ${lineOf(text, j)}: '<' must be escaped in attribute ${attr[0]}`);
        if (Object.hasOwn(node.attrs, attr[0])) errors.push(`line ${lineOf(text, j)}: duplicate attribute ${attr[0]}`);
        node.attrs[attr[0]] = decodeEntities(raw, errors, `line ${lineOf(text, j)}`);
        j = close + 1;
      }
      const parent = stack[stack.length - 1];
      if (parent === root && root.children.length > 0) errors.push(`line ${node.line}: more than one root element`);
      parent.children.push(node);
      if (!selfClosing) stack.push(node);
      i = j;
    }
  }
  for (const open of stack.slice(1)) errors.push(`line ${open.line}: <${open.name}> is never closed`);
  return { document: root.children[0] ?? null, errors };
}

function decodeCompressedDiagram(text) {
  const bytes = Buffer.from(text.trim(), "base64");
  const inflated = inflateRawSync(bytes).toString("utf8");
  return decodeURIComponent(inflated);
}

const isNumber = (value) => value !== undefined && value !== "" && Number.isFinite(Number(value));

function validateModel(model, page, errors, warnings, stats) {
  const where = `page "${page}"`;
  const rootEl = model.children.find((c) => c.name === "root");
  if (!rootEl) {
    errors.push(`${where}: <mxGraphModel> has no <root>`);
    return;
  }
  const cells = new Map();
  for (const child of rootEl.children) {
    let cell = child;
    let id = child.attrs.id;
    if (child.name === "UserObject" || child.name === "object") {
      cell = child.children.find((c) => c.name === "mxCell");
      if (!cell) { errors.push(`${where}: <${child.name} id="${id}"> has no <mxCell>`); continue; }
    } else if (child.name !== "mxCell") {
      warnings.push(`${where}: ignoring unexpected element <${child.name}>`);
      continue;
    }
    if (!id) { errors.push(`${where}: a cell has no id (line ${child.line})`); continue; }
    if (cells.has(id)) errors.push(`${where}: duplicate cell id "${id}"`);
    cells.set(id, { ...cell.attrs, id, node: cell });
  }
  if (!cells.has("0")) errors.push(`${where}: missing root cell id="0"`);
  else if (cells.get("0").parent) errors.push(`${where}: cell "0" must not have a parent`);
  const layers = [...cells.values()].filter((c) => c.parent === "0");
  if (layers.length === 0) errors.push(`${where}: missing a layer cell with parent="0"`);

  for (const cell of cells.values()) {
    if (cell.id === "0") continue;
    if (!cell.parent) errors.push(`${where}: cell "${cell.id}" has no parent`);
    else if (!cells.has(cell.parent)) errors.push(`${where}: cell "${cell.id}" references missing parent "${cell.parent}"`);
    const isVertex = cell.vertex === "1";
    const isEdge = cell.edge === "1";
    if (isVertex && isEdge) errors.push(`${where}: cell "${cell.id}" is both a vertex and an edge`);
    const geometry = cell.node.children.find((c) => c.name === "mxGeometry");
    if (isVertex) {
      stats.vertices += 1;
      if (!geometry) errors.push(`${where}: vertex "${cell.id}" has no <mxGeometry>`);
      else {
        const { width, height, x, y } = geometry.attrs;
        if (!isNumber(width) || Number(width) <= 0 || !isNumber(height) || Number(height) <= 0) {
          errors.push(`${where}: vertex "${cell.id}" needs positive width and height`);
        }
        if ((x !== undefined && !isNumber(x)) || (y !== undefined && !isNumber(y))) {
          errors.push(`${where}: vertex "${cell.id}" has non-numeric coordinates`);
        }
      }
    }
    if (isEdge) {
      stats.edges += 1;
      for (const end of ["source", "target"]) {
        const ref = cell[end];
        if (ref === undefined) {
          const point = geometry?.children.find((c) => c.name === "mxPoint" && c.attrs.as === `${end}Point`);
          if (!point) warnings.push(`${where}: edge "${cell.id}" has no ${end} and no ${end}Point`);
        } else if (!cells.has(ref)) {
          errors.push(`${where}: edge "${cell.id}" ${end} "${ref}" does not exist`);
        }
      }
      if (!geometry) warnings.push(`${where}: edge "${cell.id}" has no <mxGeometry>`);
    }
  }
}

export function validateDrawio(text) {
  const errors = [];
  const warnings = [];
  const stats = { pages: 0, vertices: 0, edges: 0 };
  const parsed = parseXml(text);
  errors.push(...parsed.errors);
  const doc = parsed.document;
  if (!doc) {
    errors.push("document is empty");
    return { ok: false, errors, warnings, stats };
  }
  let pages = [];
  if (doc.name === "mxfile") {
    pages = doc.children.filter((c) => c.name === "diagram");
    if (pages.length === 0) errors.push("<mxfile> contains no <diagram>");
  } else if (doc.name === "mxGraphModel") {
    warnings.push("bare <mxGraphModel> document; wrap it in <mxfile><diagram> for draw.io");
    pages = [{ name: "diagram", attrs: { name: "Page 1" }, children: [doc], text: "" }];
  } else {
    errors.push(`unexpected root element <${doc.name}> (expected <mxfile>)`);
  }
  const ids = new Set();
  pages.forEach((page, index) => {
    stats.pages += 1;
    const name = page.attrs.name ?? `#${index + 1}`;
    if (page.attrs.id) {
      if (ids.has(page.attrs.id)) errors.push(`duplicate diagram id "${page.attrs.id}"`);
      ids.add(page.attrs.id);
    }
    let model = page.children.find((c) => c.name === "mxGraphModel");
    if (!model && page.text.trim()) {
      try {
        const inner = parseXml(decodeCompressedDiagram(page.text));
        errors.push(...inner.errors.map((e) => `page "${name}" (compressed): ${e}`));
        model = inner.document?.name === "mxGraphModel" ? inner.document : null;
        warnings.push(`page "${name}" is compressed; prefer uncompressed XML`);
      } catch {
        errors.push(`page "${name}": compressed content could not be decoded`);
      }
    }
    if (!model) {
      errors.push(`page "${name}" has no <mxGraphModel>`);
      return;
    }
    validateModel(model, name, errors, warnings, stats);
  });
  return { ok: errors.length === 0, errors, warnings, stats };
}

function main(argv) {
  const json = argv.includes("--json");
  const files = argv.filter((a) => a !== "--json");
  if (files.length === 0) {
    process.stderr.write("usage: drawio-validate.mjs <file.drawio> [...] [--json]\n");
    return 2;
  }
  let failed = false;
  const reports = files.map((file) => {
    let report;
    try {
      report = { file, ...validateDrawio(readFileSync(file, "utf8")) };
    } catch (error) {
      report = { file, ok: false, errors: [String(error.message)], warnings: [], stats: {} };
    }
    failed ||= !report.ok;
    return report;
  });
  if (json) process.stdout.write(`${JSON.stringify(reports, null, 2)}\n`);
  else {
    for (const r of reports) {
      process.stdout.write(`${r.ok ? "OK  " : "FAIL"} ${r.file} (${r.stats.pages ?? 0} page(s), ${r.stats.vertices ?? 0} vertices, ${r.stats.edges ?? 0} edges)\n`);
      for (const e of r.errors) process.stdout.write(`  error:   ${e}\n`);
      for (const w of r.warnings) process.stdout.write(`  warning: ${w}\n`);
    }
  }
  return failed ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exit(main(process.argv.slice(2)));
}
