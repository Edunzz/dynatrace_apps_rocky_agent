# draw.io XML rules

Use these rules when you write or edit `.drawio` XML by hand.

## File skeleton

```xml
<mxfile host="rocky-agent" type="device">
  <diagram id="page-1" name="Page 1">
    <mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1"
                  arrows="1" fold="1" page="1" pageScale="1" pageWidth="1600" pageHeight="900" math="0" shadow="0">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
        <!-- vertices and edges go here, with parent="1" -->
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
```

## Cells

- Cell `0` is the root and has no parent. Cell `1` is the default layer (`parent="0"`).
- Every other cell needs a unique `id` and an existing `parent`.
- A vertex has `vertex="1"` and an `<mxGeometry x y width height as="geometry"/>` child
  with `width` and `height` greater than zero.
- An edge has `edge="1"`, `source` and `target` pointing to existing vertices, and
  `<mxGeometry relative="1" as="geometry"/>`.
- A cell is either a vertex or an edge, never both.
- Escape `&`, `<`, `>` and `"` in attribute values (`&amp;`, `&lt;`, `&gt;`, `&quot;`).
  Use `&#xa;` for a line break inside a label.
- Do not use `<!DOCTYPE>` or custom entities.
- Prefer uncompressed `<mxGraphModel>` inside `<diagram>` so the file stays reviewable.

## Styles used by the builder

| Purpose | Style |
|---|---|
| Service | `rounded=1;whiteSpace=wrap;html=1;fillColor=#f0f3ff;strokeColor=#4556d7;fontColor=#1b1c2e;` |
| Error | `rounded=1;whiteSpace=wrap;html=1;fillColor=#fdecee;strokeColor=#c4233b;fontColor=#7a0c1e;` |
| Root cause | error style plus `strokeWidth=4;fontStyle=1;` |
| Degraded | `rounded=1;whiteSpace=wrap;html=1;fillColor=#fff4e5;strokeColor=#d56b00;fontColor=#6b3500;` |
| Healthy | `rounded=1;whiteSpace=wrap;html=1;fillColor=#e8f6ee;strokeColor=#1e8a4c;fontColor=#0d4a28;` |
| Change | `rounded=1;whiteSpace=wrap;html=1;fillColor=#e6f1ff;strokeColor=#1966ff;fontColor=#0b3a8c;` |
| Unknown | `rounded=1;whiteSpace=wrap;html=1;fillColor=#f4f4f6;strokeColor=#8e8f99;dashed=1;fontColor=#4a4b55;` |
| Database | `shape=cylinder3;boundedLbl=1;backgroundOutline=1;size=12;whiteSpace=wrap;html=1;…` |
| Failure edge | `endArrow=block;html=1;rounded=0;strokeColor=#c4233b;strokeWidth=2;` |

## Validation

Always run:

```bash
node <skill-dir>/scripts/drawio-validate.mjs <file.drawio>
```
