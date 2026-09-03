# Talus Wiring Editor

[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](https://opensource.org/licenses/MIT)

Editor visual para documentar fiação física, placas, componentes, conectores e
nets multi-drop. A aplicação usa Angular 21 e
[ng-diagram](https://www.npmjs.com/package/ng-diagram), mantém um formato de
projeto canônico e oferece importação/exportação WireViz.

O repositório nasceu como fork do template AV Schematic da Synergy Codes, mas
o produto, o tracker e a implantação atuais pertencem ao Talus. O tracer
bullet da issue #1 foi estendido pela issue #2 com nets multi-drop,
junções/trilhos explícitos, projeto canônico v2 e round-trip WireViz; a issue
#3 acrescenta placas arbitrárias e footprints encaixáveis no mesmo canvas.
Consulte [`docs/wiring-tracer-bullet.md`](docs/wiring-tracer-bullet.md),
[`docs/wireviz-round-trip.md`](docs/wireviz-round-trip.md),
[`docs/physical-footprints.md`](docs/physical-footprints.md) e
[`docs/license-matrix.md`](docs/license-matrix.md).

![Demonstração do editor AV: adição de dispositivo, edição de porta, ligação, roteamento e exportação](docs/assets/demo.gif)

## Recursos

- Nós de dispositivo com identificação, fabricante, modelo e portas de entrada e saída.
- Fios ortogonais com identificação nas duas extremidades, seleção e destaque da net conectada.
- Roteamento manual por segmentos e dobras, com snap configurável e restauração da rota automática.
- Reconexão de extremidades para outra porta ou para uma posição solta no canvas.
- Criação de fios pendentes ao desenhar de uma porta para uma área vazia.
- Navegação por duplo clique na porta até o dispositivo conectado.
- Painel de propriedades com edição ao vivo de dispositivos, junções e fios.
- Biblioteca arrastável de componentes, com busca, inclusão, edição, remoção e rascunhos descartáveis.
- Geração automática de `deviceId` por prefixo de categoria e menor número livre.
- Minimap, controles de zoom e temas claro e escuro.
- Exportação para PNG e DXF pela barra superior.
- Nets WireViz multi-drop derivadas por conectividade, sem tratar fan-out como colisão de porta
- Junções e trilhos selecionáveis e editáveis no canvas, com taps visuais separados da semântica elétrica
- Projeto canônico v2 persistido pela API local de mesma origem, com migração endurecida de snapshots v1 e inventário de cabos desconectados
- Importação de arquivo YAML, fixture multi-drop, exportação WireViz e relatório global acessíveis pela barra superior
- Round-trip WireViz clean-room com `pinlabels`, `wirelabels`, referências sem ambiguidade, loops internos e RGB exato de seis dígitos

## Primeiros passos

**Pré-requisitos:** Node.js 20.19+ ou 22.12+ e npm 10+.

```bash
npm install
npm start
```

Acesse [http://localhost:4200](http://localhost:4200).

## Scripts

| Command | Description |
|---|---|
| `npm start` | Start dev server with hot reload |
| `npm run build` | Production build to `dist/` |
| `npm test` | Run unit tests via Vitest (`@angular/build:unit-test` builder) |
| `npm run test:server` | Run the local server contract tests via `Vitest` |
| `npm run format` | Format with Prettier |
| `npm run format:check` | Check formatting (used by CI) |
| `npm run lint` | Run ESLint; `--max-warnings=0` so any warning fails CI |
| `npm run lint:fix` | Run ESLint with autofix |
| `npm run type-check` | `tsc -b --noEmit` — type-check both app and spec configs via project references |

CI (`.github/workflows/build-on-pr.yml`) runs in order: `format:check` → `lint` → `type-check` → `test` → `test:server` → `build`, failing fast on the cheap checks before paying for the expensive ones.

## Implantação no Talus

O fork não publica em Azure nem em domínio público do projeto upstream. A
implantação privada usa uma release imutável no Talus, backend em loopback e
HTTPS restrito à Tailnet por Tailscale Serve. O contrato, os caminhos e as
proteções ficam em [`docs/local-service.md`](docs/local-service.md). Credenciais
e configuração do host permanecem fora deste repositório.

## Documentation

Deep-dive documentation lives in [`docs/`](docs/):

- [`docs/architecture.md`](docs/architecture.md) — service hierarchy, key patterns, project structure
- [`docs/dependency-triage.md`](docs/dependency-triage.md) — advisories observados, alcance e plano de atualização controlada
- [`docs/edge-reshaping.md`](docs/edge-reshaping.md) — roteamento manual, reconexão de endpoints, fios pendentes e separação entre as três funcionalidades
- [`docs/export.md`](docs/export.md) — PNG and DXF export pipelines
- [`docs/physical-footprints.md`](docs/physical-footprints.md) — placas, footprints, encaixe, ocupação, persistência v2 e limites da autoria física
- [`docs/wiring-tracer-bullet.md`](docs/wiring-tracer-bullet.md) — issue #1: representação de placa/componente/net física, formato canônico de projeto, o que está pendente ou fora de escopo
- [`docs/wireviz-import-limits.md`](docs/wireviz-import-limits.md) — o subconjunto de YAML WireViz que o parser desta fatia aceita
- [`docs/wireviz-round-trip.md`](docs/wireviz-round-trip.md) — projeto canônico v2, multi-drop, relatório e equivalência elétrica
- [`docs/license-matrix.md`](docs/license-matrix.md) — origem, revisão, licença e estratégia de reuso para cada base avaliada para este fork
- [`docs/local-service.md`](docs/local-service.md) — o serviço local estático+API (`server/`) e o contrato de implantação no Talus

## ngDiagram APIs Demonstrated

This template wires up a focused subset of the ngDiagram public surface. Useful as a reference for which APIs to reach for in a wiring/schematic integration.

| Concern | API | Where in this repo |
|---|---|---|
| Bootstrap | `provideNgDiagram()` | `pages/av-schematic-page.component.ts` |
| Diagram component | `<ng-diagram>` (`NgDiagramComponent`) | `diagram/diagram.component.html` |
| Background | `<ng-diagram-background>` (`NgDiagramBackgroundComponent`) | `diagram/diagram.component.html` |
| Minimap | `<ng-diagram-minimap>` (`NgDiagramMinimapComponent`) | `minimap-panel/minimap-panel.component.ts` |
| Custom node template | `NgDiagramNodeTemplateMap`, `NgDiagramNodeTemplate<TData>` interface | `diagram/diagram.component.ts`, `diagram/node/device-node.component.ts` |
| Custom edge template | `NgDiagramEdgeTemplateMap`, `NgDiagramEdgeTemplate<TData>`, `NgDiagramBaseEdgeComponent` | `diagram/wire-edge.component.ts` |
| Edge labels | `NgDiagramBaseEdgeLabelComponent`, `EdgeLabelPosition` (absolute `'30px'` and `'-30px'`) | `diagram/wire-edge.component.html` |
| Connection ports | `<ng-diagram-port>` (`NgDiagramPortComponent`) | `diagram/node/device-node.component.html` |
| Palette items | `<ng-diagram-palette-item>` (`NgDiagramPaletteItemComponent`), `<ng-diagram-palette-item-preview>` (`NgDiagramPaletteItemPreviewComponent`), `NgDiagramPaletteItem` (defaults to `BasePaletteItemData` which requires a `label` — `asDevicePaletteItem()` localizes the cast since our device nodes have no label) | `library-sidebar/components/library-list-item/*` |
| Palette drop | `paletteItemDropped` output, `PaletteItemDroppedEvent` (used to auto-fill missing `deviceId`) | `diagram/diagram.component.ts` |
| Edge routing | `NgDiagramConfig.edgeRouting` (`orthogonal` with `firstLastSegmentLength`, `maxCornerRadius`) | `diagram/diagram.component.ts` |
| Manual edge points | `Edge.points`, `Edge.routingMode: 'manual'` | `diagram/edge-reshaping/*` |
| Node-move reflow of manual edges | `selectionMoved` / `nodeDragEnded` outputs (`SelectionMovedEvent`, `NodeDragEndedEvent`) | `diagram/diagram.component.html`, `diagram/edge-reshaping/middleware/edge-stretch-on-move.ts` |
| Dangling wires | `edgeDrawEnded` output (`EdgeDrawEndedEvent`) — a port-to-nowhere draw becomes a one-ended manual edge | `diagram/dangling-edge-creation/dangling-edge.service.ts` |
| Port-side metadata | `Node.measuredPorts[].side`, `Edge.sourcePort` / `targetPort` — since ngDiagram 1.3 the `side` is refreshed when a port is recreated with a different side (e.g. direction flip), so the app trusts it directly | `diagram/edge-reshaping/logic/port-orientation.ts`, `diagram/edge-reshaping/logic/port-position.ts` |
| Snap config | `NgDiagramConfig.snapping` (`shouldSnapDragForNode`, `defaultDragSnap`, `computeSnapForNodeDrag`) | `diagram/edge-reshaping/commands/reshape-edge.ts` |
| Linking | `NgDiagramConfig.linking.finalEdgeDataBuilder` (assigns wire type and generates a wireId) | `diagram/diagram.component.ts` |
| Model init | `initializeModel()` | `diagram/diagram.component.ts` |
| Model reads | `NgDiagramModelService` (`getNodeById`, `getEdgeById`, `getConnectedEdges`) | `properties-sidebar/element-mutation.service.ts`, `properties-sidebar/properties-sidebar.service.ts`, `diagram/port-focus.service.ts` |
| Model writes | `NgDiagramModelService` (`deleteNodes`, `deleteEdges`) | `properties-sidebar/element-mutation.service.ts` |
| Live data edits | `NgDiagramModelService` (`updateNodeData`, `updateEdgeData`) | `properties-sidebar/element-mutation.service.ts` |
| Atomic transactions | `NgDiagramService.transaction(..., { waitForMeasurements: true })` | `properties-sidebar/element-mutation.service.ts` |
| Measurement invalidation | `NgDiagramService.invalidateMeasurements({ nodes })` — awaitable since ngDiagram 1.3, resolves once re-measurement lands in the model | `properties-sidebar/element-mutation.service.ts` |
| Template-output event payloads | `DiagramInitEvent`, `SelectionGestureEndedEvent` | `diagram/diagram.component.ts` |
| Viewport state | `NgDiagramViewportService` (`scale()`, `viewport()`, `canZoomIn`, `canZoomOut`) | `minimap-panel/minimap-panel.component.ts` |
| Viewport actions | `NgDiagramViewportService` (`zoomToFit`, `zoom`, `moveViewport`) | `diagram/diagram.component.ts`, `diagram/viewport-animation.service.ts`, `minimap-panel/minimap-panel.component.ts` |
| Selection | `NgDiagramSelectionService` (`selection()`) | `properties-sidebar/properties-sidebar.service.ts`, `diagram/node/device-node.component.ts` |
| Config typing | `NgDiagramConfig` | `diagram/diagram.component.ts` |
| Core types | `Node<TData>`, `Edge<TData>` | throughout |

## Customizing for Your Project

### Configuration

Tunable values (viewport zoom step, padding, etc.) are centralized in a single config file:

**`src/app/av-schematic/av-schematic.config.ts`**

To override defaults, add `provideAvSchematicConfig` to your page providers:

```typescript
import { provideAvSchematicConfig } from './av-schematic.config';

providers: [
  provideAvSchematicConfig({
    viewport: { zoomToFitPadding: 40, zoomStep: 0.2 },
    snapping: { gridSize: 40 },          // or { enabled: false } to turn snap off
  }),
]
```

`snapping.enabled` (default `true`) toggles grid snap for both node drag and manual edge bends — the bend snap rides on the same opt-in, see [`docs/edge-reshaping.md`](docs/edge-reshaping.md). `gridSize` (default `20`) sets the step in diagram units. Unspecified values keep their defaults. See `AvSchematicConfig` interface for all options.

### Data Model

Node and edge data interfaces are defined in `src/app/av-schematic/diagram/model/interfaces.ts`.

`DeviceNodeData`:

| Property | Purpose |
|---|---|
| `type: 'device'` | Discriminator |
| `deviceId` | Bold header line (e.g. `AMP-01`) |
| `manufacturer` | Header subtitle |
| `model` | Header subtitle |
| `category` | Free-text metadata (editable in sidebar) |
| `location` | Free-text metadata (editable in sidebar) |
| `ports` | Array of `DevicePort` |

`DevicePort`:

| Property | Purpose |
|---|---|
| `id` | Port id (referenced by edges via `sourcePort`/`targetPort`) |
| `label` | Visible port label (e.g. `OUT A`) |
| `direction` | `'input'` (left column) or `'output'` (right column) |
| `connectorType` | Optional subtitle (e.g. `XLR`, `HDMI`, `Speakon`) |

`WireEdgeData`:

| Property | Purpose |
|---|---|
| `type: 'wire'` | Discriminator |
| `wireId` | Rendered as label near both ends of the edge (editable in sidebar) |
| `wireType` | Optional signal kind: `audio`, `video`, `speaker`, `ethernet`, `power`, `control`, `usb`, `fiber` (editable in sidebar) |

### Node Component

[`diagram/node/device-node.component.*`](src/app/av-schematic/diagram/node/) renders every device: a header with the device ID, manufacturer, and model, then an input-port column on the left and an output-port column on the right.

- **Header fields** — the template reads `deviceId`, `manufacturer`, and `model` from the node data. To show another field, add it to `DeviceNodeData` (see Data Model), to the device form, and to this template.
- **Node and port size** — `--av-node-width`, `--av-port-width`, `--av-port-height` in [`src/tokens.css`](src/tokens.css) (see Theming). The port shape itself is `.port-shape` in the component SCSS.
- **State styling** — the host element gets the classes `selected`, `edge-highlighted`, `is-link-target`, and `is-linking`; style them in the component SCSS.
- **A second node type** — add a value to `NodeTemplateType` in [`diagram/model/interfaces.ts`](src/app/av-schematic/diagram/model/interfaces.ts), write a component implementing `NgDiagramNodeTemplate<YourData>`, and register it in `nodeTemplateMap` in [`diagram/diagram.component.ts`](src/app/av-schematic/diagram/diagram.component.ts).

### Edge Component

[`diagram/wire-edge.component.*`](src/app/av-schematic/diagram/) renders every wire on top of ngDiagram's `<ng-diagram-base-edge>`, so the path itself comes from the library.

- **Stroke** — `strokeColor()` and `strokeWidth()` in the component: `--av-color-wire-stroke` normally, `--av-color-accent` when selected. To color wires by `wireType`, branch there.
- **Labels** — two `<ng-diagram-base-edge-label>` elements show the `wireId` at `30px` from the source and `-30px` from the target. Change `positionOnEdge` or the label content in the HTML.
- **Routing** — `edgeRouting` in [`diagram/diagram.component.ts`](src/app/av-schematic/diagram/diagram.component.ts): `orthogonal`, `firstLastSegmentLength: 80`, `maxCornerRadius: 4`. Manual reshaping is a separate feature — see [`docs/edge-reshaping.md`](docs/edge-reshaping.md).
- **A second edge type** — same recipe as for nodes: `EdgeTemplateType`, a component implementing `NgDiagramEdgeTemplate<YourData>`, and `edgeTemplateMap`.

### Adding Your Own Data

Replace the seed data in `src/app/av-schematic/diagram/data.ts`. Each device node needs:

- A unique `id`
- `type: 'deviceNode'` (use the `NodeTemplateType.DeviceNode` enum)
- An explicit `position: { x, y }` (no automatic layout — see [`docs/edge-reshaping.md`](docs/edge-reshaping.md))
- A `data` object matching `DeviceNodeData`

Each wire edge needs:

- A unique `id`
- `type: 'wireEdge'` (use the `EdgeTemplateType.WireEdge` enum)
- `source` / `target` device ids and `sourcePort` / `targetPort` port ids
- A `data` object matching `WireEdgeData`

### Device Library (drag-and-drop palette)

The left panel holds **device templates** — recipes without `id` or `position` that become nodes when dragged onto the canvas. `<ng-diagram>` handles the drop itself; the app only fills in a missing `deviceId`.

| File | Purpose |
|---|---|
| `library-sidebar/seed-library.ts` | Initial set of templates. Each entry is `{ libraryId, template: DeviceNodeData }`. `deviceId` and `location` are kept empty — they're instance fields, not template fields |
| `library-sidebar/library.service.ts` | Estado da página: `devices`, expansão, edição, busca e persistência. `restoreDefaults()` repõe os seeds atuais sem remover componentes personalizados |
| `library-sidebar/library-storage.ts` | Persistência `localStorage` v1. Recupera entradas válidas individualmente, remove entradas corrompidas/duplicadas e preserva um catálogo vazio intencional |
| `library-sidebar/library-draft.service.ts` | Per-detail-session draft buffer. While the detail view is open, every form change writes here (not to the library). **Save** commits via `LibraryService.commitDraft`; **Back** simply tears the component down and the draft with it |
| `library-sidebar/components/library-list-item/*` | Cada linha combina o item arrastável, a ilustração, a categoria localizada e notas visíveis. `HighlightSegmentsPipe` destaca os trechos encontrados |
| `library-sidebar/components/library-search/*` | Busca com debounce de 150 ms por fabricante, modelo, categoria, notas e rótulos de pino, sem diferenciar maiúsculas, minúsculas ou diacríticos. O termo permanece ao abrir um detalhe e voltar |
| `library-sidebar/components/library-detail/*` | Reuses `<app-device-form>` with a local `DeviceFormService` provider and an overridden `ON_DEVICE_FIELD_CHANGE` token that writes to the draft service. Hides `deviceId` and `location` by providing `DEVICE_FORM_HIDDEN_FIELDS = ['deviceId', 'location']` |
| `diagram/model/device-categories.ts` | Canonical category dictionary — `DEVICE_CATEGORY_PREFIXES` (`microphone` → `MIC`, `camera` → `CAM`, …), `DEVICE_CATEGORIES` (the keys, used by the combobox), `FALLBACK_DEVICE_PREFIX = 'DEV'` |
| `diagram/model/auto-device-id.ts` | `generateDeviceId(category, existingNodes)` — returns `<PREFIX>-<N>` where `N` is the smallest positive integer not already in use by a device of that prefix. Called from `(paletteItemDropped)` in `DiagramComponent` |

**Adding a category.** Add an entry to `DEVICE_CATEGORY_PREFIXES` in `device-categories.ts` and the combobox plus the ID generator pick it up automatically. Unmapped categories fall through to `DEV-N`.

**Adição de entradas.** Acrescente os padrões a `SEED_LIBRARY` em `seed-library.ts`, com `libraryId` estável, `deviceId` vazio (gerado automaticamente no drop) e dados realistas. Para um item apenas local, use **+ Adicionar componente** no rodapé da lista.

O storage v1 mantém o catálogo salvo pelo usuário sem fazer merge automático com os seeds, inclusive quando a lista salva é `[]`. A ação visível **Restaurar padrões** repõe os seis seeds da versão atual, descarta apenas edições ou remoções locais desses ids e mantém os componentes personalizados `lib-custom-*`; portanto, ela também aplica correções e novas entradas adicionadas posteriormente a `SEED_LIBRARY` sem apagar criações do usuário.

**Why `paletteItemDropped`?** ng-diagram's `<ng-diagram>` registers `PaletteDropDirective` automatically — the drop creates a node from the palette item's `data` without any wiring on our side. We only listen to the event so we can auto-assign a `deviceId` if the template's was empty (which is the default for library entries).

### Editable category combobox

`shared/ui/combobox/combobox.component.*` — a `FormValueControl<string>` so it slots into existing `[formField]` bindings. Visual structure mirrors the orgchart project's combobox (bordered trigger wrapping a transparent input + caret button, listbox panel with the project's `--ngd-token-spacing-dropdown-*` and `--ngd-input-stroke-primary-*` tokens). Behavior is the editable variant: typed values that aren't in the list are kept as-is. `filterText` is held separately from `value` so opening the panel always shows all options — typing narrows the list. Used for the device-form's `category` field.

### Theming

Theme is driven by the `data-theme` attribute on `<html>` (`"light"` or `"dark"`) and persisted in `localStorage`. The toggle UI lives in `src/app/av-schematic/top-navbar/theme-toggle/theme-toggle.component.ts`.

Color and dimension tokens are defined in `src/tokens.css`:

- **`--ngd-colors-*`** — base palette (grays + accent ramps `acc1`–`acc9`).
- **`--ngd-*` semantic tokens** — UI surfaces, text colors, edge defaults, etc., theme-aware.
- **`--av-*` schematic tokens** — node width, port dimensions, accent and wire stroke aliases:
  - `--av-node-width`, `--av-port-width`, `--av-port-height`
  - `--av-color-accent`, `--av-color-wire-stroke`

Global stylesheet entry point: `src/styles.css` (imports `tokens.css`, typography, and `ng-diagram/styles.css`).

## Tech Stack

- **Angular 21** — standalone components, signals, OnPush change detection, zoneless (`provideZonelessChangeDetection()`) — no `zone.js`, re-renders driven by signal mutations only
- **`@angular/forms/signals`** — sidebar forms (signal-backed `form()`, per-field `debounce()`)
- **ngDiagram** ([`ng-diagram`](https://www.npmjs.com/package/ng-diagram) on npm) — diagram rendering, viewport management, selection, edge routing
- **html-to-image** — PNG capture (DXF has no library dependency, written as ASCII directly)
- **ESLint** (flat config) with `angular-eslint` + typescript-eslint `strict-type-checked` + `stylistic-type-checked`
- **Prettier** — code formatting
- **Vitest** — unit test runner via `@angular/build:unit-test`

## ngDiagram Documentation

For comprehensive ngDiagram documentation, examples, and API reference, visit: **[ngdiagram.dev/docs](https://www.ngdiagram.dev/docs)**

## Suporte

- **Issues do fork:** [felipedruzian/talus-wiring-editor](https://github.com/felipedruzian/talus-wiring-editor/issues)
- **Biblioteca ngDiagram:** [documentação](https://www.ngdiagram.dev/docs), [discussões](https://github.com/synergycodes/ng-diagram/discussions) e [Discord](https://discord.gg/FDMjRuarFb)

## Origem e licença

Este fork deriva do
[ng-diagram AV Schematic Template](https://github.com/synergycodes/ng-diagram-av-schematic),
da Synergy Codes. A matriz de origem, revisão e estratégia de reuso está em
[`docs/license-matrix.md`](docs/license-matrix.md). O código permanece sob a
licença MIT descrita em [`LICENSE`](LICENSE).
