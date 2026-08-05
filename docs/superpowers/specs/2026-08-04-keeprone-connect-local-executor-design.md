# KeeproneConnect como agente local de execução National Life

Data: 2026-08-04
Estado: proposta para revisão

## Objetivo

O Keepr One passa a ser o local de trabalho do agente para National Life. O portal
da seguradora continua existindo como superfície autenticada, mas o agente não
precisa mais trabalhar dentro dele. O KeeproneConnect deixa de ser "um sincronizador
de duas grades" e passa a ser o **agente local de execução** do Keepr One: ele executa
operações autorizadas no navegador do próprio agente, com a sessão dele.

Esta versão cobre **leitura**. Escrita na conta do agente (e-App, submissão de
aplicação) fica explicitamente fora e depende de decisão humana separada.

A **cotação** que o agente vende é **FlexLife** (não "Rapid Solve"). O desenho
desse caminho — incluindo `FLEXLIFE_QUOTE` e alternativas à extensão — está em
`docs/superpowers/specs/2026-08-05-flexlife-quote-foresight-design.md`. Piloto
sem Store: `docs/operations/keeprone-connect-pilot-without-store.md`.

## Decisão

Manter a extensão Chrome e mudar o seu posicionamento e a sua camada.

A extensão **não** recebe URLs arbitrárias do backend. Ela carrega um **catálogo
fechado de capabilities**; o servidor envia o nome de uma capability mais parâmetros,
e a extensão valida ambos contra o próprio catálogo antes de executar. Isso preserva
a propriedade de segurança de que um backend comprometido não consegue fazer o
navegador do agente executar qualquer coisa no portal.

A extensão **não** normaliza dados. Ela devolve a resposta do carrier como veio, e o
servidor normaliza e persiste. Toda a inteligência de domínio — lista de grades,
paginação, normalização, conclusão de run — vive no servidor.

## Por que a extensão, e não as alternativas

Quatro razões independentes, todas verificadas.

**O token do Foresight vive na memória da página.** O `auth0-spa-js` do Foresight roda
com `cacheLocation: memory`. Não existe cookie extraível, então não existe credencial
para entregar a um cliente fora de banda. Por isso o caminho server-side precisa de
`NATIONAL_LIFE_CARRIER_BROWSER_TTL_MS = 12h`, de `reattachSession`, e por isso a
keep-alive de SSO matava a sessão: o browser era descartado entre jobs. O Chrome do
agente nunca é descartado. Ele cruzou o `/authorize` uma vez e mantém o token vivo.

**A restrição contratual que morde é "um humano por credencial"**, não "proibido
raspar". A extensão satisfaz essa regra melhor que qualquer alternativa; um cofre de
credenciais server-side a viola diretamente.

**O enforcement real é bloqueio técnico silencioso**, não litígio. O tráfego da
extensão é indistinguível do browser do agente — mesma sessão, mesmo fingerprint,
mesmo IP residencial. É o oposto do que CAPTCHA, MFA e expiração de sessão existem
para bloquear.

**Custo de infraestrutura zero.** O design da frota de browsers existia para manter
browsers vivos por causa do token em memória. Fica arquivado.

Consequência: `docs/superpowers/specs/2026-08-04-national-life-browser-fleet-design.md`
não é executado. O caminho remoto existente encolhe para fallback de quem não usa
Chrome, e não recebe investimento novo.

## Arquitetura

```text
Keepr One (servidor)                Extensão (Chrome do agente)        Portal NLG
  monta a intenção:                                                     (mesma origem,
  { capability, params }      →     valida contra o catálogo      →     inclui /NWI/*)
                                    executa na sessão do agente
  normaliza + persiste        ←     devolve resposta CRUA         ←
```

### O contrato ConnectorCapability

Uma capability é uma operação nomeada com assinatura fixa. A extensão conhece o
conjunto; o servidor escolhe qual e com quais parâmetros. A extensão rejeita nome
desconhecido e parâmetro fora do domínio declarado.

| Capability | Parâmetros | O que faz | Efeito no carrier |
|---|---|---|---|
| `READ_GRID` | `navigatePath` (prefixo `/agent/**`) | Navega, captura o template do `POST /agent/Datatable/GetJsonResult` que a própria página emite, repagina, devolve as páginas cruas | nenhum |
| `FORESIGHT_INVENTORY` | — | Lê os casos do painel Recent no iframe `StartPage.aspx` | nenhum |
| `FORESIGHT_CASE_DETAIL` | `caseKey` | Seleciona o caso e chama os serviços ASMX da allowlist | seleção de caso na sessão |
| `FORESIGHT_REPORT` | `caseKey` | Seleciona o caso, dispara o trio de render e busca o PDF | gera relatório |

**`READ_GRID` cobre as 20 grades com uma única capability**, porque todas batem no
mesmo endpoint — o que varia é só qual página abrir antes para capturar o template.
Adicionar grade é mudança de servidor, não release na Chrome Web Store.

As capabilities de Foresight são nomeadas uma a uma porque cada uma muda estado do
lado do carrier. Elas passam por review da Store individualmente, que é onde review
deve doer.

### Foresight

Foresight é a árvore `/NWI/` na **mesma origem** `www.nationallife.com`, atrás do
tenant `nlg-prod.auth0.com`. O `host_permissions` atual já cobre. O que muda é o
match do content script, que hoje casa só `/agent/*` e passa a casar também `/NWI/*`
— mudança de match pattern dentro de host já concedido, não permissão nova.

O fluxo reproduz o que o adapter faz hoje via Playwright, com menos etapas porque o
salto SSO é desnecessário (o agente já está dentro):

1. inventário: ler as âncoras `a[id*="lnkCaseName"]` no iframe `StartPage.aspx`
   (content script com `all_frames: true`)
2. seleção: `.click()` na âncora do caso — postback WebForms, muda estado de sessão
3. token: `$ITCommon.sessionTokenId()`
4. serviços: `$ITAjax.sendRequest(appPath + '/Main/' + nome, [token])` no MAIN world,
   mesmo padrão do `nlg-main.content.ts` que já existe
5. PDF: trio `SetupReportDisplay` / `RenderReports` / `GetReportProgress` com polling,
   depois `GET /NWI/Main/ReportDisplay.rspx?SessionTokenId=`

Chamar pelo `$ITAjax` da própria página, e não montar o POST ASMX à mão, é
deliberado: mesma serialização, mesmo antiforgery, mesma sessão.

O `appPath` é lido da página em tempo de execução. Não assumir `/NWI`.

### Fronteiras de permissão

Mantidas as proibições: sem `all_urls`, sem `cookies`, sem `chrome.debugger`, sem
execução de JavaScript vindo do servidor, sem coleta de histórico, sem comandos
arbitrários do backend.

Uma distinção que precisa ficar explícita: **JSON cru do endpoint do próprio portal
não é "HTML bruto"**. Devolver o payload do `GetJsonResult` sem normalizar é
necessário — é o que permite ao servidor tratar as 20 grades e reprocessar quando um
normalizador estiver errado. Capturar e transmitir HTML de página continua proibido,
com uma exceção estreita e nomeada: o trecho de âncoras do inventário do Foresight,
que não tem serviço equivalente.

### Estados de operação

`READY`, `AUTH_REQUIRED`, `RUNNING`, `WAITING_FOR_CONFIRMATION`, `PAUSED`,
`COMPLETED`, `FAILED`.

`WAITING_FOR_CONFIRMATION` **não conta para o relógio de staleness**. O reaper atual
falha runs parados há mais de 30 minutos; uma operação esperando confirmação humana
pode legitimamente passar disso. Espera humana e ausência de connector são condições
distintas e precisam de relógios distintos.

## Correções que entram junto

**Roteamento de sessão expirada.** `toPortalLayoutChanged` devolve código
`PORTAL_LAYOUT_CHANGED` e enterra `FORESIGHT_SSO_EXPIRED` em `safeDetail.safeCode`,
que não é lido por nada. Como `PORTAL_LAYOUT_CHANGED` está em `MANUAL_REVIEW_CODES`,
três dos quatro caminhos de expiração mandam o job para revisão manual em vez de
pedir login. O código de sessão expirada precisa chegar ao topo.

**`POST /runs` engolindo todo erro como 401.** Falha de banco aparece como falha de
assinatura. Discriminar como já fazem `stages` e `fail`.

**`illustrationSsoReachable`** é escrito só pela keep-alive, que está desligada, e
por isso mostra estado falso. Derivar de resultado de job ou remover.

## Fase 0 — dois experimentos que definem escopo

Ambos precisam de sessão autenticada e são curtos. Nenhum escreve no carrier.

**Rapid Solve cria o caso no Foresight?** O Foresight não tem ação de criar caso; os
casos entram já criados de outro lugar, e a evidência aponta para o Rapid Solve
(cotações aparecem em Recent como `RP-<sobrenome>-QQ-<MMDDYY><hhmmss>`). O
experimento que confirmaria nunca foi rodado. Se confirmar, o Rapid Solve é
infraestrutura obrigatória do Foresight — invisível para o agente, mas necessária —
e entra no escopo como capability.

**`GetQuickCalcData` devolve valores de ilustração?** Se devolver, o Keepr One
renderiza a ilustração nativamente em vez de servir o PDF do carrier. É a diferença
entre embrulhar o portal e substituí-lo. O script `describe-foresight-data.ts` já
existe e reporta formatos sem chamar `IllustrateCase`.

## Fases

0. Experimentos acima + as três correções
1. Contrato `ConnectorCapability` e `READ_GRID` — 20 grades
2. Foresight na extensão: inventário, detalhe, PDF
3. Action Center no Keepr One com a máquina de estados
4. Superfície de dados: renderizar os payloads de serviço já persistidos e ligar o
   PDF armazenado, ambos coletados hoje e nunca mostrados
5. Sync sem clique: `chrome.alarms` + keep-alive
6. Distribuição: resolver a listagem na Chrome Web Store
7. — decisão humana — escrita e e-App
8. Side Panel

## Testes de aceitação

- A extensão rejeita capability desconhecida e parâmetro fora do domínio declarado.
- `READ_GRID` alcança uma grade nova sem release da extensão.
- O payload persistido preserva a linha original do carrier em `raw`.
- Sessão expirada durante Foresight resulta em pedido de login, não em revisão manual.
- Operação em `WAITING_FOR_CONFIRMATION` sobrevive a mais de 30 minutos sem virar
  timeout.
- Revogar o device interrompe operações em curso daquele device.
- Nenhuma capability desta versão submete aplicação nem altera dado comercial no
  carrier. Os únicos efeitos permitidos são os inerentes à leitura do Foresight:
  seleção de caso na sessão e geração do relatório que o próprio agente pediu.

## Fora de escopo

Escrita e submissão de aplicação. Frota de browsers server-side. Caminho oficial de
dados — não existe API da NLG, e o DTCC é provavelmente a entidade errada; a
alternativa comercial real é a upline IMO/BGA, que já recebe os dados do agente e é
uma conversa, não um projeto.

## Pendência externa

O **producer agreement** assinado pelo agente é o contrato que governa, não o ToS
público do site. Não é público e não foi obtido. Bloqueante para escalar, não para o
piloto.
