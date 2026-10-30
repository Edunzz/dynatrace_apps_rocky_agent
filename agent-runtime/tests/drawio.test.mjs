import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deflateRawSync } from "node:zlib";
import { buildDrawio, rankNodes } from "../skills/drawio/scripts/drawio-build.mjs";
import { validateDrawio } from "../skills/drawio/scripts/drawio-validate.mjs";

const wrap = (cells) =>
  `<mxfile><diagram id="d" name="P"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel></diagram></mxfile>`;
const box = (id) => `<mxCell id="${id}" value="${id}" vertex="1" parent="1"><mxGeometry x="0" y="0" width="80" height="40" as="geometry"/></mxCell>`;

describe("drawio-build", () => {
  it("builds a valid RCA propagation diagram with a root cause and legend", () => {
    const xml = buildDrawio({
      title: "Checkout incident & propagation <test>",
      nodes: [
        { id: "lb", label: "Load balancer", kind: "external" },
        { id: "checkout", label: "Checkout\nservice", kind: "error", root: true },
        { id: "payments", label: "Payments", kind: "degraded" },
        { id: "db", label: "Orders DB", kind: "database" },
      ],
      edges: [
        { source: "lb", target: "checkout", label: "HTTP" },
        { source: "checkout", target: "payments", kind: "failure", label: "timeouts" },
        { source: "checkout", target: "db", kind: "dependency" },
      ],
      groups: [{ id: "k8s", label: "Kubernetes", members: ["checkout", "payments"] }],
      legend: true,
    });
    const report = validateDrawio(xml);
    assert.deepEqual(report.errors, []);
    assert.equal(report.stats.edges, 3);
    assert.match(xml, /ROOT CAUSE&#xa;Checkout&#xa;service/);
    assert.match(xml, /strokeWidth=4/);
    assert.match(xml, /Checkout incident &amp; propagation &lt;test&gt;/);
  });

  it("builds a valid timeline", () => {
    const xml = buildDrawio({
      type: "timeline",
      title: "Timeline",
      events: [
        { time: "10:02 UTC", label: "Deploy v2.3", kind: "change" },
        { time: "10:05 UTC", label: "Errors start", kind: "error" },
        { time: "10:40 UTC", label: "Rollback", kind: "healthy" },
      ],
      legend: true,
    });
    assert.deepEqual(validateDrawio(xml).errors, []);
  });

  it("ranks nodes by longest path and survives cycles", () => {
    const rank = rankNodes(
      [{ id: "a" }, { id: "b" }, { id: "c" }],
      [
        { source: "a", target: "b" },
        { source: "b", target: "c" },
        { source: "a", target: "c" },
      ],
    );
    assert.deepEqual([rank.get("a"), rank.get("b"), rank.get("c")], [0, 1, 2]);
    const cyclic = rankNodes([{ id: "x" }, { id: "y" }], [{ source: "x", target: "y" }, { source: "y", target: "x" }]);
    assert.equal(cyclic.size, 2);
  });

  it("rejects edges to unknown nodes and duplicate ids", () => {
    assert.throws(() => buildDrawio({ nodes: [{ id: "a" }], edges: [{ source: "a", target: "z" }] }), /unknown node/);
    assert.throws(() => buildDrawio({ nodes: [{ id: "a" }, { id: "a" }] }), /duplicate node id/);
  });
});

describe("drawio-validate", () => {
  it("accepts a minimal valid file", () => {
    const report = validateDrawio(wrap(box("a") + box("b") + `<mxCell id="e" edge="1" parent="1" source="a" target="b"><mxGeometry relative="1" as="geometry"/></mxCell>`));
    assert.equal(report.ok, true, report.errors.join("\n"));
  });

  it("reports malformed XML", () => {
    const report = validateDrawio("<mxfile><diagram><mxGraphModel><root></mxGraphModel></diagram></mxfile>");
    assert.equal(report.ok, false);
  });

  it("rejects DOCTYPE declarations", () => {
    const report = validateDrawio(`<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "b">]>${wrap(box("a"))}`);
    assert.ok(report.errors.some((e) => e.includes("DOCTYPE")));
  });

  it("detects duplicate ids, missing parents and dangling edges", () => {
    const report = validateDrawio(
      wrap(
        box("a") +
          box("a") +
          `<mxCell id="orphan" vertex="1" parent="nope"><mxGeometry width="10" height="10" as="geometry"/></mxCell>` +
          `<mxCell id="e" edge="1" parent="1" source="a" target="ghost"><mxGeometry relative="1" as="geometry"/></mxCell>`,
      ),
    );
    const text = report.errors.join("\n");
    assert.match(text, /duplicate cell id "a"/);
    assert.match(text, /missing parent "nope"/);
    assert.match(text, /target "ghost" does not exist/);
  });

  it("requires positive vertex geometry", () => {
    const report = validateDrawio(wrap(`<mxCell id="v" vertex="1" parent="1"><mxGeometry width="0" height="10" as="geometry"/></mxCell>`));
    assert.match(report.errors.join("\n"), /positive width and height/);
  });

  it("decodes compressed pages", () => {
    const model = `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${box("a")}</root></mxGraphModel>`;
    const compressed = deflateRawSync(Buffer.from(encodeURIComponent(model))).toString("base64");
    const report = validateDrawio(`<mxfile><diagram id="d" name="P">${compressed}</diagram></mxfile>`);
    assert.equal(report.ok, true, report.errors.join("\n"));
    assert.equal(report.stats.vertices, 1);
  });

  it("flags unescaped ampersands", () => {
    const report = validateDrawio(wrap(`<mxCell id="v" value="A & B" vertex="1" parent="1"><mxGeometry width="10" height="10" as="geometry"/></mxCell>`));
    assert.match(report.errors.join("\n"), /unescaped '&'/);
  });
});
