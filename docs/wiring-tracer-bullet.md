# Tracer bullet de fiação (issue #1)

Notas de implementação da [`talus-wiring-editor#1`](https://github.com/felipedruzian/talus-wiring-editor/issues/1),
a primeira fatia executável do editor de fiação física descrito na
[`talus-core#339`](https://github.com/felipedruzian/talus-core/issues/339). Este
documento registra a decisão de integração exigida pelos critérios de
aceite — como a placa física, os componentes ilustrados, as nets importadas
do WireViz e o roteamento manual de fios coexistem no **único** canvas
`ng-diagram` — e o que fica explicitamente pendente ou fora do escopo desta
fatia.

## Recapitulando o objetivo

Ao carregar, um único canvas mostra:

- Placa A, uma grade de furos endereçáveis de 6 x 11.
- Um Arduino Nano e um breakout TB6612FNG, ilustrados e posicionados sobre a
  placa.
- Duas nets, criadas por uma importação real de um fixture YAML WireViz
  mínimo no momento de construção do modelo (não são edges escritas à mão
  que apenas coincidem com esse resultado).
- Fios ortogonais e coloridos, um dos quais tem uma dobra manual para provar
  que o roteamento editável de edges continua funcionando sobre fios
  importados.

Tudo isso é exercitado por `src/app/av-schematic/diagram/data.ts`, o seed com
que o app inicializa.

## Decisão de integração: um canvas, duas peças novas, o resto reaproveitado

A restrição rígida desta fatia é **nenhum segundo canvas e nenhuma
representação elétrica paralela** — o modelo `Node`/`Edge` do `ng-diagram`
precisa continuar sendo a única fonte de verdade. Duas opções estavam na
mesa:

1. Construir uma família de tipos de node/edge inteiramente nova para o
   domínio físico (placa, pino, footprint) paralela aos tipos existentes
   `DeviceNodeData` / `WireEdgeData` do AV, conectando-a em todos os
   subsistemas (barra lateral de propriedades, paleta de biblioteca,
   exportação `DXF`).
2. Adicionar o **mínimo de tipo novo** que o domínio realmente precisa — uma
   placa — e estender os tipos **existentes** `DeviceNodeData` /
   `DevicePort` / `WireEdgeData` com campos opcionais, de modo que o Nano e
   o TB6612FNG sejam nodes de dispositivo comuns que carregam, além disso,
   endereços de furo na placa e metadados de net derivados do WireViz.

**Decisão: opção 2.** Concretamente:

- **`BoardNodeData`** (`type: 'board'`, `NodeTemplateType.BoardNode`) é um
  tipo de node novo, renderizado por `diagram/node/board-node.component.*`
  — uma grade de furos em SVG dimensionada a partir de `rows` / `cols` /
  `pitch`. Não carrega portas e não está conectado à barra lateral de
  propriedades nesta fatia (ver "Pendente" abaixo). Compartilha exatamente
  o mesmo array `Node[]`, o mesmo espaço de coordenadas e a mesma ordem de
  z-index de qualquer outro node — o "mesmo plano, mesmo canvas" decorre
  disso de graça, sem virar um caso especial em nenhum outro ponto da pilha.
- **Nano e TB6612FNG são nodes `DeviceNodeData` comuns.** Essa foi a decisão
  de maior alavancagem desta fatia: todo subsistema existente — barra
  lateral de propriedades (`device-form`), exportação `DXF`
  (`export/dxf-av-schematic/device-node-renderer.ts`), a paleta de
  biblioteca, `generateDeviceId`, o guard `isDeviceNode` — já entende esse
  tipo e não precisou de **nenhuma alteração** para continuar funcionando
  com os nodes novos. O card mantém exatamente a mesma marcação genérica
  (cabeçalho + duas colunas de portas) usada por qualquer outro dispositivo
  AV — nenhum tipo de node novo, nenhuma mudança de schema. O que muda é
  puramente visual: `DeviceNodeComponent` delega ao
  `DeviceIllustrationComponent`, que deriva um `DeviceIllustrationId` a
  partir de `manufacturer`/`model`. `resolveDeviceIllustration()` reconhece
  os seis componentes atuais do Talus-Droid — Arduino Nano, Raspberry Pi 4,
  MPU6050/GY-521, TB6612FNG, LM2596S e Hall A3144/LM393 — e renderiza para
  eles uma ilustração SVG/CSS original. Qualquer dispositivo sem uma
  correspondência estrita recebe `null` e continua renderizando o card
  genérico sem alteração. Ainda não é uma ilustração literal de pinagem
  DIP/header (ver "Pendente" abaixo); é a prova visual delimitada que a
  issue #1 pede, não o sistema geral de footprints da issue #3.
- **`DevicePort` ganhou um campo opcional: `hole: { row, col }`.** Esse é o
  requisito de "pinos/furos endereçáveis" — todo pino que deve se alinhar a
  um furo da placa carrega um endereço de grade determinístico. É aditivo e
  opcional, então todo seed/item de biblioteca AV já existente (nenhum dos
  quais define `hole`) permanece intocado, e as atualizações por
  object-spread do editor de portas
  (`shared/ui/ports-editor/ports-editor.component.ts`) preservam o campo
  automaticamente através de edições na barra lateral, sem precisar de
  alteração de código ali.
- **`WireEdgeData` ganhou três campos opcionais: `netId`, `color`,
  `colorCode`.** `color` é consumido diretamente por
  `wire-edge.component.ts` em `strokeColor` (caindo de volta ao token
  `--av-color-wire-stroke` existente quando ausente), então fios AV
  continuam renderizando exatamente como antes e fios importados do WireViz
  renderizam na cor importada. `wireDataToFormData` /
  `formDataToWireData` (`properties-sidebar/components/wire-form/*`)
  também preservam esses campos por spread ao longo de edições na barra
  lateral.

O resultado líquido: o diff sobre subsistemas já publicados é um punhado de
campos opcionais e um novo registro de node-template
(`diagram/diagram.component.ts`); nada precisou ser ensinado sobre
"físico" vs. "AV". É isso que "evite refatoração ampla" significou na
prática aqui.

### O que "encaixados" (fitted onto the board) significa nesta fatia

`hole` é **metadado de endereçamento, ainda não uma projeção de renderização
por pino**. O card do node de dispositivo continua distribuindo suas portas
no layout de duas colunas padrão; ele ainda não posiciona cada porta
individual no pixel exato do seu furo na placa.
`diagram/model/board-geometry.ts` fornece a função pura `holeLocalPoint()`
que faria essa projeção — ela já é usada hoje por `board-node.component.ts`
para desenhar a própria grade de furos, e é o gancho que uma fatia futura
usaria para encaixar visualmente os pinos de um componente sobre os furos
da placa (arrastar-para-encaixar, detecção de colisão, etc.).

O que esta fatia faz no nível do node: `diagram/data.ts` posiciona os dois
nodes de componente de modo que seus footprints de card (agora compactos e
ilustrados) se sobreponham à própria caixa delimitadora renderizada da
placa A no plano visual, e `nodes` mantém a placa primeiro na ordem do
array para que ela fique atrás dos dois componentes na pilha (ver
`NgDiagramConfig.zIndex` em `diagram.component.ts`) — "sobre a placa, placa
atrás" sem um segundo canvas nem uma imagem de fundo. Todo pino usado pelas
nets importadas ainda carrega um endereço de furo real, relativo à placa. O
que fica pendente é a projeção por pino: `holeLocalPoint()` não está
conectada a onde cada porta individual é renderizada dentro do card, então
"encaixado" aqui significa posicionamento do node sobre a placa, não
alinhamento pino-a-furo. `findOutOfBoundsHoleClaims()` / `findHoleCollisions()`
(também em `board-geometry.ts`) são as checagens puras que mantêm esses
endereços honestos: todo furo semeado precisa caber na sua placa e nenhum
par de pinos pode reivindicar o mesmo furo, ambas comprovadas contra o seed
real em `board-geometry.spec.ts`.

## Pipeline de importação WireViz

```
minimal-two-nets.fixture.ts (texto YAML)
  -> wireviz-yaml.ts        parseYamlSubset()      valor genérico do subconjunto YAML
  -> wireviz-model.ts       parseWireVizDocument()  WireVizDocument validado
  -> wireviz-to-diagram.ts  wirevizToElectrical()  CanonicalElectrical
  -> canonical-project.ts   fromCanonicalProject()  Node[] + Edge[]
```

`diagram/data.ts` executa esse pipeline sobre os nodes semeados de
Nano/TB6612FNG durante a inicialização do módulo — as duas nets exibidas ao
carregar são uma importação real, não edges copiadas à mão. Ver
[`docs/wireviz-import-limits.md`](wireviz-import-limits.md) para exatamente
o que o parser aceita e rejeita, e por que é uma implementação clean-room
em vez de código adaptado do `Garth-42/WireForm` (GPL-3.0 — ver
[`docs/license-matrix.md`](license-matrix.md)).

O casamento pino-porta considera designador WireViz preservado, label e id
local. O resultado precisa identificar exatamente um pino; colisões são
rejeitadas em vez de selecionar a primeira ocorrência. O nome de um conector
no fixture mapeia para o id de um node do diagrama através de um registro
explícito `WireVizPlacement`
(`{ NANO: 'nano-1', TB6612FNG: 'tb6612-1' }`) — o importador nunca tenta
adivinhar a identidade do node a partir do nome do conector.

## Formato canônico que pode ser serializado

`diagram/model/canonical-project.ts` define `CanonicalProjectV4`, serializado
em JSON e independente dos tipos de runtime `Node`/`Edge` do `ng-diagram`.
A seção `electrical` contém componentes, junções, cabos e nets; `layout`
contém placas, posições, furos, taps e rotas manuais. Essa separação, adicionada
pela issue #2, impede que uma exportação WireViz confunda semântica elétrica
com geometria que o formato não representa. `toCanonicalProject()` /
`fromCanonicalProject()` são funções puras de ida e volta, enquanto
`parseCanonicalProject()` aceita v4 e migra snapshots v1/v2/v3 em memória.

`canonical-project.spec.ts` cobre placas, componentes, pinos, nets, cores,
rotas manuais, junções multi-drop e migração v1. O contrato de round-trip da
issue #2 está detalhado em
[`docs/wireviz-round-trip.md`](wireviz-round-trip.md).

Este é o formato que o serviço local (ver
[`docs/local-service.md`](local-service.md)) valida, normaliza e persiste como o
arquivo JSON de um projeto.

## Salvar e Abrir: o que já está implementado

Diferente de uma versão anterior deste documento, esta fatia **já conecta**
o formato canônico à interface: `src/app/av-schematic/project-storage/`
adiciona `ProjectStorageService` (chama `GET`/`PUT` em
`/api/projects/:id` do próprio serviço local — ver
[`docs/local-service.md`](local-service.md)) e
`ProjectStorageMenuComponent` (campo de id de projeto + botões Salvar/Abrir,
acessível, na barra de navegação superior, ao lado do menu de exportação). O fluxo:

- **Salvar** lê o modelo confirmado via `NgDiagramModelService.getModel()`
  (não os sinais `nodes()`/`edges()`, que podem estar momentaneamente
  desatualizados), serializa com `toCanonicalProject()` e faz `PUT` do JSON
  resultante.
- **Abrir** faz `GET`, valida a resposta com `parseCanonicalProject()` (a
  mesma validação estrutural usada pelo servidor antes de gravar em disco —
  ver "Validação" em `docs/local-service.md`) e substitui o modelo inteiro
  usando apenas as operações públicas em lote de `NgDiagramModelService`
  (remove edges, remove nodes, adiciona nodes, adiciona edges — nessa
  ordem, para nunca deixar uma edge apontando para um node que ainda não
  existe).
- O id do projeto é validado no cliente contra o mesmo padrão
  (`^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$`) que o servidor exige, antes mesmo
  de sair do navegador.

Isso cobre o critério de aceite "um projeto salvo em um navegador pode ser
reaberto em outro cliente da Tailnet pela persistência central do serviço"
**no nível do cliente e do formato de dados**: o round-trip
model -> canônico -> JSON -> canônico -> model é testado automaticamente
(`canonical-project.spec.ts`). A prova com dois navegadores fisicamente
distintos na Tailnet depende do ambiente implantado e permanece como gate
operacional posterior; não foi executada nesta worktree.

## Importar, exportar e inspecionar WireViz na interface

A barra superior agora liga o pipeline a fluxos reais: seleciona um arquivo
YAML, carrega o fixture multi-drop, baixa a exportação WireViz e abre o
relatório global da última operação. A importação usa somente a identidade e
o placement do projeto vivo como esqueleto, substitui o modelo pelo resultado
validado e não reaproveita metadados WireViz capazes de mascarar uma perda.

O fixture inclui um trilho de fan-out utilizável, referências de condutor por
número, `wirelabel` e cor, além de um cabo `SPARE` desconectado com posições
sem uso e RGB de seis dígitos. A junção/trilho pode ser selecionada no canvas;
a barra lateral permite editar nome, representação, taps e observação e
inspecionar id, net e a semântica comum de todos os taps.

## Verificação e implantação operacional

Este repositório produz e testa a aplicação, mas deliberadamente não altera
o estado do homeserver. A instalação como unidade systemd de usuário, a
release imutável, o armazenamento central, a publicação via Tailscale Serve
e o round-trip pela Tailnet são implementados e verificados pela integração
operacional versionada no `talus-core`.

Essa separação evita esconder mutações do host dentro de `npm run build` ou
do servidor da aplicação. O estado corrente da implantação e suas
evidências devem ser consultados na issue/PR correspondente, enquanto este
documento permanece como contrato técnico do tracer bullet.

## Fora do escopo desta fatia (isso sim, deliberadamente)

Itens que continuam fora por decisão de escopo,
não por falta de autorização: edição via barra lateral de propriedades
para nodes de placa (dimensões, espaçamento de furos); uma ilustração
literal e fiel de pinagem DIP/header para Nano/TB6612FNG (a representação
atual é uma variante visual compacta e distinta do card AV genérico — ver
a seção "encaixados" acima — não um footprint fiel à folha de dados do
componente); encaixe visual de cada pino individual de componente sobre seu
furo exato na placa (`holeLocalPoint()` existe e o posicionamento do node já
sobrepõe a placa, mas ainda não está conectado ao posicionamento por pino);
exportação `DXF` para nodes de placa (cai no aviso "nenhum renderer
registrado" do `DxfExporter` e é ignorado — inofensivo, mas nodes de placa
ainda não aparecem na exportação `DXF`); autogeração/templates completos do
WireViz, shields como conectividade e bundles além do subconjunto documentado;
e suporte a
múltiplos usuários simultâneos gravando o mesmo projeto (o servidor local
resolve concorrência apenas ao nível do `rename()` atômico do sistema de
arquivos — ver `docs/local-service.md`).

## Fontes consultadas

- [`felipedruzian/talus-wiring-editor#1`](https://github.com/felipedruzian/talus-wiring-editor/issues/1)
  — issue pública, título e critérios de aceite conferidos via
  `gh api repos/felipedruzian/talus-wiring-editor/issues/1` em 2026-08-27.
- [`felipedruzian/talus-core#339`](https://github.com/felipedruzian/talus-core/issues/339)
  — issue-pai pública, conferida da mesma forma na mesma data.
- Repositório e código-fonte desta fatia (`src/app/av-schematic/diagram/`,
  `src/app/av-schematic/wireviz-import/`, `src/app/av-schematic/project-storage/`,
  `server/`) — lidos diretamente, não descritos de memória.
