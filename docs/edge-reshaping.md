# Layout and edge reshaping

No automatic node layout is included. Device positions are explicit in `data.ts`. Wire routing has two modes:

**Auto routing (default).** ng-diagram's built-in orthogonal algorithm, configured in `diagram/diagram.component.ts`:

```ts
edgeRouting: {
  defaultRouting: 'orthogonal',
  orthogonal: {
    firstLastSegmentLength: 80,
    maxCornerRadius: 4,
  },
},
```

`firstLastSegmentLength` guarantees enough straight space at each end of the wire to fit the label.

**Manual routing.** As soon as the user grabs a handle (or draws/relinks a wire), the wire flips to `routingMode: 'manual'` and ng-diagram renders through user-supplied `points` instead of recomputing a path. The feature mirrors how ng-diagram's own resize/linking features are built so it can be lifted into the library later (see [Porting](#porting-into-ng-diagram)).

## Interaction model

Modelled on the sibling `ng-diagram-single-line-diagram` template:

- **Reshape a segment** — every orthogonal segment of a selected wire shows a handle at its *midpoint*. Dragging it slides the whole segment perpendicular to its axis; neighbours stretch to stay orthogonal. (This replaces the older drag-the-corner model.)
- **Grow a new segment** — dragging an *end* segment (first or last), whose endpoint is pinned to a port, injects an L-bend off the port so a new segment is born while the port stays put.
- **Remove a segment** — right-click a segment handle. Refused for port stubs and when removal would drop interior bends below the per-edge minimum.
- **Relink an endpoint** — a selected wire shows a dot at each end. Dragging it repositions the end; dropping on a port within `SNAP_TO_PORT_PX` connects there, otherwise the end is left dangling. Dragging a connected end off its port detaches it.
- **Create a dangling cable** — drawing a wire and dropping it on empty canvas creates a one-end edge (`target: ''` + `targetPosition`) instead of discarding the draw. The created edge reuses the live preview's exact routed points.

**Segment merging happens only at the end of a gesture** (`finalize`), never mid-drag — a deliberate divergence from SLD, kept so segments don't collapse under the cursor.

## Architecture

Logical layers, mirroring the resize feature so the move into ng-diagram is mostly mechanical:

```
src/app/av-schematic/diagram/
├── edge-reshaping/
│   ├── directives/    UI / gesture detection (pointer capture)
│   ├── handlers/      gesture → command translation + per-move pipeline
│   ├── commands/      command + dispatcher (the mutation entry point)
│   ├── middleware/    cross-cutting reactions (lifecycle events, node-move sync)
│   ├── edge-grid.ts   shared grid resolution + point snap
│   └── logic/         pure functions + types (no Angular, unit-tested)
├── edge-relinking/    relink an endpoint (drag to reconnect / dangle)
└── edge-linking/      create a dangling edge on draw-to-background
```

### Pure logic (`edge-reshaping/logic/`)

| File | Role |
|---|---|
| `segment-axis.ts` | `segmentAxis(a,b)` — coordinate-derived H/V/oblique classification; `endpointNeighborAxis`; `pathSourceOrientation(points, fallback)` for parity passes |
| `move-segment.ts` | Slide one segment to a new perpendicular coordinate (both vertices move together) |
| `reshape-anchored-segment.ts` | `move-segment` + L-bend injection at port-anchored ends; no zero-length elbow when unmoved |
| `realign-endpoint-neighbor.ts` | Snap an endpoint's neighbour back onto its captured axis after re-anchoring to a live port |
| `orthogonalize-polyline.ts` | Replace any oblique segment with a vertical-first L-bend (per-move mop-up) |
| `get-handler-positions.ts` | One segment handle per orthogonal segment, at its midpoint, axis coord-derived |
| `reflow-endpoint.ts` | Slide a connected endpoint to a moved port, shifting the adjacent bend on the constrained axis |
| `remove-straight-segments.ts`, `correct-path.ts`, `simplify-path.ts` | The drag-end merge pipeline (collinear collapse → alternation snap → optional grid snap), honouring a `minInteriorBends` floor |
| `snap-to-grid.ts` | Segment-aware grid snap; `sourceFree`/`targetFree` let a dangling stub snap |
| `port-orientation.ts`, `get-port-flow-position.ts`, `get-default-min-interior-bends.ts`, `point-array.ts`, `constants.ts`, `expected-segment-orientation.ts`, `path-types.ts` | Port/orientation helpers, thresholds, types |

### Per-move pipeline (`handlers/edge-reshape.handler.ts`)

On each pointer move the handler runs the full SLD pipeline so the result is identical to what the library will produce once ported:

1. `reshapeAnchoredSegment` — slide the segment, growing an L-bend at any anchored end
2. capture each end segment's axis, then re-anchor endpoints to their **live** ports
3. `realignEndpointNeighbor` — undo port drift
4. `orthogonalizePolyline` — mop up any diagonal
5. dispatch `reshapeEdge { finalize: false }` (grid snap only; merge deferred to `finalize`)

The drag baseline is the start-pointer position, so the grabbed segment keeps its offset under the cursor (no first-move jump).

> **Invariant: orientation is coordinate-derived, never the port's.** A wire grown at a port exits *perpendicular* to it, so `getNodePortOrientation` is the wrong axis for any geometry pass. Use `segmentAxis` / `pathSourceOrientation` / `endpointNeighborAxis` instead; the port pair is only consulted for the min-bend *count*. This is the single most common source of bugs here (it caused the snap, grow, and node-drag-reflow regressions).

### Other pieces

| File | Role |
|---|---|
| `commands/reshape-edge.ts` | Mutation entry point. Grid snap every dispatch; full `simplifyPath` on `finalize`. Writes back `sourcePosition`/`targetPosition` for dangling ends |
| `commands/dispatcher.ts`, `commands/reshape-edge-lifecycle.ts` | App-local command router + payload-less start/stop signals |
| `middleware/edge-endpoint-sync.service.ts` | Reflows a manual edge's **connected** ends when a node moves; anchors connected ends to ports on first sight; ignores dangling-end changes (so it doesn't fight relink) |
| `middleware/edge-reshape-lifecycle.emitter.ts` | Public `edgeReshapeStarted` / `edgeReshapeEnded` EventEmitters |
| `edge-relinking/relink-endpoint.handler.ts` | Drag an endpoint; reconnect to nearest port or leave dangling. Keeps the edge manual with an orthogonal, collinear-collapsed path |
| `edge-linking/link-dangling.service.ts` | On `edgeDrawEnded` with `noTarget`, adds a dangling edge using the captured preview points |
| `edge-linking/temp-edge-points.service.ts` | The live preview `WireEdgeComponent` publishes its routed points here so the created edge keeps identical bends |
| `wire-edge.component.*` | Renders the wire, the segment handles (grip-bars + directional arrow) and endpoint dots; routes gestures to the handlers |

## Grid snap

ng-diagram has no edge-specific snap config, so manual edges reuse the node-drag snap (`resolveEdgeGrid`): an edge snaps when `snapping.shouldSnapDragForNode(referenceNode)` is true, with the same step. This template defaults `AvSchematicConfig.snapping.enabled` to `true` (`gridSize: 20`). Interior segments snap their shared coord; a dangling stub snaps too (`sourceFree`/`targetFree`); port-driven endpoints never snap.

## Porting into ng-diagram

The feature mirrors the resize/linking features so the move is mostly mechanical. Broadly:

- `logic/*` pure functions move under `core/src/utils/` unchanged.
- The handler's drag state moves to `ActionStateManager` (alongside `dragging`/`resize`); commands register in `CommandMap`; reads come off `commandHandler.flowCore`.
- `EdgeEndpointSyncService` becomes a middleware on the node-move command.
- The lifecycle emitters become entries in `DiagramEventMap`.
- Relink and linking-to-dangling mirror SLD's `relink` / `linking` features; dangling support and a free-end extension hook would live in core, with app/SLD providing the specifics.
- New `FlowConfig.edgeReshape.getMinInteriorBends(edge)` (default derived from the port pair); add `edgeReshape` snap knobs so bend snap can opt in independently of node-drag snap.
