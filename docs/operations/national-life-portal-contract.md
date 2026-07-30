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
