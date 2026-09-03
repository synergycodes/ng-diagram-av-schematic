# Serviço local (issue #1, tracer bullet)

`server/wiring-editor-server.mjs` é um serviço Node.js mínimo, sem
dependências, que (a) serve o build de produção do Angular e (b) expõe uma
API JSON de mesma origem para salvar/reabrir projetos em um diretório de
armazenamento central configurável — o caminho de persistência que o
critério de aceite exige ("um projeto salvo em um navegador pode ser
reaberto em outro cliente da Tailnet pela persistência central do
serviço").

**Este repositório não se auto-instala nem altera a infraestrutura do host.**
No Talus, a integração operacional fica versionada separadamente no
`talus-core`: release imutável em `/srv/talus-fast/apps/talus-wiring-editor`,
unit de usuário `talus-wiring-editor.service`, projetos centrais em
`~/.local/share/talus-wiring-editor/projects` e HTTPS privado por Tailscale
Serve. Essa separação mantém o fork utilizável fora do homeserver e evita que
um build da aplicação modifique serviços compartilhados por conta própria.

## Por que sem framework, sem dependência nova

O `package.json` não tem, hoje, nenhuma dependência de lado servidor.
Express/Fastify/etc. seriam a primeira dependência de runtime não-Angular
do repositório para algo que, funcionalmente, é "servir arquivos estáticos

- quatro endpoints JSON pequenos" — bem dentro do que os módulos nativos
  `http`/`fs`/`path` do Node cobrem diretamente. Escrito como `ESM` puro
  (`.mjs`) para rodar em qualquer versão do Node que este repositório já
  exige (v20.19+ / v22.12+) sem passo de build nem mudança no `"type"` do
  `package.json`.

## Rodando manualmente

```bash
npm run build            # produz dist/ng-diagram-av-schematic/browser
node server/wiring-editor-server.mjs
```

## Configuração (variáveis de ambiente)

| Variável                      | Padrão                                                                  | Notas                                                                                                                                                                                                                                                     |
| ----------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WIRING_EDITOR_HOST`          | `127.0.0.1`                                                             | **Loopback por padrão**, conforme a arquitetura aprovada na issue #1: listener local e HTTPS publicado separadamente via Tailscale Serve. Nunca definir como `0.0.0.0` ou um endereço de LAN sem revisar deliberadamente a política de exposição do host. |
| `WIRING_EDITOR_PORT`          | `4173`                                                                  | Porta local reservada pela integração operacional do Talus após conferência do inventário; não é exposta diretamente na LAN.                                                                                                                              |
| `WIRING_EDITOR_STATIC_DIR`    | `dist/ng-diagram-av-schematic/browser` (relativo à raiz do repositório) | Caminho de saída padrão do `ng build` para este nome de projeto. Precisa existir e conter `index.html`; o servidor não faz o build.                                                                                                                       |
| `WIRING_EDITOR_STORAGE_DIR`   | `~/.local/share/talus-wiring-editor/projects`                           | Armazenamento central — o mesmo diretório independentemente de qual navegador/dispositivo salvou o projeto, o que é o que torna possível reabrir a partir de outro cliente da Tailnet. Criado na primeira gravação, se não existir.                       |
| `WIRING_EDITOR_ALLOWED_HOSTS` | (vazio)                                                                 | Lista separada por vírgulas de valores `host:porta` adicionais aceitos no cabeçalho `Host` da requisição (por exemplo, um nome MagicDNS do Tailscale), somados aos padrões de loopback abaixo — nunca os substitui.                                       |

## Segurança do servidor

Este serviço é `http` puro do Node, sem framework, então cada proteção
abaixo é implementada explicitamente no próprio `wiring-editor-server.mjs`
— nada vem "de graça" de um middleware de terceiros.

- **Allowlist do cabeçalho `Host`** (defesa primária contra DNS rebinding):
  toda requisição precisa ter um cabeçalho `Host` que bata exatamente com
  `127.0.0.1:<porta>`, `localhost:<porta>`, `[::1]:<porta>`, ou uma entrada
  extra listada em `WIRING_EDITOR_ALLOWED_HOSTS`. Uma página servida por um
  domínio controlado por um atacante que resolva para `127.0.0.1` ainda
  envia esse domínio como `Host`, que não bate com a allowlist, então a
  requisição é rejeitada (`400 invalid_host`) antes de tocar a API ou o
  sistema de arquivos.
- **Rejeição de mutação entre origens (mitigação CSRF)**: para métodos que
  mudam estado (`PUT`/`POST`/`PATCH`/`DELETE`), o servidor rejeita a
  requisição (`403`) se o cabeçalho `Sec-Fetch-Site` do navegador indicar
  algo diferente de `same-origin`/`none`, ou se o cabeçalho `Origin` (quando
  presente) não bater com o `Host` da requisição. Ambas as checagens só
  disparam quando o navegador (ou uma página maliciosa) de fato envia o
  cabeçalho — então um `curl -X PUT` simples, sem `Origin`/`Sec-Fetch-Site`,
  continua funcionando para o fluxo local documentado aqui.
- **Limite de tamanho do corpo**: requisições `PUT` são cortadas em 5 MB
  (`MAX_BODY_BYTES`); acima disso o servidor responde `413` e derruba a
  conexão em vez de continuar lendo.
- **Validação estrutural antes de gravar em disco**: `PUT` chama
  `parseCanonicalProject()` de `server/canonical-project-validate.mjs` —
  uma reimplementação em JavaScript puro (sem build/bundler ligando o
  servidor ao TypeScript do Angular) das mesmas regras de
  `diagram/model/canonical-project-parse.ts::parseCanonicalProject`. Um corpo
  que não seja um projeto canônico v1, v2, v3 ou v4 válido (tipos errados, ids
  duplicados, referências inexistentes, nets desconectadas, furos ou taps
  fora dos limites, endpoints v1 iguais, conflitos de cor v1, loops inválidos
  ou extras capazes de sobrescrever campos canônicos etc.) é rejeitado com
  `400 invalid_project` antes de
  qualquer gravação. O servidor mantém snapshots v1 na versão v1, após
  normalizar somente os campos reconhecidos; o frontend os migra para v4 ao
  abrir. Snapshots v2 e v3 são normalizados para v4 pelo servidor. As implementações de validação permanecem separadas, mas importam a
  mesma fonte auditável de limites operacionais em
  `diagram/model/operational-limits.mjs`; `canonical-project.spec.ts`
  (cliente) e `wiring-editor-server.spec.mjs` (servidor) exercitam o mesmo
  corpus abaixo, no ponto e acima de cada fronteira.
- **`:id` restrito antes de tocar o sistema de arquivos**: validado contra
  `^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$` — sem separador de caminho, sem ponto
  inicial, então não há travessia de diretório possível.
- **Cabeçalhos de resposta**: toda resposta JSON e todo arquivo estático
  incluem `X-Content-Type-Options: nosniff`; respostas da API JSON também
  enviam `Cache-Control: no-store`.
- **Contenção do diretório estático**: o caminho requisitado é resolvido de
  forma absoluta e comparado contra `staticDir` (com o separador de
  caminho incluído na comparação), então um diretório irmão cujo nome
  apenas comece com o mesmo prefixo (ex.: `.../browser-old`) nunca passa
  como se estivesse dentro de `.../browser`.

## API

Todos os endpoints são de mesma origem com o frontend servido (sem
configuração de CORS — deliberadamente, já que acesso entre origens nunca
foi um requisito e adicioná-lo só ampliaria a superfície de ataque sem
benefício).

| Método   | Caminho             | Corpo                                                                     | Resposta                                                               |
| -------- | ------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `GET`    | `/api/projects`     | —                                                                         | `{ projects: [{ id, name, updatedAt }] }`                              |
| `GET`    | `/api/projects/:id` | —                                                                         | O projeto canônico v1 ou v4 normalizado e armazenado em JSON, ou `404` |
| `PUT`    | `/api/projects/:id` | Um objeto JSON canônico v1, v2, v3 ou v4 validado (ver "Validação" acima) | `{ id, saved: true }`, ou `400 invalid_project` se a validação falhar  |
| `DELETE` | `/api/projects/:id` | —                                                                         | `{ id, deleted: true }`, ou `404`                                      |

Gravações são atômicas: o corpo é escrito em um arquivo de rascunho no
mesmo diretório e depois `rename()`ado sobre o alvo, então um leitor
concorrente nunca observa um projeto parcialmente escrito. Não há trava
além disso — dois escritores simultâneos para o mesmo `:id` ainda competem
no nível do `rename()` do sistema operacional (a última escrita vence), o
que é um trade-off aceitável para este MVP, já que não há requisito de
colaboração em tempo real com múltiplos usuários (essa ausência de
requisito é uma decisão de escopo desta fatia, não algo exigido
explicitamente pelo critério de aceite público da issue).

## Layout de armazenamento

```
$WIRING_EDITOR_STORAGE_DIR/
  <id-do-projeto>.json   # projeto canônico versionado, formatado (pretty-printed)
  ...
```

Sem arquivo de índice — `GET /api/projects` lista varrendo o diretório e
lendo o campo `name` e o mtime de cada arquivo. Suficiente na escala que
este serviço mira (um punhado de projetos em um homeserver); revisitar se
isso deixar de ser verdade.

## O frontend já chama esta API

`src/app/av-schematic/project-storage/` — `ProjectStorageService` e
`ProjectStorageMenuComponent` (ver
[`docs/wiring-tracer-bullet.md`](wiring-tracer-bullet.md) — seção "Salvar e
Abrir") — já fazem `GET`/`PUT` contra `/api/projects/:id` a partir da
interface Angular. Isso substitui uma versão anterior deste documento, que
dizia não haver UI de salvar/abrir projeto conectada ainda. A validação da
mudança também exercita a jornada Salvar/Abrir em um navegador real contra
o build e o serviço locais; a implantação e o smoke test pela Tailnet são
gates operacionais mantidos pelo `talus-core`.

## Integração esperada no Talus

A implantação do host deve preservar estas invariantes:

1. backend em `127.0.0.1:4173`, sem bind direto na LAN;
2. HTTPS tailnet-only em `https://talus.tail4543b3.ts.net:8491`, sem Funnel;
3. build e código do servidor copiados para uma release imutável, sem apontar
   o serviço para uma worktree temporária;
4. persistência fora da release em
   `~/.local/share/talus-wiring-editor/projects`;
5. health local e remoto verificando tanto o frontend quanto
   `GET /api/projects`;
6. operação por ações allowlistadas, sem shell livre e sem build `npm`
   disparado pelo painel.

O round-trip entre clientes da Tailnet e a política de backup dos projetos
continuam sendo validações operacionais do host, não responsabilidades do
build Angular. Em particular, o gate posterior precisa salvar em um
navegador/dispositivo e reabrir em outro navegador/dispositivo fisicamente
distinto, ambos pela URL HTTPS da Tailnet; duas requisições no mesmo processo
não substituem essa evidência. O estado corrente dessas verificações deve ser
consultado na issue/PR de implantação, em vez de ficar congelado neste
documento de código da aplicação.

## Fontes consultadas

- Código-fonte de `server/wiring-editor-server.mjs` e
  `server/canonical-project-validate.mjs` desta fatia — lido diretamente
  para descrever as proteções de segurança e a API acima, em vez de
  descrito de memória.
- [`felipedruzian/talus-core#339`](https://github.com/felipedruzian/talus-core/issues/339)
  — issue pública com os critérios de aceite sobre loopback, HTTPS via
  Tailnet e persistência central, conferida via `gh api` em 2026-08-27.
