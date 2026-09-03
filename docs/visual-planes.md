# Planos visuais

O projeto canônico v4 persiste `visualPlane` em cada registro de `layout`: placas, componentes, junções e condutores. Valores maiores aparecem acima de valores menores. O inspetor permite consultar e alterar o número do elemento selecionado sem tocar em nets, endpoints ou conectividade.

Os defaults da migração são:

| Elemento           | Plano |
| ------------------ | ----: |
| Placa              |   `0` |
| Componente         |  `10` |
| Condutor ou jumper |  `20` |
| Junção             |  `30` |

Isso garante que fios ligados a furos e trilhas sejam desenhados acima do corpo da placa. Para um jumper local, a relação é uma invariante estrita: seu plano precisa ser maior que o plano da placa proprietária. A normalização eleva o jumper para `planoDaPlaca + 1` quando necessário e, no limite superior, baixa a placa para preservar a relação. Snapshots v1, v2 e v3 recebem os defaults durante a leitura; novos snapshots v4 exigem um inteiro entre `-1000` e `1000` e rejeitam um jumper no mesmo plano ou abaixo da placa.

O plano persistido não é usado diretamente como índice CSS. Antes de renderizar, `visual-planes.ts` ordena todos os nós e arestas pelo par `(visualPlane, tipo, id)` e atribui um `zOrder` sequencial do ng-diagram. Assim, empates dentro de um plano são determinísticos e não dependem da ordem de inserção, seleção, arraste ou reabertura.

O PNG compõe a árvore DOM já ordenada, e o SVG incorpora essa mesma composição como uma imagem raster leve. O DXF mantém os cinco layers semânticos `BOARDS`, `DEVICES`, `FOOTPRINTS`, `WIRES` e `JUMPERS`; esses layers não são planos visuais e não mudam quando o usuário altera `visualPlane`.

Se um fio for colocado abaixo de um componente, use **Selecionar fio oculto** no rodapé do canvas e clique no trecho sobreposto; o modo é encerrado após o gesto. Como atalho, mantenha `Alt` pressionado durante o clique. Fora desse modo temporário, seleção, portas, handles de dobra e menus continuam com a interação normal.
