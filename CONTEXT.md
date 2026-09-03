# Glossário do domínio

**Net** — Conjunto eletricamente conexo de endpoints e condutores. A net é
derivada da conectividade, não da ordem ou da formatação do YAML.

**Endpoint** — Ponto terminal de uma net: um pino de componente ou uma junção.

**Condutor** — Ligação física entre dois endpoints. Pode referenciar um fio de
um cabo ou um link direto WireViz e possui rota, cor e metadados de inspeção
próprios.

**Cabo** — Registro WireViz compartilhado por um ou mais condutores, com
quantidade de fios e inventário de posições. Atributos comuns podem ser
emitidos no cabo; divergências permanecem nos condutores e entram no relatório.

**Junção** — Um único ponto elétrico explícito onde dois ou mais condutores
podem se encontrar.

**Trilho** — Junção desenhada como barra com vários taps visuais. Todos os taps
continuam sendo o mesmo ponto elétrico.

**Tap** — Posição visual de aterrissagem em um trilho ou junção. Pertence à
geometria e não cria um endpoint elétrico diferente.

**Fan-out** — Situação em que vários condutores partem do mesmo endpoint dentro
de uma net.

**Multi-drop** — Net que alcança três ou mais endpoints distintos.

**Semântica elétrica** — Componentes, pinos, junções, cabos, condutores e
conectividade persistidos em `electrical`.

**Geometria visual** — Placas, posições, furos, taps e rotas persistidos em
`layout`, sem alterar a equivalência elétrica.

**Plano visual** — Ordem persistente de composição de placas, componentes,
junções e condutores. Não representa conectividade elétrica nem layer semântico
de exportação CAD.

**Relatório de compatibilidade** — Lista explícita de informações preservadas,
normalizadas ou sem representação no sentido da importação/exportação.
