# Architecture

> **Tracer bullet da issue #1.** O diagrama semeado, o modelo de node e o
> formato canônico de projeto descritos aqui foram estendidos (não
> substituídos) para também representar uma placa física + nets importadas
> do WireViz no mesmo canvas, além de persistência via Salvar/Abrir contra
> um serviço local. Ver
> [`docs/wiring-tracer-bullet.md`](wiring-tracer-bullet.md) para a decisão
> de integração, [`docs/wireviz-import-limits.md`](wireviz-import-limits.md)
> para o pipeline de importação, [`docs/license-matrix.md`](license-matrix.md)
> para o status de licenciamento de cada peça reaproveitada, e
> [`docs/local-service.md`](local-service.md) para o serviço local e sua
> API.

## Hierarquia de serviços

Os serviços do editor são fornecidos no escopo de `AvSchematicPageComponent`,
sem `providedIn: 'root'`.

```
AvSchematicPageComponent (providers)
  ├── ng-diagram: provideNgDiagram()
  ├── UI: PropertiesSidebarService → ElementMutationService
  ├── Library: LibraryService (left palette state, draft mode)
  ├── Visibility: NodeVisibilityConfigService
  ├── Navigation: PortFocusService → ViewportAnimationService
  ├── Layout físico: BoardPlacementService (snap, rotação, ocupação e acompanhamento da placa)
  ├── Export: DiagramExportService
  ├── Persistência de projeto: ProjectStorageService
  ├── Intercâmbio WireViz: WireVizExchangeService
  ├── Edição de rota: EdgeCommandDispatcher → EdgeReshapeHandler + EdgeBendHandler
  ├── Relink: RelinkEndpointHandler → RelinkTargetHighlightService
  ├── Destaque de net: NetHighlightService
  ├── Ligação solta: DanglingEdgeService + TempEdgePointsService
  └── DiagramComponent
```

O movimento de nós ancora novamente os fios manuais sem um serviço dedicado:
`DiagramComponent` trata as saídas `selectionMoved` e `nodeDragEnded` do
`<ng-diagram>` e chama `applyEdgeStretchOnSelectionMoved`, em
`edge-reshaping/middleware/edge-stretch-on-move.ts`. Consulte
[`edge-reshaping.md`](edge-reshaping.md) para a separação entre edição de
rota, reconexão e criação de fios pendentes.

## Key Patterns

- **Atomic structural mutations** — multi-step structural ops (e.g., node update + orphaned-edge delete in one go) wrap `NgDiagramService.transaction(..., { waitForMeasurements: true })` so the model commits in one batch and layout settles before any follow-up reads. See `ElementMutationService.handleDeviceFieldChange`. Single-op deletions wrap `transaction` too to preserve the `waitForMeasurements` semantics for layout-dependent callers.
- **Live field edits bypass the transaction wrapper** — sidebar form changes call `NgDiagramModelService.updateNodeData` / `updateEdgeData` directly so each keystroke (after `debounce`) flips the model without a structural batch.
- **Signals-based sidebar forms** — cada entidade (`device-form`, `wire-form`, `junction-form`) possui um serviço de formulário baseado em signals. Campos de texto são atualizados com `debounce`; cada alteração suja emite pelo token `ON_*_FIELD_CHANGE` para `ElementMutationService`. Trocar a seleção confirma edições pendentes antes de recarregar o formulário.
- **Form reuse via injection-token override** — `DeviceFormComponent` is decoupled from the diagram model: it only depends on the `ON_DEVICE_FIELD_CHANGE` token. The properties sidebar provides a handler that calls `ElementMutationService` (live diagram update); the library detail provides a handler that writes to a `LibraryDraftService` instead. Same form, two destinations.
- **Library save-or-discard buffer** — `LibraryDraftService` is provided per `LibraryDetailComponent` instance and holds the in-progress edit. Clicking **Save** commits via `LibraryService.commitDraft` (append for create, replace for edit). Clicking **Back** just closes the detail; the component (and its draft) is destroyed. No live writes to the library while editing.
- **Palette → diagram via `paletteItemDropped`** — `<ng-diagram>` auto-instantiates the dropped node from the palette item's `data`. The diagram listens to the event only to fill in a missing `deviceId` based on the dropped category and the IDs already in use.
- **Canvas + inventário como modelo vivo** — nodes e edges do `ng-diagram` são a fonte dos elementos visuais e condutores conectados. `ProjectStorageService` mantém, no mesmo escopo da página, o inventário de cabos sem aresta para que cabos desconectados e posições não usadas não desapareçam ao salvar.
- **Inspeção por condutor** — rota, cor, bitola, comprimento e observação são
  persistidos no condutor correspondente. A net continua derivada da
  conectividade, e o destaque é apenas estado de visualização. Valores de
  cabo são usados no WireViz somente quando todos os condutores envolvidos
  podem compartilhá-los sem perda.
- **Footprints no mesmo modelo** — placas, footprints e componentes externos são tipos de nó no mesmo `Node[]`; `BoardPlacementService` apenas reconcilia posição, encaixe e ocupação após movimentos.
- **Cobre como junção elétrica** — um furo ou trilha usado por um condutor vira uma `CanonicalJunction` na seção `electrical`, com a geometria (`boardId`, furo, trilha) apenas em `layout`. Condutores ocultos e determinísticos ligam pinos encaixados a essa junção; as nets continuam derivadas do grafo v2.
- **Plano visual não é layer elétrico** — `layout.*[].visualPlane` define a composição persistente do canvas, PNG e SVG por meio do `zOrder` do ng-diagram. Empates usam tipo e ID; o DXF continua com seus layers semânticos próprios. Veja [`visual-planes.md`](visual-planes.md).
- **Autoria de net antes do cobre** — `WireEdgeData.netName` importado ou editado nunca é reescrito por movimento ou reconexão. O rótulo da trilha é apenas fallback para uma net nova; divergências permanecem salváveis e aparecem no relatório físico acionável do `ProjectStorageService`.
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
│   ├── port-focus.service.ts             # Pan viewport to connected node
│   ├── viewport-animation.service.ts     # Animated viewport pan primitive
│   ├── data.ts                           # Seed data
│   ├── model/                            # Domain types & helpers
│   │   ├── interfaces.ts                 # Dispositivos, placas, junções, portas e fios
│   │   ├── guards.ts                     # Type guards de node/edge
│   │   ├── board-geometry.ts             # Geometria pura da grade de furos (holeLocalPoint, boardSize, allHoles)
│   │   ├── board-selection.ts            # Escolha determinística entre placas sobrepostas
│   │   ├── board-trace.ts                # Expansão e associação elétrica das trilhas
│   │   ├── board-ports.ts                # IDs persistentes de endpoints de furos e trilhas
│   │   ├── board-surface.ts              # Variante visual persistida (perfboard/breadboard): plastico, canal, faixas e marcacoes por pitch
│   │   ├── breadboard.ts                 # Geometria da protoboard de 830 pontos (63 colunas, A-J, canal, 4 barramentos)
│   │   ├── footprint.ts                  # Catálogo original de footprints vetoriais em unidades de furo
│   │   ├── footprint-geometry.ts         # Rotação, snap, ocupação e associação pino-furo
│   │   ├── physical-connectivity.ts      # Resolução pino -> furo -> trilha e rótulo de cobre
│   │   ├── physical-diagnostics.ts       # Relatório acionável de encaixe, cobre e divergência de net
│   │   ├── canonical-project.ts          # CanonicalProjectV4 <-> Node/Edge; elétrica separada do layout
│   │   ├── canonical-project-parse.ts    # Validação v4 e migração de snapshots v1/v2/v3
│   │   ├── canonical-project-corpus.mjs  # Casos idênticos para os validadores TypeScript e Node
│   │   ├── net-grouping.ts               # Nets determinísticas derivadas da conectividade
│   │   ├── electrical-equivalence.ts     # Comparação elétrica independente da ordem textual
│   │   ├── wire-colors.ts                # Códigos WireViz e RGB exato para modelo/renderização
│   │   ├── persisted-wire-route.mjs      # Tolerância/normalização de rota compartilhada com o serviço
│   │   ├── wireviz-schema-keys.ts        # Chaves canônicas/perigosas compartilhadas por import/export
│   │   ├── device-categories.ts          # Category → ID-prefix dictionary, used by combobox + auto-id
│   │   └── auto-device-id.ts             # generateDeviceId(category, existingNodes) → <PREFIX>-<N>
│   ├── edge-reshaping/                   # Rota manual: segmentos, dobras e reancoragem
│   │   ├── directives/                   # UI / gesture detection (per-handle pointer state machine)
│   │   ├── handlers/                     # Gesture → command translation (holds in-flight drag state)
│   │   ├── commands/                     # reshapeEdge command, types, and EdgeCommandDispatcher
│   │   ├── middleware/                   # Node-move reflow of manual wires (edge-stretch-on-move)
│   │   └── logic/                        # Pure orthogonal-path math (segment orientation, simplify, snap, etc.)
│   ├── edge-relinking/                   # Reconexão de fios ou conversão da extremidade em ponta solta
│   ├── dangling-edge-creation/           # Criação de fio manual de uma porta até uma posição solta
│   ├── fixtures/                         # Placa A, protoboard de 830 pontos, placa de origem, peças E/G e montagem física
│   ├── node/                             # Templates DeviceNode, BoardNode, JunctionNode e FootprintNode
│   ├── placement/                        # Reconciliação de drag, rotação e acompanhamento da placa
│   └── node-visibility/                  # Viewport-aware overlay registration
├── wireviz-import/                       # Importador clean-room de um subconjunto YAML do WireViz (ver docs/wireviz-import-limits.md)
│   ├── wireviz-yaml.ts                   # Parser genérico de valor de um subconjunto de YAML (sem conhecimento de WireViz)
│   ├── wireviz-model.ts                  # Valida + tipa o subconjunto connectors/cables/connections do WireViz
│   ├── wireviz-colors.ts                 # Vocabulário compartilhado de cores WireViz/CSS
│   ├── wireviz-to-diagram.ts             # WireVizDocument + placement -> CanonicalElectrical
│   ├── import-wireviz.ts                 # YAML -> elétrica + relatório de compatibilidade
│   ├── export-wireviz.ts                 # Elétrica -> YAML + relatório de compatibilidade
│   ├── wireviz-yaml-emit.ts              # Emissor do subconjunto YAML relido pelo importador
│   ├── wireviz-exchange.service.ts       # Importa/substitui o projeto e exporta/baixa YAML pela UI
│   ├── wireviz-tools.component.*         # Ações da barra superior + relatório global
│   └── fixtures/                         # Fixtures clean-room das issues #1 e #2
├── project-storage/                      # Cliente de persistência de projeto (ver docs/local-service.md)
│   ├── project-storage.service.ts        # GET/PUT em /api/projects/:id; serializa via canonical-project.ts
│   └── project-storage-menu.component.ts # Salvar/Abrir e relatório de diagnóstico físico no top navbar
├── properties-sidebar/                   # Painel direito: edita dispositivo, junção ou fio selecionado
│   ├── element-mutation.service.ts       # Remoção + updates; redistribui taps quando o trilho muda
│   └── components/
│       ├── sidebar-header/               # Generic toggle header (title/icon inputs — reused by library)
│       ├── sidebar-placeholder/          # Empty / multi states
│       ├── junction-form/                # Nome, tipo, taps, notas e inspeção elétrica
│       └── wire-form/                    # Cor/metadados por condutor + net derivada e destaque
├── export/                               # PNG + DXF export (see docs/export.md)
│   ├── diagram-export.service.ts         # exportPng() + exportDxf() entry points
│   ├── dxf/                              # Generic, domain-free DXF library
│   └── dxf-av-schematic/                 # av-schematic-specific node/edge renderers
├── device-form/                          # Device fields (signals form). DEVICE_FORM_HIDDEN_FIELDS DI token controls visibility per-host
├── library-sidebar/                      # Painel esquerdo: catálogo pesquisável e arrastável de componentes
│   ├── library.service.ts                # Estado, busca, edição, persistência e restauração dos padrões
│   ├── library-draft.service.ts          # Per-detail-session draft buffer (Save commits; Back discards)
│   ├── library-search.ts                 # Busca normalizada por identidade, categoria, notas e pinos
│   ├── library-storage.ts                # Storage local v1, validação, recuperação e reparo
│   ├── seed-library.ts                   # Initial templates + createBlankTemplate factory
│   └── components/
│       ├── library-list/                 # Lista agrupada + ações de adicionar e restaurar padrões
│       ├── library-list-item/            # Draggable row wrapping <ng-diagram-palette-item>
│       ├── library-search/               # Debounced search input feeding LibraryService.searchQuery
│       └── library-detail/               # Reuses <app-device-form> with overridden ON_DEVICE_FIELD_CHANGE
├── shared/                               # Generic, reusable building blocks (no domain coupling)
│   ├── ui/                               # Visual building blocks
│   │   ├── combobox/                     # Editable combobox (FormValueControl<string>)
│   │   ├── device-illustration/           # Ilustrações SVG/CSS originais dos componentes do Talus-Droid
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
│       ├── random-short-id.ts
│       └── search-text.ts                 # Normalização compartilhada de caixa e diacríticos
├── top-navbar/                           # Navigation bar + theme toggle + export menu + menu Salvar/Abrir (app-project-storage-menu, de ../project-storage/)
│   ├── theme-toggle/                     # Light/dark theme switcher
│   └── export-menu/                      # PNG/DXF export trigger
└── minimap-panel/                        # Minimap with zoom controls
```
