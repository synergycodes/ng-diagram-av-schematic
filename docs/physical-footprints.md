# Placas físicas e footprints

Esta implementação da issue #3 mantém placas, componentes e fios no mesmo
modelo e no mesmo canvas do `ng-diagram`. Não há uma segunda superfície de
desenho nem uma representação elétrica paralela.

## Modelo físico

`BoardNodeData` descreve qualquer placa retangular por `rows`, `cols`, `pitch`,
`holeDiameter` opcional, `centerGap` opcional, `notes` opcionais, uma lista
opcional de `holes` e uma lista opcional de `traces`. Sem `holes`, a placa usa
toda a grade retangular; com a lista, pode representar recortes e posições sem
furo. Cada trilha contém um ou mais segmentos horizontais ou verticais,
inclusivos, e pode declarar a net elétrica correspondente. Nenhuma função
genérica presume um formato de placa: as 63 colunas da protoboard de 830 pontos
vivem apenas no construtor dela.

`centerGap` acrescenta uma faixa vertical entre as duas metades das linhas sem
alterar os endereços dos furos. Geometria, snap, footprints e `DXF` usam a mesma
posição física; placas sem o campo preservam o arredondamento legado, inclusive
o desempate para a linha de índice maior. A placa de ensaio superior usa o mesmo
`pitch` 20 das outras placas físicas do seed.

`rowLabels` guarda o nome impresso de cada linha, de cima para baixo, com
exatamente `rows` entradas. Uma entrada vazia é uma linha sem nome — inclusive
uma linha totalmente sem furos. O endereço continua sendo `{row, col}`; o campo
só decide como ele é escrito: `J10` para uma linha de uma letra, `top+:12`
quando o nome é maior, e o `L<linha>-C<coluna>` padrão quando a placa não nomeia
nada. Por isso um projeto reaberto mostra `J10` sem precisar reconhecer a placa
como protoboard.

Uma trilha pode declarar `internal: true`. Isso descreve cobre que une furos
dentro do corpo da placa, sem pista exposta: os clipes de uma protoboard sem
solda. Ela continua sendo um único ponto elétrico e continua participando de
`holesOnSameTrace`, de `netForHole` e da junção canônica, mas é desenhada
discretamente, não recebe rótulo e não gera uma porta `trace:<id>`. Conectar a
um grupo interno significa conectar a um de seus furos — exatamente o que o
hardware permite.

A distinção entre ausência e lista vazia é deliberada: omitir `holes` significa
uma grade retangular completa, enquanto `holes: []` descreve uma placa sem
nenhum furo. Desenho, snap, placement, endpoints e validadores aplicam essa
mesma regra.

Cada furo vira uma porta `hole:<row>:<col>` do próprio nó da placa. Cada trilha
exposta também oferece uma porta `trace:<traceId>`; uma trilha `internal` não,
porque não há pista onde pousar. Assim, um fio conectado a um furo ou a uma
trilha continua sendo uma aresta comum do `ng-diagram`; o endpoint fica
registrado na própria aresta e não depende de uma tabela lateral.

No `ng-diagram` 1.3.0, essas portas usam `originPoint="centerLeft"`. A posição
CSS da caixa subtrai metade de sua altura do centro físico do furo ou pino.
Como a biblioteca ancora uma porta lateral na borda esquerda e no centro
vertical da caixa medida, `portFlowPosition` retorna exatamente a coordenada da
geometria. Um teste liga `holeLocalPoint` e a geometria rotacionada do footprint
à posição final do port para impedir regressões de meio diâmetro.

## Protoboard de 830 pontos

A placa de ensaio superior é uma protoboard física completa, e não um retângulo
genérico. `diagram/model/breadboard.ts` a constrói com o mesmo `BoardNodeData`
das demais placas:

- 63 colunas e 18 linhas de grade;
- linhas `J I H G F` acima do canal e `E D C B A` abaixo, com 63 furos cada —
  630 furos terminais;
- quatro barramentos, `top-`, `top+`, `bottom-` e `bottom+`, com 50 furos cada
  em dez grupos de cinco — 200 furos de barramento;
- 830 pontos no total, declarados como lista esparsa de furos;
- 126 grupos de coluna, dois por coluna e independentes entre si, com cinco
  furos cada, mais quatro grupos de barramento de cinquenta furos;
- duas linhas vazias separam cada par de barramentos das linhas terminais, o
  que resulta nos três passos de `pitch` da referência; o canal central usa
  `centerGap = 2 × pitch`, mantendo `F` e `E` a três passos de distância sem
  alterar o endereçamento.

Todas as trilhas dessa placa são `internal`. A régua de colunas é desenhada nas
faixas sem furos e o nome de cada linha aparece nas duas margens laterais;
barramentos terminados em `+` ou `-` ganham a linha-guia colorida convencional.
Tudo isso é derivado de `rowLabels` e da lista de furos, então nenhuma outra
placa muda de aparência.

### Superfície da placa

`BoardNodeData.surface` diz de que a placa é feita, e portanto como ela é
desenhada. Só existem dois valores:

- `perfboard` — substrato marrom furado, com o cobre exposto na face. É o valor
  padrão e o que toda placa salva antes deste campo continua sendo, então
  reabrir um projeto antigo não muda nada.
- `breadboard` — bloco de plástico claro moldado: canal central rebaixado,
  faixas coloridas atrás de cada barramento, furos e silk-screen impressos.

O campo é **persistido** — a aparência de um projeto reaberto é a que foi
salva, e o renderizador nunca deduz "830 furos, logo é protoboard" a partir das
dimensões — e é **estritamente validado** nos dois validadores: um valor fora
da união é rejeitado em vez de cair no padrão, e uma placa que declara
`breadboard` precisa carregar de fato o que o desenho lê dela (`centerGap` e
`rowLabels`, com pelo menos um barramento `+`/`-`). Sem isso ela reabriria como
um retângulo claro vazio.

`diagram/model/board-surface.ts` concentra a geometria desenhada. Toda medida é
uma razão do `pitch` da própria placa — raio do furo, altura da faixa de
barramento, distância da listra de polaridade, altura do canal, corpo do texto,
espessura dos contornos — nunca uma constante em pixels; as razões são as
proporções da referência `safaorhan/breadboard` reexpressas sobre o `PITCH = 12`
e o `HOLE_RADIUS = 3.5` dela. Uma protoboard salva em outro `pitch` volta com as
mesmas proporções.

O cobre `internal` — os clipes de coluna e os quatro barramentos — **não é
desenhado** na renderização normal, nem na tela nem no DXF. Ele continua sendo
um ponto elétrico e continua derivando nets; só não tem trilha visível nem pad
de pouso, exatamente como no plástico real. Conectar-se a um grupo interno
significa conectar-se a um dos furos dele. As perfboards seguem desenhando seu
cobre exposto, com rótulo e porta `trace:<id>`, sem nenhuma mudança.

Como não existe porta `trace:<id>` para esse cobre, **um condutor que aterrissa
em um grupo interno precisa declarar o tap** (o índice do furo do grupo em que
ele pousa). Os dois validadores rejeitam a ausência do tap: sem ele, reabrir o
projeto reconstruiria a aresta apontando para uma porta que nunca é renderizada
— um fio ligado a nada, sem erro visível. Ligações físicas (`physicalBinding`)
já fixavam o tap exato; a regra cobre todo condutor comum, inclusive um cujo
registro de layout esteja ausente.

### Canal central e footprints encaixados

Uma placa com `centerGap` não é uma grade uniforme: `holeLocalPoint` empurra
toda linha a partir do split para baixo pelo gap inteiro. Um footprint desenhado
como `cell.row * pitch` só concorda com os próprios furos enquanto fica de um
lado do canal — uma peça que atravessa o canal da protoboard de 830 pontos teria
a metade de baixo desenhada um `centerGap` inteiro acima dos furos em que os
pinos realmente estão.

`footprintChannel(board, footprint, placement)` descreve esse canal visto do anchor da
peça, e `applyFootprintChannel` aplica o mesmo mapeamento por partes **depois da
rotação** — o corte é uma linha horizontal no espaço da placa, então não pode
ser expresso pela matriz de rotação do SVG. Por isso o grupo `matrix(...)` deu
lugar a formas já transformadas ponto a ponto: retângulos pelos extremos dos
quatro cantos, linhas pelos dois extremos, círculo e texto pelo centro, e o
texto gira em torno do próprio ponto. Nada é escalado no eixo horizontal.

Consequências, todas intencionais:

- `applyFootprintChannel(0)` é sempre `0` quando a caixa de células atravessa o canal, então a
  célula (0, 0) continua colada ao furo do anchor e `placementNodePosition`
  **não recebe nenhum offset ad hoc** — ela já resolve o anchor por
  `holeLocalPoint`.
- Um footprint cuja caixa de células está inteiramente acima ou abaixo do split
  permanece rígido. Shapes que avançam para o espaço livre (inclusive textos
  com `y` negativo na primeira linha inferior) não saltam para o outro lado do
  canal nem saem do `viewBox` compartilhado por desenho e portas.
- O corpo de uma peça que atravessa o canal **é esticado pelo `centerGap`**, e o
  box do nó cresce junto. É o que o contrato atual `hole = anchor + rotatedCell`
  significa: as duas metades da peça estão a três passos de distância na placa.
  Fidelidade metrológica maior (offsets físicos por pino, independentes de
  `FootprintCell`) é assunto da issue #31 e não deste caminho.
- O `centerGap` inteiro é o que desloca. O canal mais estreito que o plástico
  _pinta_ (`boardChannelRect`) é detalhe de superfície e nunca entra nessa
  geometria.
- O exportador DXF consome exatamente as mesmas funções, então o desenho
  concorda com a tela em rotação, pitch e canal.

A propriedade garantida, testada em `model/footprint-channel.spec.ts` para as
quatro rotações, atravessando e não atravessando o canal, em placa sem gap e com
gap fracionário:

```
node.position + pinView == board.position + holeLocalPoint(board, pinHole)
```

O `pitch` é a única escala: largura, altura, canal, marcações e o encaixe de
qualquer footprint saem dele, sem número de pixels fixado na geometria física.
Com 830 furos, o nó da placa expõe 830 portas de furo; é o maior caso previsto
para a estratégia atual de portas materializadas, e placas ainda maiores
exigiriam portas sob demanda.

A geometria — ordem das linhas, os três passos ao redor do canal e a fórmula das
colunas de barramento — foi adaptada do projeto MIT `safaorhan/breadboard`, na
revisão `db5f279`. O registro de licença está em
[`license-matrix.md`](license-matrix.md).

## Footprints e encaixe

As definições em `diagram/model/footprint.ts` usam unidades de furo, não
pixels. Elas descrevem caixa, pinos e formas vetoriais originais. O tamanho em
pixels é derivado do pitch da placa no momento da renderização.

O catálogo desse arquivo serve para criar itens da paleta e para nós legados
que ainda vivem apenas em memória. Ao salvar um componente físico, sua
definição de footprint é incorporada ao próprio projeto. Um arquivo também
pode declarar uma definição inédita seguindo o mesmo esquema; portanto, a
reabertura não depende das fixtures nem exige que o footprint já exista no
catálogo da aplicação.

Um componente encaixado persiste `footprintId` e `placement`, formado por:

- `boardId`: placa na qual a peça está encaixada;
- `anchor`: furo que recebe o canto superior esquerdo da caixa já rotacionada;
- `rotation`: `0`, `90`, `180` ou `270` graus.

O template `FootprintNodeComponent` desenha a ilustração e posiciona as portas
elétricas sobre os pinos. Os botões no próprio componente giram a peça em
passos de 90 graus.

Ao terminar um arraste, `BoardPlacementService` calcula o furo mais próximo,
valida limites e ocupação e grava a posição derivada do encaixe. Uma posição
ilegal é recusada, o componente volta ao último encaixe válido e os furos em
conflito são destacados. Ao mover uma placa, seus componentes encaixados são
reposicionados a partir das âncoras, sem acumular erro de pixels.

Arrastar um componente encaixado para fora de todas as placas o desencaixa: o
footprint incorporado permanece disponível, mas `placement`, `boardId` e os
furos derivados são removidos. O componente continua usando o renderer físico,
com seus pinos conectáveis, e preserva a última rotação e o último pitch em
`footprintRotation` e `footprintPitch`; seus fios, nomes de rede e trechos
manuais também são preservados. Ao voltar para uma placa compatível, ele usa
essa rotação para calcular o novo encaixe.

Quando corpos de placas se sobrepõem, um placement existente permanece na sua
placa enquanto ela ainda contém o ponto. Para um componente novo, vence a menor
placa, seguida por `boardId` e pelo ID do nó como critérios estáveis. Assim, a
escolha não depende da ordem do array após uma reabertura.

O snap de cada placa e de seus componentes usa o `pitch` daquela placa, sem
presumir 20 pixels. A rotação mantém o primeiro pino sobre o mesmo furo e
calcula a nova âncora apenas com coordenadas inteiras da grade; quatro giros
retornam exatamente ao estado inicial, inclusive com pitch fracionário ou
diferente do valor das fixtures.

Depois do snap, da rotação ou do movimento da placa, as extremidades das
arestas são ancoradas novamente nos ports medidos. Rotas manuais ortogonais
preservam os trechos intermediários que continuam válidos. A mesma atualização
das âncoras ocorre depois da remontagem do modelo salvo, quando os novos nós e
ports já foram medidos.

A associação física em runtime segue `pino -> furo -> trilha`. Uma nova aresta
sem nome autoral recebe o nome declarado pelo cobre como sugestão inicial. Um
nome importado ou editado pelo usuário nunca é substituído silenciosamente:
ele tem prioridade, e uma divergência em relação ao cobre aparece como aviso no
relatório **Diagnóstico físico**. Essa divergência continua salvável. Já uma
aresta que uniria dois cobres com nomes físicos distintos representa um curto e
é recusada; na reconexão, a extremidade permanece pendente no ponto tentado. A
inspeção lateral também mostra os endereços de furos e os nomes de trilhas.

Os ports de um componente encaixado são derivados do footprint e da placement.
O editor genérico continua disponível para fabricante, modelo, categoria e
local, mas apresenta os pinos físicos como somente leitura e não pode trocar
seus IDs nem seus furos.

O formato `DXF` registra `BoardNode` e `FootprintNode` em layers próprias. Contorno,
furos, trilhas, pinos e formas do footprint são exportados com o pitch e a
rotação físicos; endpoints de fios nessas entidades permanecem exatamente no
centro medido. A pequena extensão visual usada por cartões genéricos não é
aplicada a endpoints de placa ou footprint.

## Persistência

O projeto usa o formato canônico v4, evolução compatível do v3 introduzido pela issue #29. A seção
`electrical` continua contendo componentes, junções, cabos, nets multi-drop e
condutores; a seção `layout` contém placas, footprints, placements e geometria.
Não existe `CanonicalNet` v1 paralelo. Snapshots v1 anteriores continuam sendo
migrados pela fronteira de entrada existente.

Os campos físicos opcionais são:

- placas preservam `holes`, `holeDiameter`, `centerGap`, `rowLabels`, `notes` e
  `traces`, e cada trilha preserva `internal`;
- componentes físicos preservam `footprintId`, a definição `footprint` e
  `placement`; quando desencaixados, `footprintRotation` e `footprintPitch`
  mantêm a geometria visual sem fingir que ainda existe um encaixe;
- a junção de cobre usa `boardId` e `boardPort` no layout;
- um jumper local usa `boardJumper: { boardId, bends? }`; os endpoints são
  derivados dos furos/taps e somente as dobras intermediárias usam coordenadas
  locais da placa;
- um condutor oculto `binding:<componentId>/<pinId>` associa cada pino encaixado
  à junção canônica de seu furo ou de sua trilha.

Snapshots canônicos v2 salvos antes da introdução de `footprintRotation` e
`footprintPitch` não contêm a geometria anterior de um footprint desencaixado.
Na primeira abertura por uma versão nova, esses componentes usam uma única vez
a rotação `0` e o pitch de fallback `20`, podendo mudar de tamanho; depois do
primeiro encaixe, giro ou desencaixe, a geometria estabilizada elimina novos
redimensionamentos, inclusive nos salvamentos seguintes.

Os endpoints elétricos v2 permanecem apenas `pin` e `junction`. Furos de uma
mesma trilha apontam para uma única `CanonicalJunction`; o índice `fromTap` ou
`toTap` preserva o furo visual específico. Assim, salvar e reabrir conserva a
associação pino-furo-trilha sem inventar outro tipo elétrico e sem separar uma
net multi-drop.

O nome autoral da net tem prioridade determinística sobre o rótulo de cobre. O
cobre só nomeia grupos ainda sem autoria. O relatório físico registra a
divergência com caminho canônico e ação sugerida, mas ela não invalida todo o
projeto. Curto entre cobres distintos, referência inexistente e grafo de
binding incoerente continuam sendo erros estruturais.

Uma importação WireViz de substituição mantém os bindings físicos dos
componentes reaproveitados e reagrupa os condutores com o mesmo algoritmo. Se
duas redes importadas de nomes distintos passam a compartilhar o cobre já
montado, o menor nome em ordem lexical vence, e o relatório WireViz emite
`physical-net-reconciled` com os nomes envolvidos e a ação de revisão. Assim,
a reconciliação é determinística sem apagar a divergência silenciosamente.

O validador do frontend e o validador do serviço local aplicam as mesmas regras:
footprint incorporado e coerente com o ID, placement em placa existente, cells
em furos realmente presentes, ausência de colisões, pinos expostos presentes
na definição, trilhas ortogonais sem sobreposição e vínculos elétricos
determinísticos. Durante o parse, furos dos pinos e posição em pixels são
recalculados a partir de `placement`.

No modelo em runtime, o ID de um nó de placa deve ser igual ao seu `boardId`;
o exportador canônico recusa o snapshot se essa identidade tiver divergido. Um
corpus adversarial compartilhado é executado pelos validadores TypeScript e
Node para manter equivalentes as regras duplicadas até a unificação futura.

Para manter o canvas responsivo e limitar entradas não confiáveis, o formato
aceita no máximo 128 linhas, 256 colunas, 4.096 furos por placa, `pitch` 256,
`centerGap` 256, 512 trilhas, 4.096 segmentos por placa, footprints de 64 × 64
e 512 formas. Uma grade completa acima de 4.096 furos deve declarar uma lista
esparsa explícita. Quando presente, `centerGap` precisa ser positivo; zero deve
ser omitido.

## Autoria nesta fatia

O usuário pode mover, girar, encaixar e desencaixar footprints, editar os dados
usuais do componente e conectar pinos, furos ou trilhas. Definições arbitrárias
de placa e footprint são persistidas e validadas pelo JSON canônico e podem ser
fornecidas por fixtures ou integrações. Esta entrega não inclui um desenhador
gráfico geral para criar novos contornos, furos, trilhas e formas SVG do zero;
esse limite é de interface de autoria, não do modelo nem da persistência.

## Fixtures

`diagram/fixtures/physical-boards.fixture.ts` inclui:

| Placa                 | Dimensão | Conteúdo demonstrado                                                                           |
| --------------------- | -------: | ---------------------------------------------------------------------------------------------- |
| Placa A               |   6 × 11 | seis trilhas de distribuição                                                                   |
| `Protoboard superior` |  18 × 63 | protoboard de 830 pontos, canal central, quatro barramentos e capacitores bulk já incorporados |
| Placa de origem       |   6 × 28 | perfboard sem trilhas                                                                          |
| Peça E                |    6 × 3 | divisor de nível do UART e jumper                                                              |
| Peça G                |    6 × 4 | distribuição da base                                                                           |

As antigas peças D e F e seus capacitores não fazem mais parte do seed: os dois
bulk pertencem à placa de ensaio superior já montada. O seed preserva as peças E e
G, seus resistores, um TB6612FNG encaixado e componentes externos ligados
diretamente a furos ou trilhas.

Os dois jumpers de sinal saíam dos furos documentados `L4-C18` e `L2-C18` da
antiga placa 6 × 18, uma linha abaixo e uma linha acima do canal. Na protoboard
de 830 pontos eles passam a sair de `E18` e `I18`, que preservam essa posição
relativa ao canal e caem em grupos de coluna diferentes — portanto continuam
sendo dois sinais independentes. Como a fonte não identifica os pinos de
destino, cada jumper termina em uma junção conectável de um tap, rotulada como
terminal provisório junto ao Nano ou à TB6612. Essas junções sobrevivem ao round-trip sem compartilhar os pinos `D8`
ou `STBY` e, portanto, sem fundir ou renomear as nets existentes.

As ilustrações foram desenhadas neste repositório com formas SVG simples. Não
foram incorporados assets nem trechos de código de catálogos externos.
