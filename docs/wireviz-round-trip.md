# Round-trip WireViz e projeto canônico v4

## Contrato persistido

`CanonicalProjectV4` possui `formatVersion: 4` e duas seções independentes:

- `electrical`: componentes, junções, cabos e nets com seus endpoints e
  condutores, inclusive cor e metadados próprios de cada ligação;
- `layout`: placas, posições, furos, taps visuais e rotas manuais.

O WireViz importa e exporta somente `electrical`. Abrir ou exportar um projeto
não precisa apagar geometria, pois ela nunca é confundida com o documento
elétrico. O parser aceita snapshots v1, v2 e v3 e os migra em memória; fios v1 que
compartilham um pino são reunidos pela conectividade em uma única net v2.

## Jumpers locais da protoboard

Um jumper é um condutor elétrico comum cuja geometria ganha o marcador
`layout.conductors[].boardJumper: { boardId, bends? }`. O `boardId` é a identidade
de domínio `BoardNodeData.boardId`, não o id transitório do node. A lista opcional
contém somente dobras intermediárias em coordenadas locais da placa; os dois
endpoints são derivados dos endpoints elétricos, dos taps e dos furos associados.
Assim não existem cópias concorrentes das posições dos furos no JSON.

O trajeto inicial é uma polilinha reta de dois pontos. Ao mover a protoboard, o
runtime translada endpoints e dobras em conjunto; ao salvar, remove novamente a
posição da placa e persiste apenas as dobras locais. A exportação WireViz mantém o
jumper como condutor comum e registra um diagnóstico informativo porque owner e
geometria local não possuem equivalente no YAML.

## Net, junção e fan-out

Uma net é um componente conexo do grafo de condutores. Ela contém a lista de
endpoints distintos e os condutores que os unem. Um endpoint pode receber
vários condutores dentro da mesma net; isso representa fan-out, não colisão de
porta.

Junções e trilhos são um único ponto elétrico. A diferença entre ambos é
visual. Na exportação, os dois usam um conector WireViz de um pino com
`style: simple`; a quantidade de taps do trilho permanece em `layout`.

Os pares de `loops` de um conector são conectividade interna, não geometria.
Cada par é modelado como condutor interno identificado por `wirevizLoop`,
participa do agrupamento da net e é reemitido em `connectors.<nome>.loops`.

O inventário de cabos também é independente das arestas do canvas. Assim, um
cabo inteiramente desconectado e as posições sem uso de um cabo parcialmente
conectado continuam em `electrical.cables`, com cores e `wirelabels`, mesmo
quando não existe uma aresta onde esses dados poderiam ser pendurados.

## Compatibilidade sem perda silenciosa

O resultado de importação e exportação inclui um relatório ordenado com
severidade, código, caminho e mensagem. Ele registra:

- campos desconhecidos preservados ou reemitidos;
- semânticas reconhecidas, mas não modeladas;
- nets multi-drop, junções e loops detectados;
- redes importadas com nomes distintos que o cobre físico existente reúne,
  incluindo o nome escolhido deterministicamente e a ação de revisão;
- remapeamentos necessários de nomes ou designadores;
- geometria e metadados locais sem equivalente WireViz;
- formas de cor locais que o WireViz não representa.

Uma cor WireViz RGB com exatamente seis dígitos, como `"#a1b2c3"`, é
preservada e reemitida com a mesma grafia. Uma forma CSS diferente, como
um valor com alfa ou uma cor nomeada, nunca é aproximada: ela continua no
projeto canônico, o YAML deixa a posição sem cor e o relatório contém
`color-not-representable`.

Bitola, comprimento e observação pertencem a cada condutor no editor. Como o
WireViz oferece esses campos somente no cabo, a exportação os escreve quando
os condutores do cabo concordam. Se houver divergência, o YAML omite o campo e
o relatório usa `field-not-representable`; o projeto canônico conserva todos
os valores individuais.

## Equivalência elétrica

`electrical-equivalence.ts` cria um snapshot normalizado. Coleções e campos
preservados são ordenados, endpoints de cada condutor não têm direção e ids de
condutor/net derivados não participam da comparação. A equivalência inclui
conectividade, loops, pinos, variantes de conector e o inventário completo de
cabos: quantidade de posições, posições não usadas, `wirelabels`, bitola,
cor, comprimento, observações e campos preservados. Remover um cabo
desconectado agora é uma diferença elétrica detectável.

Posições, furos, taps, rotas e a escolha visual entre trilho e junção ficam
fora da comparação elétrica. Assim, reordenar conjuntos ou chaves no YAML não
altera o resultado, enquanto perder um atributo elétrico altera.

## Entradas principais

- `import-wireviz.ts`: texto YAML para documento, elétrica e relatório.
- `export-wireviz.ts`: elétrica para YAML e relatório.
- `canonical-project.ts`: modelo v4 e conversão para/de `Node`/`Edge`.
- `canonical-project-parse.ts`: validação v4 e migração de snapshots v1/v2/v3.
- `net-grouping.ts`: agrupamento determinístico por conectividade.
- `electrical-equivalence.ts`: comparação independente de ordem textual.

O subconjunto exato e suas limitações estão em
[`wireviz-import-limits.md`](wireviz-import-limits.md).

## Fluxos na interface e prova de round-trip

A barra superior oferece quatro ações reais: importar um arquivo `.yml` ou
`.yaml`, carregar o fixture multi-drop, baixar uma exportação WireViz e abrir
o relatório global da última operação. A importação substitui o projeto vivo
via `ProjectStorageService`; a exportação lê o snapshot confirmado do mesmo
serviço. A junção/trilho criada pelo fixture é selecionável e seus campos de
nome, representação, taps e observação são editáveis na barra lateral, que
também mostra id, net e a semântica elétrica compartilhada dos taps.

O mesmo relatório global recebe os avisos de cores personalizadas gerados no
fluxo real de `export-wireviz.ts`. Não existe um coletor paralelo de canvas que
possa divergir do YAML efetivamente baixado.

Os testes de round-trip não passam o primeiro resultado elétrico inteiro como
opção da segunda importação. Eles reaproveitam somente identidade local e
placement, sem metadados WireViz ou inventário de cabos, e comparam o snapshot
elétrico completo. Há ainda uma mutação real no YAML emitido que remove o cabo
desconectado; o teste exige que a equivalência falhe, evitando um falso
positivo mascarado pelo estado da primeira importação.
