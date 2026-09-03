# Edição de rotas e endpoints de fios

Os fios globais do canvas são arestas ortogonais; jumpers da protoboard são
polilinhas livres, inicialmente retas. Ambos podem ser editados e reconectados,
mas somente fios globais podem ficar com uma extremidade solta. São três funcionalidades separadas: a
edição de rota segue o pipeline interação → comando → middleware → modelo; a
reconexão e a criação de fios pendentes mantêm ciclos próprios e compartilham
somente a geometria pura.

Há duas formas de roteamento:

- automático: o `ng-diagram` calcula o traçado e o projeto não persiste pontos;
- manual: a ligação possui `routingMode: 'manual'` e uma lista explícita de
  `points` em `layout.conductors` do `CanonicalProjectV4` para fios globais;
- jumper local: `boardJumper` persiste apenas `boardId` e as dobras intermediárias
  locais; os endpoints continuam derivados dos furos.

A rota pertence ao condutor selecionado. Restaurar um fio global remove
`routingMode` e `points`; restaurar um jumper remove suas dobras e volta à reta
entre os dois furos. Cor, owner, metadados, endpoints e as demais ligações da net
permanecem intactos.

## Interações disponíveis

Ao selecionar um fio, o overlay apresenta controles de segmento e de dobra:

- arrastar o controle no meio de um segmento desloca o segmento no eixo
  perpendicular;
- clicar duas vezes em um segmento, ou usar `Enter`/`Espaço` no controle,
  insere um desvio ortogonal com novas dobras;
- arrastar o controle de uma dobra desloca o vértice e os trechos incidentes;
- clicar duas vezes, usar o botão direito, `Delete` ou `Backspace` em uma dobra
  remove o menor conjunto de vértices que ainda mantém a rota ortogonal;
- arrastar o anel de uma extremidade vincula o fio a outra porta ou deixa a
  extremidade solta quando ela é liberada no fundo do canvas.

O snap usa a mesma configuração da grade aplicada aos nodes. Com snap ativo,
dobras, segmentos e extremidades soltas são alinhados à grade; com snap
desativado, o movimento permanece livre.

No jumper, cada segmento oferece inserção de uma dobra livre e cada ponto
intermediário pode ser arrastado ou removido. O gesto preserva a polilinha sem
ortogonalizá-la e não aplica o grid global. Arraste de node, dobra, segmento ou
endpoint abre um único grupo de histórico; todos os frames do gesto viram um só
passo de undo.

## Nova ancoragem e simplificação

Mover um componente ou uma junção não recalcula todo o caminho manual. O
middleware `edge-stretch-on-move` relê a posição atual da porta, ancora a
extremidade e preserva os trechos internos válidos. Quando necessário, ele
insere uma dobra em L junto à porta para evitar uma diagonal.

O relink segue a mesma regra: o caminho é reconstruído a partir dos pontos do
início do gesto, portanto erros não se acumulam a cada evento de ponteiro. A
simplificação acontece somente no fim do gesto, quando dobras colineares e
passagens redundantes podem ser removidas sem mudar a prévia mostrada.

A tolerância de coordenadas e a normalização são compartilhadas por três
fronteiras:

- geometria interativa em `edge-reshaping/logic`;
- parser e serializador canônicos do cliente;
- validador do serviço local.

O módulo comum `diagram/model/persisted-wire-route.mjs` impede que uma rota
produzida pelo editor seja recusada ao salvar ou abrir. Uma rota v2 manual sem
ao menos dois pontos é inválida. Em snapshots v1, pontos ortogonais antigos sem
`routingMode` são recuperados como rota manual; somente uma geometria legada
malformada é descartada, fazendo aquela ligação voltar ao automático sem
rejeitar o projeto inteiro.

## Organização

```text
diagram/
├── edge-reshaping/
│   ├── directives/       captura de gestos
│   ├── handlers/         estado do gesto e tradução para comandos
│   ├── commands/         única superfície de escrita da edição de rota
│   ├── middleware/       nova ancoragem quando os nós se movem
│   ├── logic/            geometria ortogonal pura
│   └── edge-reshape-overlay.component.*
├── edge-relinking/       arraste e reconexão de extremidades
└── dangling-edge-creation/ criação de ligação com uma ponta solta
```

O diretório `logic/` não acessa DOM nem modelo. Os handlers controlam o gesto e
o dispatcher aplica comandos tipados ao `NgDiagramModelService`. Relink e
criação de ponta solta mantêm seus próprios ciclos de escrita, mas reutilizam
as mesmas funções puras de snap, posição de porta e reconstrução ortogonal.

## Cobertura de regressão

Arestas com `routingMode: 'manual'` e `points` explícitos são responsáveis pelo
próprio caminho; arestas automáticas são roteadas pelo ngDiagram. As três
funcionalidades fixam a aresta no modo manual quando passam a controlar sua
geometria.

Os testes exercitam inserção, deslocamento e remoção de dobras, snap, redução
de segmentos redundantes, relink, nova ancoragem ao mover nós e persistência da
rota no condutor correspondente. Os testes canônicos e do serviço também
cobrem o contrato `manual + points`, a tolerância compartilhada e a migração
segura de projetos v1.

Os testes Node e o build devem ser executados pelo fluxo serializado de
verificação do projeto; este documento não pressupõe que tenham sido rodados
em cada edição isolada de worktree.

## Limites conhecidos para portar ao núcleo do ngDiagram

O diretório `logic/` importa somente tipos do `ng-diagram` e é a unidade
planejada para migração. Três pontos ainda dependem do contexto da aplicação:

- `resolveEdgeGrid` reaproveita `shouldSnapDragForNode`, pois ainda não existe
  uma configuração de snap específica para arestas;
- `portFlowPosition` lê `measuredPorts[].side`, mas ancora apenas nas laterais
  esquerda e direita;
- o dispatcher local emula o pipeline de comandos, pois o ngDiagram ainda não
  expõe uma API pública para registrar comandos e middlewares.
