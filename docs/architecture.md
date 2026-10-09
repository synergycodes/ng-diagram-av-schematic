# Architecture

## Service Hierarchy

All services are provided at the page component level (`AvSchematicPageComponent`), no `providedIn: 'root'`.

```
AvSchematicPageComponent (providers)
  ├── ng-diagram: provideNgDiagram()
  ├── UI: PropertiesSidebarService → ElementMutationService
  ├── Removal: ConfirmDialogService (single-slot modal state) ← SelectionRemovalService (Delete / Backspace) and the sidebar Remove buttons
  ├── Library: LibraryService (left palette state, draft mode)
  ├── Visibility: NodeVisibilityConfigService
  ├── Navigation: PortFocusService → ViewportAnimationService
  ├── Export: DiagramExportService
  ├── Edge reshaping: EdgeReshapeHandler (gesture → command) → EdgeCommandDispatcher (reshaping's only model writes)
  ├── Edge relinking: RelinkEndpointHandler, RelinkTargetHighlightService
  ├── Dangling wires: DanglingEdgeService, TempEdgePointsService
  └── DiagramComponent
```

Node moves re-anchor manual wires without a dedicated service: `DiagramComponent` handles the `<ng-diagram>` outputs `selectionMoved` (live drag, no merge) and `nodeDragEnded` (drop, fold collinear bends) and calls `applyEdgeStretchOnSelectionMoved` from `edge-reshaping/middleware/edge-stretch-on-move.ts`. See `docs/edge-reshaping.md` for the three edge features and how they split.

## Key Patterns

- **Atomic structural mutations** — multi-step structural ops (e.g., node update + orphaned-edge delete in one go) wrap `NgDiagramService.transaction(..., { waitForMeasurements: true })` so the model commits in one batch and layout settles before any follow-up reads. See `ElementMutationService.handleDeviceFieldChange`. Single-op deletions wrap `transaction` too to preserve the `waitForMeasurements` semantics for layout-dependent callers.
- **Live field edits bypass the transaction wrapper** — sidebar form changes call `NgDiagramModelService.updateNodeData` / `updateEdgeData` directly so each keystroke (after debounce) flips the model without a structural batch.
- **Signals-based sidebar forms** — each entity (`device-form`, `wire-form`) owns a form service that holds a signal-backed model via `@angular/forms/signals`. Text fields are debounced (300 ms); on each dirty change the service computes a diff and emits via an injected `ON_*_FIELD_CHANGE` callback to `ElementMutationService`. Switching selection flushes pending edits before reloading the form.
- **Form reuse via injection-token override** — `DeviceFormComponent` is decoupled from the diagram model: it only depends on the `ON_DEVICE_FIELD_CHANGE` token. The properties sidebar provides a handler that calls `ElementMutationService` (live diagram update); the library detail provides a handler that writes to a `LibraryDraftService` instead. Same form, two destinations.
- **Library save-or-discard buffer** — `LibraryDraftService` is provided per `LibraryDetailComponent` instance and holds the in-progress edit. Clicking **Save** commits via `LibraryService.commitDraft` (append for create, replace for edit). Clicking **Back** just closes the detail; the component (and its draft) is destroyed. No live writes to the library while editing.
- **Palette → diagram via `paletteItemDropped`** — `<ng-diagram>` auto-instantiates the dropped node from the palette item's `data`. The diagram listens to the event only to fill in a missing `deviceId` based on the dropped category and the IDs already in use.
- **Confirm before destroying** — every destructive action (Remove device, Remove wire, Remove from library, Delete / Backspace on the canvas) awaits `ConfirmDialogService.confirm()` before it mutates anything. `<app-confirm-dialog>` is mounted once on the page and renders the pending request as a native `<dialog>`. ngDiagram's own `deleteSelection` and `cut` shortcuts are unbound in `DiagramComponent`; `SelectionRemovalService.handleKeydown` picks the keys up on `document` while focus is inside the diagram and outside a text field. `removalRequest` in `selection-removal.service.ts` builds the wording for both the keys and the sidebar buttons so they promise the same outcome.
- **Diagram-as-model** — there is no separate device/wire domain layer; the ngDiagram `Node<DeviceNodeData>` and `Edge<WireEdgeData>` are the source of truth.
- **Viewport overlays** — `appViewportBounds` / `appViewportOverlay` directives register UI elements that obscure the diagram so visibility / zoom-to-fit calculations account for them.
- **Per-row port positioning** — each `.port-row` is `position: relative`, so each `<ng-diagram-port>`'s absolute positioning anchors to its own row, not the whole node. Side-specific transforms push the port shape entirely outside the card edge.

## Project Structure

```
src/app/av-schematic/
├── av-schematic.config.ts                # Central configuration
├── pages/                                # Page container with providers
├── diagram/
│   ├── diagram.component.ts              # Main diagram component (paletteItemDropped → auto-id)
│   ├── wire-edge.component.ts            # Wire edge template (thin renderer + gesture router)
│   ├── selection-removal.service.ts      # Delete / Backspace → confirm dialog → ElementMutationService; removalRequest() wording
│   ├── port-focus.service.ts             # Pan viewport to connected node
│   ├── viewport-animation.service.ts     # Animated viewport pan primitive
│   ├── data.ts                           # Seed data
│   ├── model/                            # Domain types & helpers
│   │   ├── interfaces.ts                 # DeviceNodeData, WireEdgeData, DevicePort
│   │   ├── guards.ts                     # Type guards
│   │   ├── device-categories.ts          # Category → ID-prefix dictionary, used by combobox + auto-id
│   │   └── auto-device-id.ts             # generateDeviceId(category, existingNodes) → <PREFIX>-<N>
│   ├── edge-reshaping/                   # Manual edge routing — three layers, designed to port into ng-diagram
│   │   ├── directives/                   # UI / gesture detection (per-handle pointer state machine)
│   │   ├── handlers/                     # Gesture → command translation (holds in-flight drag state)
│   │   ├── commands/                     # reshapeEdge command, types, and EdgeCommandDispatcher
│   │   ├── middleware/                   # Node-move reflow of manual wires (edge-stretch-on-move)
│   │   └── logic/                        # Pure orthogonal-path math (segment orientation, simplify, snap, etc.)
│   ├── edge-relinking/                   # Drag an endpoint grip to reconnect a wire or leave it dangling
│   ├── dangling-edge-creation/           # Port-to-nowhere draw → one-ended manual wire
│   ├── node/                             # DeviceNode template
│   └── node-visibility/                  # Viewport-aware overlay registration
├── properties-sidebar/                   # Right panel: edit selected device/wire (live updates)
│   ├── element-mutation.service.ts       # Removal + live field updates (wraps transactions for structural ops)
│   └── components/
│       ├── sidebar-header/               # Generic toggle header (title/icon inputs — reused by library)
│       ├── sidebar-placeholder/          # Empty / multi states
│       └── wire-form/                    # Wire fields (signals form)
├── export/                               # PNG + DXF export (see docs/export.md)
│   ├── diagram-export.service.ts         # exportPng() + exportDxf() entry points
│   ├── dxf/                              # Generic, domain-free DXF library
│   └── dxf-av-schematic/                 # av-schematic-specific node/edge renderers
├── device-form/                          # Device fields (signals form). DEVICE_FORM_HIDDEN_FIELDS DI token controls visibility per-host
├── library-sidebar/                      # Left panel: drag-drop palette of device templates
│   ├── library.service.ts                # Devices, expand/collapse, editing mode (create/edit)
│   ├── library-draft.service.ts          # Per-detail-session draft buffer (Save commits; Back discards)
│   ├── seed-library.ts                   # Initial templates + createBlankTemplate factory
│   └── components/
│       ├── library-list/                 # Scrollable list + "Add device" button
│       ├── library-list-item/            # Draggable row wrapping <ng-diagram-palette-item>
│       ├── library-search/               # Debounced search input feeding LibraryService.searchQuery
│       └── library-detail/               # Reuses <app-device-form> with overridden ON_DEVICE_FIELD_CHANGE
├── shared/                               # Generic, reusable building blocks (no domain coupling)
│   ├── ui/                               # Visual building blocks
│   │   ├── combobox/                     # Editable combobox (FormValueControl<string>)
│   │   ├── confirm-dialog/               # ConfirmDialogService (single-slot request) + native <dialog> renderer, mounted once on the page
│   │   ├── form-field/                   # Label + projected input wrapper
│   │   ├── highlight-segments/           # Pipe that splits text into matched / unmatched segments for safe (no innerHTML) highlighting
│   │   └── ports-editor/                 # Tabbed (Inputs / Outputs) ports editor (FormValueControl<DevicePort[]>)
│   ├── directives/                       # Standalone behavioral directives
│   │   ├── autofocus/                    # Re-focus directive (used by library detail when entering create/edit)
│   │   └── tooltip/                      # Custom [appTooltip] (top/right/bottom/left placement, body-portaled)
│   ├── forms/                            # Form infrastructure
│   │   └── debounced-form-controller.ts
│   ├── styles/                           # SCSS partials shared across features
│   │   └── sidebar-shell/                # common :host / .sidebar / animation rules
│   └── utils/                            # Pure functions
│       └── random-short-id.ts
├── top-navbar/                           # Navigation bar + theme toggle + export menu
│   ├── theme-toggle/                     # Light/dark theme switcher
│   └── export-menu/                      # PNG/DXF export trigger
└── minimap-panel/                        # Minimap with zoom controls
```
