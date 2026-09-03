# Triagem de dependências

Esta triagem foi observada em 2 de setembro de 2026, sem `npm install`,
`npm update`, `npm audit fix` ou deploy. A validação usou somente leitura do
`package.json`, `package-lock.json`, metadados do registry e `npm audit --json`
sobre o lockfile existente. Os números devem ser reproduzidos antes de cada
atualização porque o banco de advisories é dinâmico.

## Resultado

- Todas as dependências diretas declaradas em `package.json` resolvem no registry npm.
- Os peers principais estão coerentes para Angular 21: `@angular/compiler-cli@21.2.9` aceita TypeScript `>=5.9 <6.1`, `@angular/build@21.2.7` aceita TypeScript `>=5.9 <6.0` e `angular-eslint@21.4.0` aceita `ESLint` 10.
- O lockfile fixa Angular `21.2.10`, `@angular/build` e `@angular/cli` `21.2.8`, `ESLint` `10.4.0` e `Vitest` `4.1.5`, embora as ranges atuais já permitam patches mais novos.
- `npm audit --json` reportou 31 vulnerabilidades no lockfile atual: 1 crítica, 22 altas, 5 moderadas e 3 baixas.
- As 31 entradas reportaram correção disponível dentro das ranges já declaradas, sem exigir bump semver-major.

## Alcance e correções observadas

- As vulnerabilidades diretas de runtime afetam `@angular/common`, `@angular/compiler`, `@angular/core`, `@angular/forms`, `@angular/platform-browser` e `@angular/router` até `21.2.18`; a correção começa em `21.2.19`. Esse código compõe o bundle entregue ao navegador.
- `@angular/build` e `@angular/cli` também são dependências diretas, mas de desenvolvimento. O audit observado exige ao menos `@angular/build` `21.2.21` e `@angular/cli` `21.2.16`. Elas não entram no servidor Node implantado, porém alcançam build e CI.
- Os demais achados vêm de transitivos de tooling, incluindo `vitest`/`jsdom` e a cadeia npm/tar/sigstore. Eles não são importados pelo servidor local, que usa somente módulos `node:` e arquivos do repositório, mas ainda afetam o ambiente de desenvolvimento e CI.
- As ranges atuais permitem os patches corrigidos, porém `npm ci` continuará reproduzindo as versões vulneráveis enquanto o lockfile não for regenerado.
- Não foram aplicados `overrides`: eles também exigiriam atualizar o lockfile, e uma edição manual ampla seria menos segura que uma atualização controlada.

## Atualização Angular — issue #21

A atualização foi executada em 2 de setembro de 2026 com o comando oficial
`ng update`, sobre uma baseline integralmente verde. O grupo de runtime e
compilação passou de `21.2.10` para `21.2.22`; `@angular/build` e
`@angular/cli` passaram de `21.2.8` para `21.2.23`.

- Antes: 31 vulnerabilidades — 1 crítica, 22 altas, 5 moderadas e 3 baixas.
- Depois: 7 vulnerabilidades — 6 altas e 1 baixa.
- Nenhuma vulnerabilidade direta ou atribuída a um pacote Angular permaneceu.
- O grafo instalado foi validado com os nove pacotes Angular nas versões
  esperadas e sem dependência inválida.
- Nenhum `override`, `--force` manual ou `--legacy-peer-deps` foi adicionado.
- Os sete achados restantes pertencem a `brace-expansion`, `browserslist`,
  `esbuild`, `fast-uri`, `immutable`, `nanoid` e `postcss`; a análise e eventual
  atualização dessas cadeias continuam na issue #22.

## Atualização dos transitivos — issue #22

A baseline após a issue #21 reproduziu 7 vulnerabilidades — 6 altas e 1 baixa
— somente no toolchain de desenvolvimento. Os pacotes eram alcançados por
`@angular/build`, `@angular/cli`, `eslint`, `angular-eslint`,
`typescript-eslint` ou `vitest`; nenhum deles era importado pelo servidor de
produção.

O plano de correção foi inspecionado com `npm audit fix --dry-run` e depois
aplicado sem `--force`, sem scripts e sem promover transitivos a dependências
diretas. As faixas já declaradas pelos pais permitiram estas correções:

| Pacote | Antes | Depois |
| --- | --- | --- |
| `brace-expansion` | `5.0.5` | `5.0.9` |
| `browserslist` | `4.28.2` | `4.28.8` |
| `esbuild` | `0.27.3` | `0.28.2` |
| `fast-uri` | `3.1.0` | `3.1.7` |
| `immutable` | `5.1.5` | `5.1.9` |
| `nanoid` | `3.3.11` | `3.3.18` |
| `postcss` | `8.5.10` | `8.5.26` |

O diff final contém apenas o `package-lock.json`: 38 nós de versão, formados
pelas 7 correções acima, 5 metadados auxiliares do `Browserslist` e 26 pacotes
opcionais por plataforma do `esbuild`. O audit posterior reportou zero
vulnerabilidades. Não houve `override`, semver-major, risco aceito ou follow-up
de segurança pendente nesta rodada.

## Atualizações separadas

1. Concluído na issue #21: atualizar os pacotes Angular diretos e o lockfile em
   uma linha de patch coerente.
2. Concluído na issue #22: revisar e corrigir os transitivos de build/teste que
   permaneceram no novo `npm audit`, sem `overrides`.

Cada PR deve executar a sequência completa de CI e registrar o resumo do audit
antes/depois. A regeneração do lockfile deve ocorrer em ambiente controlado e
com autorização explícita para o comando de atualização escolhido.

## Limpeza manual no GitHub

O workflow removido era o único consumidor versionado destes valores:

- secret `CONTACT_FORM_TOKEN`;
- variables `HUBSPOT_PORTAL_ID` e `HUBSPOT_FORM_ID`;
- variables `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`,
  `AZURE_STORAGE_ACCOUNT` e `AZURE_STORAGE_CONTAINER`.

Revise **Settings → Secrets and variables → Actions** no repositório e remova
somente os valores que não tiverem outro consumidor. Esta triagem não leu nem
alterou as configurações externas do GitHub e não contém credenciais.
