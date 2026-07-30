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
