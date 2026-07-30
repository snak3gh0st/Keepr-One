# National Life — contrato real do portal do agente

Levantado em 2026-07-29 sondando o portal autenticado com a sessão Steel salva
(`AgentIntegrationSession` / `CARRIER_SESSION`). **Não commitado ainda** — decidir
com o time se entra no repo.

> Motivo desta investigação: o adapter atual foi escrito contra fixtures sintéticas
> em `tests/fixtures/national-life/*.html` (`data-carrier-id`, `data-portal-page`).
> Nenhum desses marcadores existe no site real, e `caseSearchUrl` (`/cases/search`)
> devolve **404**. `NationalLifeAdapter.readCase()` não funciona em produção.

## A sessão salva funciona

`/agent/` reabre autenticado a partir do contexto salvo, **sem MFA** — 23 cookies,
~696 KB de HTML, `hasLogout: true`, usuário `extranet\<login>`. Isto valida o
caminho `createSteelBrowserSession(env, { sessionContext })`.

## Onde os dados moram

Rotas reais (extraídas da nav autenticada):

```
/agent/book-of-business/new-business/all-new-business-cases        ← lista de casos
/agent/book-of-business/new-business/all-new-business-cases/nb-policy-details
/agent/book-of-business/new-business/recently-closed-cases
/agent/book-of-business/new-business/placement-report
/agent/book-of-business/new-business/transfers-exchanges
/agent/book-of-business/inforce-book/all-clients
/agent/book-of-business/inforce-book/life-pending-lapse-report
/agent/book-of-business/inforce-book/policy-payment-history
/agent/compensation/commissions/...
```

A página de casos (`All New Business Cases`) renderiza **um** grid jQuery
DataTables: `table#DataTables_Table_0.ap-grid.dataTable`, 10 linhas por página.

## A API interna (use esta, não raspe DOM)

```
POST https://www.nationallife.com/agent/Datatable/GetJsonResult
Content-Type: application/json
```

Corpo — protocolo DataTables server-side, envelopado em `objJsonModel`:

```jsonc
{ "objJsonModel": {
  "draw": 1,
  "columns": [ { "data": "HasUnreadMessages", "name": "", "searchable": false,
                 "orderable": false, "search": { "value": "", "regex": false } },
               /* … um objeto por coluna, na ordem abaixo … */ ],
  "order":  [ { "column": 1, "dir": "desc" } ],
  "start":  0,
  "length": 10,
  "search": { "value": "", "regex": false },
  "DatatableId": "<token opaco>",   // ⚠ ler da página, não hardcodar
  "filters": []
} }
```

Ordem das colunas no request: `HasUnreadMessages`, `SubmitDate`,
`InsuredOrAnnuitantName`, `PolicyNo`, `AnticipatedAnnualPremium`, `Product`,
`DerivedStatusDescription`, `DeliveryStatus`, `ActionRequired`, `OwnerName`,
`SentDate`, `ModalPremium`, `SubmitMethod`, `CaseManager`, `WritingAgentName`,
`WritingAgentNumber`, `Agency`, `Requirements`, `CompanyCode`, `FollowUpId`,
`null` (coluna de ação).

Resposta:

```jsonc
{
  "draw": 1,
  "lastLoginCount": 0,
  "recordsTotal": 0,        // ← paginar com start/length até aqui
  "recordsFiltered": 0,
  "order": [ 0, 0 ],
  "data": [ {
    "SubmitDate": "string",  "PolicyNo": "string",
    "InsuredOrAnnuitantName": "string",
    "WritingAgentName": "string", "WritingAgentNumber": "string",
    "Agency": "string", "OwnerName": "string", "CaseManager": "string",
    "AnticipatedAnnualPremium": "string", "ModalPremium": "string",
    "Product": "string", "DerivedStatusDescription": "string",
    "DeliveryStatus": "string", "ActionRequired": "string",
    "Requirements": "string", "PendingPolicyRequirements": null,
    "SentDate": null, "SubmitMethod": "string", "CompanyCode": "string",
    "HasUnreadMessages": "string", "IsFollowUp": false, "FollowUpId": "string"
  } ],
  "filters": [ { "FilterId": "…", "FilterKey": "…", "FilterDisplayName": "…",
                 "FilterType": "…", "FilterSourceType": "…" } ]
}
```

Notas de implementação:

- A página tem `input[name="__RequestVerificationToken"]` (antiforgery ASP.NET).
  Emitir o POST com **`page.request.post`** para herdar cookies e cabeçalhos do
  contexto autenticado. Não usar `page.evaluate`: sob `tsx`/esbuild ele injeta um
  helper `__name` que não existe na página e estoura `ReferenceError`.
- `DatatableId` identifica o grid/relatório. Extrair da página a cada execução.
- Todos os valores vêm como **string** (inclusive prêmios e datas) — normalizar.

## Resultado da primeira extração real (2026-07-30 01:2x)

`tsx scripts/national-life-sync-snapshots.ts`, rodado no container do runtime:

| gridKey | recordsTotal | linhas lidas | gravadas | situação |
|---|---|---|---|---|
| `NEW_BUSINESS` | 825 | 825 | **693** | ✅ mapeado |
| `RECENTLY_CLOSED` | 127 | 127 | **109** | ⚠️ status não mapeado |
| `INFORCE_CLIENTS` | 10272 | 10000 | **0** | ❌ schema diferente |

Observações que precisam de trabalho:

- **`RECENTLY_CLOSED`**: as 109 linhas gravaram `insuredName` mas `carrierStatus`
  ficou nulo em todas — esse grid nomeia a coluna de status de outra forma.
  Descobrir o nome e estender `toCaseSnapshot`.
- **`INFORCE_CLIENTS`**: gravou 0 porque as linhas não têm `PolicyNo`. É um grid de
  *clientes*, não de apólices, com outro conjunto de campos. Precisa de mapeamento
  próprio (e provavelmente de uma tabela própria, não `NationalLifeCaseSnapshot`).
- **Truncamento**: 10272 registros com `maxRows` default de 10000 → 272 não lidos.
  O script *loga* `rowsFetched` vs `recordsTotal`, então não é silencioso, mas o
  teto precisa subir ou paginar por completo quando esse grid for mapeado.
- **Duplicatas**: 825 linhas → 693 apólices distintas. `recordsTotal` bateu
  exatamente com o lido, então a paginação cobriu o total; as repetições de
  `PolicyNo` são do próprio grid (mesma apólice em papéis diferentes) e são
  colapsadas por `toCaseSnapshots` com last-write-wins. Confirmar se colapsar é o
  comportamento desejado ou se a chave precisa de mais uma dimensão.

Distribuição de status obtida (`NEW_BUSINESS`): `Issued` 417, `PENDING` 96,
`Incomplete - Closed` 64, `APPROVED` 26, `Issued, Not Paid` 24, `CLOSED` 19,
`Issued, Pending EFT - <data>` 12 — note que o status às vezes **embute uma data**,
então `status-map.ts` precisa normalizar por prefixo, não por igualdade.

## Mapa de extração por grid (verificado 2026-07-30)

| gridKey | recordsTotal | estratégia | situação |
|---|---|---|---|
| `NEW_BUSINESS` | 825 | GetJsonResult | ✅ 693 gravados |
| `RECENTLY_CLOSED` | 127 | GetJsonResult | ✅ 109 gravados |
| `INFORCE_CLIENTS` | 10272 | GetJsonResult | ✅ 9371 gravados (teto 10000 truncou) |
| `PAID_COMMISSIONS` | 8 | GetJsonResult | ✅ 8 gravados |
| `PROJECTED_COMMISSIONS` | 4 | GetJsonResult | ✅ 4 gravados |
| `TRANSFERS_EXCHANGES` | 0 | GetJsonResult | ✅ vazio de verdade |
| `COMMISSIONS_OVERVIEW` | — | **date picker** | ⛔ ver abaixo |
| `PREMIUM_REPORT_AGENCY` | 2 | **server-rendered** | ✅ extraído (agregado) |
| `COMMISSIONS_EARNING_REPORT` | 8 | GetJsonResult | ⚠️ **duplicata** de PAID_COMMISSIONS |
| `PAYABLE_GROSS_COMMISSIONS` | 4 | GetJsonResult | ⚠️ **duplicata** de PROJECTED_COMMISSIONS |
| `LIFE_PENDING_LAPSE` | 0 | GetJsonResult | ✅ vazio de verdade |
| `LIFE_PERSISTENCY` | — | GetJsonResult | ⛔ resposta não é JSON |
| `COMMISSIONS_POLICY_HISTORY` | — | não emite XHR | ⛔ provável formulário |
| `POLICY_PAYMENT_HISTORY` | — | **form por apólice** | ⛔ ver abaixo |
| `PLACEMENT_REPORT` | — | não emite XHR | ⛔ não investigado |

> Importante: `PAID_COMMISSIONS` e `PROJECTED_COMMISSIONS` foram reportados como
> "Could not open" na primeira passada. **Era o esgotamento de PID do Steel**, não
> o carrier. Com o container saudável servem JSON normalmente. Não confiar em
> falha de abertura de página como conclusão sem checar os PIDs primeiro.

### `COMMISSIONS_OVERVIEW` — dirigido por data, não por grid

Server-rendered, HTTP 200, título "Commission Overview". As 5 tabelas do HTML são
todas *date pickers* (`table-condensed`, cabeçalhos "commission Calendar / « July
2026 » / Su Mo Tu…"), e a página não emite **nenhum** XHR para o carrier — só
analytics. Ou seja: não existe tabela de dados até uma data ser escolhida.

Caminho provável para o detalhe de comissão: `PAID_COMMISSIONS` devolve, por
extrato, `GlobalId`, `PayDate`, `ConcatParam` (date-string) e `PayStatement` (link).
São 8 extratos — drill-down por extrato custa ~8 requisições, o que torna o
detalhe de comissão viável. **Não implementado.**

### `POLICY_PAYMENT_HISTORY` — consulta por apólice

Server-rendered, HTTP 200, com formulário de busca: `Enter_policy_number`,
`enter_first_name`, `enter_last_name` + submit. Não é grid em massa.

Consequência de escala a decidir antes de implementar: extrair histórico de
pagamento de todo o livro significa **~9.371 submissões de formulário**, uma por
apólice. Isso é volume de requisição relevante contra o carrier. Alternativas:
sob demanda por apólice (quando o usuário abre), ou lote noturno de um
subconjunto (ex. só `Active`, ou só as com pagamento pendente).

## Prêmio e capital segurado: onde procurar

O grid de inforce **não traz** nenhum dos dois — `AAP` e `AccumulatedCashValue`
vieram nulos nas 9.614 linhas, e só 1 apólice casa com o grid de novos negócios.
Por isso `Policy.premium` e `Policy.faceAmount` estão em 0 e o front mostra "—".

O caminho existe e os identificadores **já estão no banco**: a célula
`PolicyNumber` do inforce é uma âncora renderizada apontando para

```
/agent/book-of-business/inforce-book/all-clients/policy-details?id=<32-hex>
```

um `id` por apólice, gravado em `NationalLifeInforcePolicy.raw`. Mesmo padrão do
drill-down de comissão, que já funcionou.

Próximo passo, com sessão viva:

```
tsx scripts/national-life-describe-page.ts \
  "/agent/book-of-business/inforce-book/all-clients/policy-details?id=<id-real>"
```

para descobrir se a página é DataTables (reaproveita `fetchNationalLifeGrid`) ou
server-rendered (precisa de parse próprio).

⚠️ **Escala**: são 9.614 páginas de detalhe, uma por apólice. Mesma decisão
pendente do histórico de pagamento — sob demanda, lote noturno de um
subconjunto, ou tudo. Não é decisão técnica.

## Sessão: por que um cron desacompanhado não funciona hoje

Medido, não estimado.

- `carrierExpiresAt` derivado dos cookies reais: a sessão da aplicação vale
  **~20 minutos** a partir do último uso (deslizante).
- Testado 10,74 h após a expiração (`scripts/national-life-check-session.ts`):
  abrir `/agent/` com o contexto salvo **redireciona para o login do Auth0 com
  campo de senha** (`verdict: NEEDS_LOGIN`). Reabrir a URL de login também →
  `silentReauthWorks: false`.
- Conclusão: **o cookie de SSO do Auth0 não sobrevive junto**. Não existe
  re-autenticação silenciosa depois de algumas horas.

Isso colide com uma decisão de produto: o Keepr One **não armazena a senha** do
carrier (é o que a UI promete). Sem senha guardada não há login desacompanhado.
Restam apenas:

1. **Keep-alive** com intervalo menor que a janela (~10 min), mantendo a sessão
   permanentemente viva. ~144 toques/dia no portal, e a sessão nunca "fecha" —
   decidir se isso é aceitável perante o carrier.
2. **Login manual antes de cada sincronização** (comportamento atual).
3. Guardar a senha e automatizar o login — contradiz a promessa da UI; seria uma
   mudança de produto, não de implementação.

A recaptura de contexto já implementada preserva a rotação de cookies e é
necessária, mas **não** resolve isto sozinha: ela prolonga a janela enquanto há
uso, não atravessa 24 h de ociosidade.

## Limites operacionais descobertos em produção (2026-07-30)

**Steel esgota PIDs e para de subir browser.** O container tinha `pids_limit: 256`.
Chrome forka ~25-30 processos por browser e o Steel **não os reapa** quando a
sessão é liberada: 14 sessões deixaram 58 processos Chrome e o container ficou em
253/256 PIDs, fazendo toda criação de sessão falhar com
`500 Browser launch timeout after 60000ms`. Memória estava folgada (320MB/2GB) —
o limite era de processos, não de RAM.

- Mitigado: `pids_limit` subiu para 1024 no compose.
- **Não resolvido**: o vazamento continua. Um cron diário vai reencontrar isso.
  Até a causa ser tratada, o container precisa de restart periódico.
- `docker restart` do Steel é seguro quando não há login interativo em andamento
  (`NationalLifeConnectionAttempt` sem linhas ativas): a sessão autenticada vive
  no banco e é re-semeada.
- **Não rodar sync concorrente com login interativo** — competem pelos mesmos PIDs.

**Steel roda um Chrome só — jobs concorrentes se matam.** Cinco sondagens
morreram com `Target page, context or browser has been closed` porque um tick do
keep-alive começou no meio delas: ao liberar sua sessão, derrubou a outra. O guard
de login interativo não via outros scripts. Resolvido com advisory lock do
Postgres (`lib/national-life/browser-lock.ts`), tomado pelo keep-alive e pelos
três scripts de sync. Sem ele, o sync diário seria morto pelo keep-alive.

**Upsert linha-a-linha é lento.** `persistInforcePolicies` faz um `upsert` por
apólice; 10 mil linhas levam minutos. Precisa de escrita em lote antes de virar
job agendado.

## Escrita / ações (não investigado)

A nav autenticada tem uma seção **`Illustrations`** (além de `Marketing`, `Tools`,
`Management`). Nada disso foi sondado. Criar illustration é operação de **escrita**
no carrier e tem perfil de risco diferente da leitura: exige idempotência real
(não duplicar submissão), tolerância a falha no meio de um wizard multi-passo, e
auditoria. O enum `BrowserJobOperation` hoje só tem `TEST_CONNECTION` e
`SYNC_CASE_READ`; os models `Illustration` / `IllustrationScenario` já existem no
schema. Fazer a mesma sondagem de rede da seção de Illustrations antes de desenhar.

## Bloqueio de modelagem (decisão pendente)

O destino atual do sync não serve para ingestão:

- `applyCaseObservation` chama `lockAuthorizedApplication` e **lança** se não achar
  um `Application` pré-existente. Só sabe *atualizar*.
- `InsuranceCase.prospectId` é **obrigatório** → ingerir do carrier exigiria
  inventar `Prospect` sintético.
- Estado do banco: `Prospect 0`, `Application 0`, `InsuranceCase 0`.

Já `Policy` tem a forma certa (`sourceProvider`, `sourceExternalId`,
`sourceUpdatedAt`, `policyNumber`, `carrier`, `status`, `clientId`, `agentId`) —
mas contém **2168 linhas de seed sintético** (`policyNumber` no padrão `NLG-0001`,
seis carriers com ~475 cada, 473 delas "National Life Group"). Escrever dado real
nessa tabela sem limpar o seed mistura real com fake no livro de negócios.

`ExternalReference` está vazia (0 linhas) e existe para esse propósito.

## Limpeza

As sondas foram copiadas para dentro do container em execução
(`/app/scripts/probe-portal.ts`, `probe-network.ts`) e **removidas** ao final.
Elas descriptografam a sessão e acessam o carrier — não deixar para trás.
