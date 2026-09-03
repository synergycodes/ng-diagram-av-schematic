# Importação WireViz: subconjunto suportado e limites

`src/app/av-schematic/wireviz-import/` é uma implementação clean-room.
Nenhum código, teste ou asset do `Garth-42/WireForm` ou do WireViz foi
incorporado; somente a sintaxe pública do formato foi consultada. A matriz de
origens e licenças está em [`license-matrix.md`](license-matrix.md).

O importador não pretende implementar todo o YAML nem todo o WireViz. Ele
cobre o contrato necessário às issues #1 e #2 e rejeita estruturas fora desse
contrato, em vez de montar silenciosamente um circuito parcial.

## Pipeline

1. `wireviz-yaml.ts` transforma texto em valores JSON seguros.
2. `wireviz-model.ts` valida conectores, cabos e conjuntos de conexão e gera
   condutores tipados.
3. `wireviz-to-diagram.ts` converte os condutores na seção elétrica do projeto
   canônico e agrupa nets por conectividade.
4. `export-wireviz.ts` faz o caminho inverso e entrega YAML mais relatório de
   compatibilidade.

## YAML aceito

- Mapeamentos e sequências em bloco.
- Sequências de escalares em fluxo, como `[1, 2, 3]`.
- Escalares soltos ou entre aspas, números, valores lógicos e `null`.
- O mapeamento vazio `{}`.
- Comentários fora de aspas e linhas em branco.
- A forma compacta de conjuntos de conexão, como `- - X1: [1]`.

Não são aceitos tabs no recuo, âncoras/aliases, streams com vários documentos,
escalares de bloco (`|` e `>`), nem mapeamentos de fluxo não vazios. O emissor
produz somente construções que esse mesmo parser consegue reler.

## Documento WireViz aceito

Conectores:

- `pins`, `pincount` e `pinlabels`; designadores numéricos são inferidos
  quando só `pincount` ou `pinlabels` está presente;
- `type`, `subtype`, `notes`, `color`, `manufacturer`, `mpn`, `style` e
  `show_name`;
- `loops`, como pares de pinos do mesmo conector. Cada par vira um condutor
  interno explícito e volta a ser emitido como `loops`;
- um conector de um pino com `style: simple` vira uma junção explícita;
- um `style: simple` com vários pinos continua sendo componente, evitando
  curto-circuitar pinos eletricamente distintos.

Cabos:

- `wirecount`, `colors`, `wirelabels`, `gauge`, `length`, `notes`,
  `color_code`, `type`, `manufacturer` e `mpn`;
- listas de cores menores ou maiores que `wirecount` são repetidas ou
  truncadas para reproduzir a semântica efetiva do WireViz;
- `wirelabels` precisa ter exatamente uma entrada por condutor;
- índices de condutor são baseados em 1 e validados contra `wirecount`.
- uma cor RGB WireViz com seis dígitos, como `"#a1b2c3"`, é preservada e
  reemitida exatamente, sem aproximação. Outros formatos CSS hexadecimais
  e cores CSS personalizadas permanecem no projeto e geram
  `color-not-representable` na exportação.

Conexões:

- um ou mais itens por conjunto, com referências paralelas de mesma largura;
- intervalos ascendentes e descendentes, como `1-4` e `9-7`;
- caminhos alternados conector/cabo/conector, inclusive caminhos mais longos;
- links diretos por setas de pino `--`, `<--`, `<-->` e `-->`;
- o mesmo pino em vários conjuntos de conexão. Esse reuso é um fan-out
  legítimo: todos os condutores conectados entram na mesma net multi-drop;
- uma referência isolada a elemento não conectado.
- pinos podem ser referidos pelo designador ou por `pinlabel`; condutores de
  cabo podem ser referidos pelo número, por `wirelabel` ou por uma cor que
  identifique uma única posição. Colisões e referências ambíguas são erros,
  nunca resolvidas escolhendo a primeira ocorrência.

## Preservação e relatório

No projeto canônico atual, cor, bitola, comprimento e observação também ficam no condutor
que representa a ligação física. Na importação, atributos de cabo são
materializados nos condutores correspondentes para que cada fio possa ser
editado de forma independente. Na exportação, valores iguais podem voltar ao
campo compartilhado do cabo; valores divergentes são omitidos e registrados
como `field-not-representable`, sem escolher um condutor arbitrariamente.

Campos desconhecidos de conectores e cabos são guardados como valores JSON,
aparecem no relatório e são reemitidos sem interpretação. Campos reconhecidos
cuja semântica visual não é modelada, como `shield` e `category`, também geram
aviso e permanecem no registro do cabo.

Um campo preservado não pode usar uma chave canônica do mesmo conector ou
cabo e, portanto, não consegue sobrescrever `pins`, `colors`, `wirelabels` ou
outro valor interpretado na exportação. As chaves perigosas `__proto__`,
`constructor` e `prototype` são rejeitadas em qualquer profundidade.

Campos desconhecidos no nível do documento (`metadata`, `options`, `tweak` e
outros) aparecem no relatório, mas não são incorporados ao projeto. O canvas
pode combinar várias importações e não existe um dono inequívoco para esses
campos globais. Essa limitação é explícita; eles não desaparecem sem aviso.

Erros estruturais — pino inexistente, índice fora do cabo, larguras paralelas
divergentes, referências adjacentes que não alternam e tipos inválidos —
interrompem a importação com um caminho para o campo problemático.

## Limites operacionais

A fonte auditável dos limites é
[`operational-limits.mjs`](../src/app/av-schematic/diagram/model/operational-limits.mjs).
O importador WireViz e os validadores canônicos do cliente e do serviço usam
os mesmos valores:

| Recurso                                                               | Limite |
| --------------------------------------------------------------------- | -----: |
| Pinos por componente                                                  |    256 |
| Condutores por cabo                                                   |    256 |
| Largura paralela ou entradas produzidas por uma expansão de intervalo |    256 |
| Entradas de entidades e coleções materializadas por documento         | 10.000 |

Contagens, índices e extremos de intervalos precisam ser inteiros seguros do
JavaScript. O limite é conferido antes de `pincount`, `wirecount`, intervalos,
listas normalizadas ou registros canônicos gerarem novos arrays.

O orçamento total inclui entidades elétricas, posições de cabo, referências
de conexão e saídas possíveis do agrupamento em nets no importador. No formato
canônico, inclui também endpoints, registros de layout, posições de pinos e
pontos de rota. Os limites de pinos e posições de cabo descrevem capacidades
físicas e ficam no módulo compartilhado para reutilização pela integração
física sem criar uma segunda política.

## Limites deliberados

- Autogeração de conectores/cabos e templates não é implementada.
- Setas de acoplamento de conector inteiro (`==` e variantes) não são
  implementadas.
- Shields podem ser preservados como campo, mas a referência especial ao
  condutor `s` não vira uma conexão elétrica.
- Pinout avançado além de `pins`/`pinlabels`/`loops`, imagens, itens de BOM e
  componentes adicionais não são interpretados.
- Códigos de cor desconhecidos são mantidos, porém podem não ter uma cor CSS
  para renderização.

## Fonte de interoperabilidade

O comportamento de listas paralelas, intervalos, conectores simples, setas e
normalização de cores foi conferido na
[documentação oficial de sintaxe do WireViz](https://github.com/wireviz/WireViz/blob/master/docs/syntax.md).
Essa consulta orientou o contrato; nenhum trecho da implementação GPL foi
copiado ou adaptado.
