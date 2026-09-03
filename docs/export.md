# Exportação (PNG, SVG e DXF)

`src/app/av-schematic/export/` concentra os três formatos. O botão **Export** fica na barra superior e é habilitado quando o diagrama possui ao menos um nó.

**PNG** is a raster capture via [`html-to-image`](https://www.npmjs.com/package/html-to-image): `computePartsBounds(nodes, edges)` plus a 50-unit padding defines the region; the canvas is rendered at 2× pixel ratio with the active theme's background color (resolved by walking up from the diagram canvas to the first non-transparent ancestor — usually `<html>`).

**SVG** usa uma captura raster composta do mesmo canvas e a incorpora como uma única imagem PNG dentro de um contêiner SVG leve. Essa escolha é deliberada: preserva fundo, geometria e ordem visual exatamente como no PNG sem serializar a aplicação Angular inteira em um `foreignObject` (que incluía estilos e fontes e podia gerar dezenas de megabytes). O exportador usa razão de pixel 1 e rejeita arquivos acima de 5 MiB; para edição vetorial real, use o DXF.

**DXF** is a clean, vector, layer-aware drawing for CAD tools, generated entirely client-side (no library dependency). The code is split into two folders so the architecture stays clear:

Os cinco layers `BOARDS`, `DEVICES`, `FOOTPRINTS`, `WIRES` e `JUMPERS` do DXF continuam sem relação com os planos visuais. Eles representam categorias semânticas do desenho CAD, enquanto `visualPlane` controla somente a composição do canvas, PNG e SVG.

```
export/
├── diagram-export.service.ts       — exportPng() + exportDxf() entry points
├── dxf/                            — generic, domain-free DXF library
│   ├── dxf-entity.ts               — DxfLwPolyline, DxfText
│   ├── dxf-document.ts             — layers, text styles, entities, header vars
│   ├── dxf-layer.ts, dxf-text-style.ts
│   ├── dxf-coordinate-mapper.ts    — diagram coords → DXF mm (with Y-flip)
│   ├── dxf-types.ts                — renderer signatures + DxfExportConfig
│   ├── dxf-exporter.ts             — orchestrator: dispatches by node.type / edge.type
│   └── dxf-writer.ts               — DXF ASCII serializer (AutoCAD 2013, AC1027)
└── dxf-av-schematic/               — av-schematic-specific renderers
    ├── av-dxf-constants.ts         — layers, lineweights, sizes, fonts
    ├── av-dxf-config.ts            — buildAvDxfConfig() — wires renderers in
    ├── device-node-renderer.ts     — renders a `deviceNode` to DXF
    └── wire-edge-renderer.ts       — renders a `wireEdge` to DXF
```

The `dxf/` folder has no knowledge of devices, ports, or wires — it could be lifted into a standalone package as-is. All av-schematic specifics live in `dxf-av-schematic/`.

**AutoCAD compatibility.** AutoCAD parses DXF strictly according to the declared `$ACADVER` and rejects R2000+ files missing any mandatory structure ("Invalid or incomplete DXF input -- drawing discarded"), while online viewers are lenient. `dxf-writer.ts` therefore wraps the document content in the full R2000+ skeleton, mirroring dxflib/QCAD output: the VPORT / LTYPE (`ByBlock`, `ByLayer`) / LAYER (incl. layer `0`) / STYLE / VIEW / UCS / APPID / DIMSTYLE / BLOCK_RECORD tables, `*Model_Space` / `*Paper_Space` block definitions, the named-object dictionary tree with `Model` + `Layout1` layouts, and `$HANDSEED`. Any appid referenced by XDATA (group 1001 — the text styles use `ACAD` for TrueType font data) must be registered in the APPID table. `dxf-writer.spec.ts` locks these requirements down at the tag level.

**DXF layers and lineweights.** Five layers (`BOARDS`, `DEVICES`, `FOOTPRINTS`, `WIRES`, `JUMPERS`) let a CAD user control boards, generic devices, physical footprints, global wires and board-local jumpers independently. Visual hierarchy is expressed through DXF lineweights (group code 370): `WIRE` 0.35mm, `FRAME` / `DETAIL` 0.25mm, `SUBTLE` 0.13mm. Tunable in `av-dxf-constants.ts`.

**Coordinate scale.** Renderers operate in diagram coordinates (matching `node.position` / `edge.points`); `CoordinateMapper` converts to DXF millimetres at a fixed `0.3 mm` per diagram unit. This is intentional — not paper-fitted — so a device's physical size in the DXF stays constant regardless of overall diagram size (large diagrams just produce a large extent, which is normal for CAD).

**Devices.** `device-node-renderer.ts` reads port positions from `node.measuredPorts` so they line up with where ngDiagram routes wires. Each port rectangle is drawn at a fixed size and snapped flush with the device frame on the side facing away from the node. Header text uses a 1.4 line-height ratio to mirror the rendered DOM.

**Wires.** `wire-edge-renderer.ts` emits one `LWPOLYLINE` per edge from `edge.points`. Global wires use `WIRES`; a conductor with `jumperBoardId` uses `JUMPERS` and keeps its direct or freely bent polyline. Each endpoint is extended a small distance toward the next routing point so it meets the outer edge of the snapped port rectangle (ngDiagram routes to the port's measured center, which sits slightly inside that edge). The `wireId` is rendered as text at two anchors along the polyline — one near each end, mirroring the two `<ng-diagram-base-edge-label>` markers in `wire-edge.component.html`.

## Adding a renderer for a new node or edge type

1. Write a renderer function in `dxf-av-schematic/` matching the `DxfNodeRenderer` / `DxfEdgeRenderer` signature from `dxf/dxf-types.ts`. Use `ctx.mapper.mapPoint` / `mapLength` to convert diagram coordinates to DXF mm, and `ctx.doc.addEntity(...)` to emit `DxfLwPolyline` or `DxfText` records on the appropriate layer.
2. Register it in `av-dxf-config.ts` under the matching `node.type` / `edge.type` key.

`DxfExporter` will dispatch automatically — no changes are needed in `dxf/`. `device-node-renderer.ts` and `wire-edge-renderer.ts` are the reference implementations to copy from.
