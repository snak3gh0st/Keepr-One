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
| `PLACEMENT_REPORT` | — | não emite XHR | ⛔ redireciona, sem grid |
| `CLIENT_INTELLIGENCE` | 2711 | GetJsonResult | ✅ 2690 gravados |
| `CORRESPONDENCE` | 64 | GetJsonResult | ✅ 64 gravados |
| `COMMISSIONS_PAYMENT_PORTAL` | 2 | GetJsonResult | ✅ 2 gravados |
| `PIP_PENDING` | 0 | GetJsonResult | ✅ vazio de verdade |
| `PENDING_GROSS_COMMISSIONS` | — | GetJsonResult | ⛔ resposta não é JSON |

## Como achar rotas sem adivinhar (2026-07-30)

A primeira versão deste documento listou rotas "extraídas da nav autenticada",
mas a sonda que as extraiu foi apagada na limpeza. A sessão seguinte herdou dois
nomes lembrados — `commissions-payment-portal`, `client-intelligence` — e nenhum
caminho. Adivinhar URL não é grátis: cada erro é uma requisição ao carrier contra
uma sessão de ~20 minutos.

`portalRoutesIn` (`lib/national-life/portal-routes.ts`) resolve isso de vez.
`scripts/national-life-describe-page.ts` agora reporta `routes` em toda página:

```
tsx scripts/national-life-describe-page.ts /agent/
```

Uma requisição devolveu **239 rotas** `/agent/`, o mapa completo do portal. Ids
de drill-down colapsam para `{id}`, então 9 mil links de apólice reportam como um
template, não como 9 mil rotas. As de negócio estão inventariadas abaixo — a
ferramenta sem a lista só adia o problema, porque redescobrir exige sessão viva,
e sessão viva exige um humano logando.

O lock foi verificado depois da rodada: `SELECT ... FROM pg_locks WHERE locktype
= 'advisory'` voltou vazio, então ele libera limpo. Importa porque o keep-alive
usa a variante que **pula** na contenção — um lock vazado o faria pular em
silêncio a cada 10 minutos até a sessão morrer.

O script também **toma o lock do browser agora, e espera por ele** em vez de
desistir (`withBrowserLockWaiting`). Foi o tick do keep-alive — a cada 10 min pelo
crontab do host — que matou cinco sondagens antes, e a leitura errada foi "rota
morta". Uma sondagem é barata de adiar e custa uma requisição ao carrier para
repetir. Passado o prazo ela ainda devolve `null` e sai com código 1: "nunca
rodou" não pode parecer "rodou e não achou nada".

### Grids novos encontrados (2026-07-30, campos reais lidos do carrier)

Nomes de campo abaixo vêm de `national-life-describe-grids.ts` — uma linha por
grid, só nome e tipo, nunca valores. `fetchNationalLifeGrid` já lê os três
primeiros sem código novo; falta o mapeamento linha→modelo e a decisão de onde
persistir.

**`CLIENT_INTELLIGENCE` — 2.710 registros.** O achado da rodada.

```
CreatedDate date-string    AgentName string        CustomerName string
PolicyNumber string        Description string      CallReason string
PhoneNumber string         EmailAddress string     CallCategoryID number
Category html              CaseDetailsId number    SystemCode string
CompanyCode string         IsFollowUp boolean      CaseDate string
FollowUpCaseDetailsId html PartyId string          CommissionImpact string
PolNoSysCodeComCode html   CustomerNameCaseDetailsId html
CovidFlag boolean          sCovidFlag null
```

É um log de atendimento/follow-up e o **único grid do portal com contato do
cliente** — `EmailAddress`, `PhoneNumber` — e com texto livre (`Description`,
`CallReason`). Por isso é o de maior valor e o de maior sensibilidade ao mesmo
tempo: texto livre contém o que o agente digitou, o que não é previsível. Tratar
como PII antes de persistir, não depois. `PartyId` é identificador de cliente e
`CommissionImpact` liga atendimento a dinheiro — as duas pontes mais úteis.

**`CORRESPONDENCE` — 64 registros.** Documentos por apólice.

```
DocumentDate html          DocumentType html       DocumentCategory html
PolicyNumber html          RefPolicyNumber string  FirstName string
LastName html              UserId string           ViewedStatus number
DocumentHandle number      EncryptedDocumentHandle string
AgentName null             Annuitant null
```

`EncryptedDocumentHandle` é o token de download — baixar o documento em si é
outra decisão (volume e armazenamento), separada de listar.

**`COMMISSIONS_PAYMENT_PORTAL` — 2 registros.** `GlobalId html`, `FullName string`,
`Corp_Ind string`. Minúsculo e ainda assim o que destrava o resto: mapeia o
`GlobalId` que toda linha de comissão carrega para um nome de beneficiário, que é
"de quem é esta comissão" respondido sem heurística. Custo de extração: uma
requisição.

**`PIP_PENDING` — 0 registros.** Vazio de verdade, não erro.

**`PENDING_GROSS_COMMISSIONS` — falha.** A página renderiza grid (redireciona para
`/personal`, colunas `AgentNumber`, NL Life, NL Annuities, NL Mutual Funds, LSW
Life, LSW Annuities, Variable Products) e emite `GetJsonResult`, mas o replay do
POST devolve `Unexpected end of JSON input` — mesma classe de `LIFE_PERSISTENCY`.
Steel estava em 16/1024 PIDs na hora, então **não** é exaustão de recurso: é o
endpoint. Precisa de investigação própria.

### Inventário de rotas de negócio (das 239, 2026-07-30)

Registrado aqui porque a lista é o ativo, não a ferramenta que a produziu: sem
isto, a próxima sessão precisa de um login humano só para redescobrir onde olhar
— exatamente o buraco que esta rodada existiu para fechar.

Já resolvidas (sondadas ou extraindo) estão nas tabelas acima. **Ainda não
sondadas**, em ordem de plausibilidade de conter dado do agente:

```
/agent/book-of-business/inforce-book/daily-unit-values
/agent/book-of-business/inforce-book/pip-contribution-increase
/agent/book-of-business/inforce-book/annuity-flow-report/past-due-contribution
/agent/book-of-business/inforce-book/annuity-flow-report/payroll-flow-changes
/agent/book-of-business/new-business/Transfer-Company-Information
/agent/book-of-business/service-forms
/agent/compensation/incentives/forecasted-incentives
/agent/compensation/incentives/premium-report-agency
/agent/sales-marketing/403b-457-retirement-business/plan-prospectus-report
/agent/tools/business-tools/national-life-tools/annuity-statements
/agent/tools/business-tools/illustrations
```

Duas ressalvas para quem pegar isto:

- `pip-pending-report` foi sondado (0 registros); `pip-contribution-increase`
  **não**. São páginas diferentes do mesmo programa.
- `annuity-flow-report` devolveu página de erro, mas seus **dois filhos nunca
  foram tentados**. "Essa subárvore está quebrada" ainda não é uma conclusão.

Há também cinco rotas `/agent/sso/*` (`foresight`, `foresight-annuity`,
`igo-eapp`, `xrae-link`, `forms-and-materials-search`): saltos para sistemas
terceiros, cada um com sua própria autenticação. Nenhum foi sondado e cada um é
um alvo de integração distinto, não uma página deste portal.

As ~180 rotas restantes são produto, treinamento e marketing — conteúdo
institucional, sem dado de negócio do agente. Não vale reandar. Para regerar o
inventário completo a qualquer momento, com sessão viva:

```
tsx scripts/national-life-describe-page.ts /agent/
```

### Rotas sondadas que não rendem grid

| rota | o que é |
|---|---|
| `placement-report` | redireciona para `/placement-report/agent`; zero tabelas, zero XHR |
| `annuity-flow-report` | devolve página de erro (`hidden \| errorPage`) |
| `compensation/incentives/current-incentives` | página de conteúdo, sem tabela |
| `tools/business-tools/reports` | página de navegação, sem tabela |
| `profile/agent-payment-center` | **formulário de escrita** (valores de pagamento) — perfil de risco de escrita, não de leitura |

> As 239 rotas restantes são produto, treinamento e marketing — conteúdo
> institucional, sem dado de negócio do agente.

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

## Prêmio e capital segurado: o caminho das páginas de detalhe está desmentido (2026-07-30)

**Não gastar 9.614 requisições nisso.** Medido com
`scripts/national-life-sample-policy-details.ts` em três amostras (20 + 8 + 12 =
40 carregamentos): `faceAmountHitRate` e `premiumHitRate` deram **0% em todas**.

O que torna esse zero confiável, e não um erro de sonda:

- **Controle `anyMoney`**: a página responde HTTP 200 mesmo para um `id` inválido,
  então "acessível" não prova nada sozinho. O controle mede se há *qualquer* cifra
  na página. Deu 87,5% numa amostra e 16,7% em outra — páginas reais, com
  conteúdo variável, não cascas vazias idênticas.
- **Bug de primeira ocorrência, corrigido antes de concluir**: a primeira versão
  testava só `pattern.exec()`, a primeira ocorrência. O menu de toda página diz
  "Premium Increase Program", então o casamento acontecia no nav, não achava `$`
  perto e desistia — reportando "sem prêmio" em 20 de 20 páginas por falso
  negativo. Corrigido para varrer todas as ocorrências e olhar 60 caracteres para
  trás também (rótulo à direita do valor). **Continuou 0%.** Mesma classe do bug
  de busca case-sensitive já registrado.
- **Estrutura confirma**: `describe-page` na página de detalhe mostra **uma única
  tabela**, alimentada por `GetJsonResult` com colunas `Date, Category, Detail`.
  É um histórico de atendimento, não um resumo financeiro da apólice.

Custo evitado: 13 a 17 horas de tráfego contra o carrier (medido em 4,8–6,4 s por
página), que não teriam trazido nem prêmio nem capital segurado.

### De onde o prêmio realmente vem

| fonte | cobertura | custo |
|---|---|---|
| `COMMISSION_DETAIL_NLD_COMMISSION_EARNING.PremiumAmt` | **2.148 de 9.614 apólices (22%)** | **zero** — já está no banco |
| `NEW_BUSINESS.AnticipatedAnnualPremium` / `ModalPremium` | os casos de novo negócio | já extraído |
| `PREMIUM_REPORT_AGENCY` | **agregado da agência, 2 linhas** | não serve por apólice — não voltar aqui |

`PremiumAmt` vem por transação, com `BillingFrequency` e `PremiumTransaction`
(`As Earned`) — é prêmio modal do lançamento, não anualizado.

**Decidido e aplicado (2026-07-30):** guardar o modal com o modo, não anualizar.
`Policy.premiumMode` foi acrescentado e o backfill
(`scripts/sql/national-life-backfill-premium-from-commissions.sql`) rodou em
produção: **2.148 apólices** com prêmio e modo, das 9.614.

```
Monthly 2145 | Quarterly 2 | Single Payment 1
```

A distribuição justifica a decisão: anualizar teria transformado três apólices
não-mensais em números errados sem deixar rastro. `$250` mensal e `$250` anual são
apólices diferentes, e só o par (valor, modo) diz qual é qual.

As 7.466 restantes ficam com `premium = 0` e `premiumMode = NULL`, que o front já
lê como "não informado" via `premiumIsKnown()` — não como zero.

### Capital segurado: sondado até o fim, não existe como dado no portal

Procurado em tudo que havia, e o resultado é negativo em todos:

| onde | resultado |
|---|---|
| grids mapeados | nenhuma chave `face`/`death`/`benefit`/`coverage` — verificado no banco, custo zero |
| páginas de detalhe por apólice | 0% em 40 carregamentos |
| `illustrations` ("Rapid Solve") | `faceAmount` é **campo de entrada** de cotação, não valor armazenado |
| `daily-unit-values` | cotação de fundos por subconta, não dado de apólice |
| `annuity-statements` | página de ajuda, sem tabela |

**Conclusão: o portal do agente não expõe capital segurado como dado.**
`Policy.faceAmount` fica 0 e a UI precisa poder dizer "não informado".

O único caminho plausível que resta são **os documentos da apólice**:
`CORRESPONDENCE` traz `EncryptedDocumentHandle`, o token de download do PDF onde
esse número mora. Isso é extração de documento e OCR/parse, não raspagem de grid
— outra ordem de esforço, e uma decisão de produto antes de técnica.

## Limite de PIDs do runtime: um erro que parece falha de banco

O container do runtime tinha `pids_limit: 128`, e **isso conta threads, não
processos**. O worker sozinho ocupa ~72; cada `docker exec ... tsx` acrescenta
~25. Rodar duas sondagens ao mesmo tempo esgotou o container:

```
sh: can't fork: Resource temporarily unavailable
PrismaClientRustPanicError: PANIC: timer has gone away
```

O segundo erro **parece falha do Postgres e não é** — é fome de thread no
container. Não diagnosticar banco a partir dele. `docker top` mostra os processos
reais; `docker stats` mostra a contagem de threads, que é a que bate no limite.

Subido para 512 no compose. Vale notar que é o mesmo padrão já documentado no
Steel, num container diferente e com um sintoma diferente.

## Prêmio e capital segurado: onde se procurou antes

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

## Estado do domínio após a rodada de 2026-07-30

Tudo medido em produção, não estimado.

| tabela | antes | depois |
|---|---|---|
| `Policy` com prêmio e modo | 0 | **2.148** de 9.614 |
| `Client` com e-mail | 180 | **1.585** de 8.824 |
| `Client` com telefone | 180 | **1.586** de 8.824 |
| `Client` com data de nascimento | — (sem coluna) | **8.643** de 8.824 |
| `NationalLifeReportRow` `CLIENT_INTELLIGENCE` | 0 | **2.690** |
| `NationalLifeReportRow` `CORRESPONDENCE` | 0 | **64** |

Nenhum desses custou requisição ao carrier além do próprio sync dos grids novos.

`CommissionRecord` continua em 0 **de propósito**: exige `policyId` e só 2.329 de
5.408 transações casam com uma apólice no livro. O dashboard e a página de
comissões leem `NationalLifeReportRow` por
`lib/national-life/commission-records.ts`, que é o que mostra 100% da comissão em
vez de 43%.

### O que continua aberto

- **`faceAmount`**: sem fonte no portal (ver acima). Caminho restante é o PDF via
  `EncryptedDocumentHandle`.
- **Cobertura de prêmio**: 22% do livro. Os outros 78% são apólices que não pagaram
  comissão no período extraído — não há outra fonte conhecida.
- **Casamento por nome**: cliente e apólice se ligam por `lower(name)` dentro do
  agente. É frágil contra grafia diferente e é o único identificador que as duas
  pontas compartilham. `PartyId` do `CLIENT_INTELLIGENCE` pode ser uma chave melhor
  — não investigado.
- **Rotas não sondadas**: `pip-contribution-increase`, os dois filhos de
  `annuity-flow-report`, `Transfer-Company-Information`, `service-forms`,
  `forecasted-incentives`, `plan-prospectus-report`.

## Rapid Solve: illustration como escrita no carrier (levantado 2026-07-30)

`/agent/tools/business-tools/illustrations` renderiza a ferramenta **Rapid Solve**.
Não é grid: é formulário de cálculo. Campos observados:

```
ddlIssueState            estado de emissão
firstName, lastName      segurado
birthday                 data de nascimento
ddlGender                sexo
FaceAmount_btn                    ← resolver POR capital segurado
Premium-DeathBenefitFocus_btn     ← resolver por prêmio, foco em benefício
Premium-AccumulationFocus_btn     ← resolver por prêmio, foco em acumulação
faceAmount   (number)    entrada
premiumAmount(number)    entrada
Strategy_dropdown, allocation     estratégia de índice
rapid_checkbox
get_quote    (submit)
```

Os três botões são **modos de solve**: informa-se um lado e o carrier devolve o
outro. Isso o torna útil para cotação nova — e **não** o torna fonte do capital
segurado das apólices existentes: aqui `faceAmount` é entrada de uma simulação,
não o valor contratado de uma apólice em vigor.

### O que o app tem hoje

`app/agent/illustrations/new/actions.ts` calcula por **fórmula local**
(`lib/policy-quote.ts`, `calculateMarketPremium`). Os números da tela de
illustration hoje são sintéticos, não vêm do carrier.

O modelo, por outro lado, já tem a forma certa: `Illustration` guarda `provider`,
`externalId`, `productName`, `faceAmount`, `premium`, `documentUrl`, `rawPayload`,
com `@@unique([provider, externalId])` — que é exatamente a chave de idempotência
que uma submissão ao carrier exige para não duplicar.

### Bloqueios reais antes de ligar isso

1. **`Illustration.caseId` é obrigatório** e `InsuranceCase` tem **0 linhas**.
   Criar illustration exigiria inventar um caso, ou tornar o vínculo opcional.
   Mesma classe do bloqueio de modelagem já registrado neste documento.
2. **`BrowserJobOperation` não tem operação de escrita** — só `TEST_CONNECTION` e
   `SYNC_CASE_READ`. Uma submissão precisa de tipo próprio para ser auditável.
3. **Perfil de risco diferente de tudo feito até aqui.** Todo o restante desta
   integração é leitura: repetir uma leitura é inofensivo. Uma submissão repetida
   não é. Precisa de idempotência real, e de tolerância a falha no meio.
4. **Contrato de submissão desconhecido.** Não se sabe se `get_quote` emite XHR
   com JSON (replicável via `page.request.post`, como os grids) ou se faz POST de
   formulário e re-renderiza. Isso decide a implementação inteira, e só se
   descobre **submetendo** — que é a primeira ação de escrita contra a conta real
   do agente. Decisão humana antes, não depois.

### Contrato do Rapid Solve (lido do bundle, sem submissão)

A página não tem `<form action>` nem handler inline — tudo está em
`/Assets/Agent/js/rapidsolve.js`. Buscar esse arquivo é **GET de asset
estático**: não toca estado de conta e não cria nada. Foi assim que o contrato
saiu, sem que nenhuma cotação fosse submetida.

```
POST /agent/RapidSolve/GetQuote
Content-Type: application/json; charset=utf-8
```

Corpo:

```jsonc
{
  "IssueState": "…", "FirstName": "…", "LastName": "…",
  "DateOfBirth": "MM/DD/YYYY",     // formato do date picker, não ISO
  "IssueAge": 41,                  // ANB — idade na data de aniversário mais próxima
  "Gender": "…", "RateClass": "…",
  "SolveType": "Specify_Amount" | "Based_on_Target_Premium" | "Min_DB_Max_Cash_Value",
  "Amount": 250000,                // capital OU prêmio, conforme SolveType
  "DeathBenefitOption": "…", "Strategy": "…", "Allocation": 100,
  "ProductCode": "956",            // ⚠ fixo no script do carrier
  "PremiumMode": "Monthly"         // ⚠ fixo no script do carrier
}
```

Resposta:

```jsonc
{ "Success": true, "FaceAmount": 0, "AnnualPremium": 0,
  "MonthlyPremium": 0, "LapseYear": 0 }
```

Detalhes que mudam a implementação:

- **`Success: false` chega com HTTP 200.** Status não distingue cotação de
  recusa; é preciso ler o corpo.
- **`LapseYear: 0` significa "não lapsa"**, não ano zero. `lib/national-life/
  rapid-solve.ts` converte para `null` para não exibir 0 como se fosse um ano.
- **`IssueAge` é ANB**, não idade no último aniversário. Usar o errado
  desprecifica toda cotação em um ano.
- **`ProductCode: "956"` e `PremiumMode: "Monthly"` são fixos no JS do carrier** —
  a tela não os escolhe. Se um dia vier cotação de produto errado, é aqui.
- **O Rapid Solve cota um único produto.** A sonda de produtos varreu o bundle
  inteiro e achou exatamente um código: `956`. **Term não é cotável por este
  endpoint** — o que é uma decisão de produto para a tela de illustration, já
  que a agência vende Term e IUL.
- **Os valores de `SolveType` são os `data-value` dos botões, não os ids.** O
  bundle monta o corpo com
  `$('[data-name="Quote-type"] .toggle-btn.active').data('value')`, e
  `Based_on_Target_Premium` / `Min_DB_Max_Cash_Value` só existem no HTML
  renderizado. `Premium-DeathBenefitFocus` e `Premium-AccumulationFocus` são
  **ids de elemento** (`..._btn`) e foram registrados aqui como valores de API
  por engano — enviá-los produz recusa da seguradora, que se lê como "não
  consigo cotar" em vez de "você perguntou errado".

Valores que a tela aceita, lidos dos `data-value`. A primeira sonda limitou a
lista a sessenta itens e a página tem exatamente sessenta valores — o corte caiu
na lista de estratégias e reportou uma só. Ao ler listas desta página, não
truncar: bater no limite é indistinguível de a lista terminar ali.

| campo | valores |
| --- | --- |
| `SolveType` | `Specify_Amount`, `Based_on_Target_Premium`, `Min_DB_Max_Cash_Value` |
| `RateClass` | `Standard_NT`, `Standard_Tobacco` — não há preferencial nem agravado |
| `Gender` | `Male`, `Female` |
| `DeathBenefitOption` | `A_Level`, `B_Increasing` |
| `Strategy` | `SP500PointToPointCapFocus`, `SP500PointToPointParFocus`, `SP500PointToPointOnePercentFloor` — escolher uma fixa `Allocation` em 100 |
| `IssueState` | 50 valores. **Nova York não está na lista** — não é omissão, não é oferecido |
- Existe também `/agent/RapidSolve/EAppSsoRedirect`, que leva a cotação para o
  e-App. É **escrita** e não foi tocado.

`lib/national-life/rapid-solve.ts` implementa requisição e parse, com testes.
Falta o transporte: o app web não fala com o Steel diretamente — passa pelo
runtime via `BrowserJobOperation`, que ainda não tem operação de escrita.

## Mapa do que é acionável (2026-07-30, fim do dia)

Escrito depois de um dia inteiro no portal, para a próxima sessão executar em
vez de redescobrir. As contagens foram medidas no `lifeos`, não estimadas.

### Já extraído e no banco

| dado | linhas | onde aparece |
| --- | --- | --- |
| Apólices inforce | 9.614 | `NationalLifeInforcePolicy`, tela de apólices |
| Clientes | 8.824 | `Client` — 1.585 com e-mail |
| Comissões por apólice | 5.408 | tela da apólice |
| Atendimentos (client intelligence) | 2.690 | tela da apólice, com sinal de risco |
| Casos (snapshots) | 802 | `NationalLifeCaseSnapshot` |
| Correspondência | 64 | tela da apólice |

### Confirmado indisponível

**Prêmio por apólice e capital segurado não vêm do portal.** As colunas `AAP` e
`AccumulatedCashValue` existem no relatório inforce e chegam nulas — verificado
agrupando por status e classe de produto, não por amostra: 3.647 IUL ativas,
3.624 Term ativas, e todas as demais, sem exceção. Também vêm nulos e-mail,
telefone e endereço do segurado e do titular.

### Cotação (Rapid Solve) — bloqueada no carrier

Transporte, tela e persistência prontos e testados. O `POST
/agent/RapidSolve/GetQuote` responde **HTTP 500** com a exceção escondida pelo
`customErrors` do ASP.NET.

Já eliminado por evidência, para ninguém refazer:

- autenticação e origem da página (o job navega para a ferramenta antes de postar)
- `content-type: application/json; charset=utf-8` e `x-requested-with`, iguais aos do `$.ajax` do bundle
- ~~token antiforgery — o script do carrier não envia nenhum, então nunca foi CSRF~~
  **ERRADO, e era essa a causa.** Capturar o request do próprio navegador mostrou
  `__requestverificationtoken` como header em toda chamada. O `$.ajax` do bundle
  não declara `headers`, e daí veio a conclusão errada — o token é adicionado em
  outro lugar. Sem ele o endpoint recusa, e o ASP.NET reporta a recusa como 500
  com o motivo escondido. Lido de `input[name="__RequestVerificationToken"]` na
  própria página, como o grid client já fazia para os relatórios.
- tipo do `Amount` — o bundle usa `parseFloat`, é número, e é o que mandamos
- nomes e valores dos campos, conferidos um a um contra o `formData` do bundle

> O aceite de termo visto na página **não é do quote**. A mesma página hospeda a
> seção de e-App, e um seletor de erro amplo demais misturou as duas. O único
> erro do formulário de cotação era falta de capital segurado, por o toggle de
> solve type não ter trocado.

Próximo passo mais barato: capturar o `GetQuote` do navegador de um humano
logado, com payload e headers. Se lá funciona, a diferença aparece na
comparação; se lá também dá 500, o problema não é do nosso código — pode ser
licenciamento do agente no estado, produto indisponível para a conta, ou o
endpoint quebrado.

### Não explorado, e o que cada um custa

| alvo | rota | o que é |
| --- | --- | --- |
| **iGo e-App** | `/agent/sso/igo-eapp` | Submissão de proposta. Sistema **terceiro**, autenticação própria — não é uma página deste portal, é uma integração inteira. |
| Foresight | `/agent/sso/foresight` | Idem, vida. |
| Foresight Annuity | `/agent/sso/foresight-annuity` | Idem, anuidade. |
| XRAE | `/agent/sso/xrae-link` | Idem. |
| Documentos por apólice | `CORRESPONDENCE` | 64 documentos para 9.614 apólices. Não é truncamento de paginação — o client pagina e o carrier parou. Suspeita de filtro de data padrão; sonda escrita em `national-life-describe-correspondence-filter.ts`, não rodada. Traz `EncryptedDocumentHandle`, que dá acesso ao PDF. |
| Drill-down por apólice | `policy-details?id=<32-hex>` | Id opaco vindo do grid inforce. Sessão anterior achou "Death Benefit" de forma inconsistente. |
| Drill-down por cliente | `client-information-details?id=<32-hex>` | Idem, nunca aberto. |

Os quatro SSO são alvos de integração distintos, cada um com sua própria
autenticação. Nenhum foi sondado, e "é só um link" é a leitura errada: o portal
entrega o salto, não os dados.

### A cotação vem com uma condição de uso (2026-07-30)

O formulário do Rapid Solve não cota sem que o corretor marque `#rapid_checkbox`,
cujo texto é:

> This is for agent use only. This may be used to provide a verbal quote to a
> consumer, but may not be shown to a consumer. Benefits and values shown are not
> guaranteed. The assumptions on which they are based are subject to change by
> the insurer and subject to approval of a completed application at issue.

A restrição acompanha o **número**, não o checkbox. Nossa tela mostra o mesmo
valor sem pedir aceite, então reproduz a condição junto do resultado.

Hoje não há exposição: `app/client/policies/[id]` lista apenas PDFs anexados,
não linhas de `Illustration`. Se algum dia uma tela de cliente ler essa tabela,
isso viola a condição da seguradora — não é preferência de produto.

### O Rapid Solve não gera documento (2026-07-30, verificado)

Cotação submetida com sucesso pelo formulário do carrier (HTTP 200). A área de
resultado oferece exatamente duas ações:

| controle | texto |
| --- | --- |
| `#continue_to_eapp` | SEND TO eAPP (abre em nova aba) |
| `#startover` | START OVER |

Não há imprimir, baixar, e-mail nem gerar PDF. Isso não é uma opção escondida:
casa com o termo que a ferramenta obriga a aceitar — *"may be used to provide a
verbal quote"*. O Rapid Solve entrega **números para uma conversa**, não um
documento para entregar ao cliente.

Então a ilustração como PDF vem de outro lugar, e o candidato é
`/agent/sso/foresight` — o sistema de ilustração da National Life, um dos cinco
saltos SSO, com autenticação própria e nunca sondado. `/agent/sso/igo-eapp` é o
sistema de **proposta**, que é para onde o botão acima leva, não o de ilustração.

Consequência de produto: pedir "a ilustração em PDF no app" é integrar o
Foresight, não estender o que foi construído hoje.

### Onde os saltos SSO caem (2026-07-30, sondado)

| alvo | cai em | sessão viaja? |
| --- | --- | --- |
| `/agent/sso/foresight` | `https://www.nationallife.com/NWI/Main/Layout.aspx` — *NLGroup Illustrations - Foresight Web* | **sim**, sem tela de login |
| `/agent/sso/igo-eapp` | salta por `nlg-prod.auth0.com` e termina em `federate.ipipeline.com` | navegação falhou |

Corrige o que ficou escrito acima nesta mesma sessão: **o Foresight não é
sistema terceiro.** É a mesma origem do portal, já na allowlist
(`NATIONAL_LIFE_PORTAL_ORIGINS`), e a sessão salva já entra autenticada. É o
sistema de ilustração da National Life e está alcançável hoje, com o que já
existe — não é uma integração nova.

O **iGo** é terceiro de verdade: iPipeline, com autenticação própria via Auth0.
Esse sim é uma integração à parte, e a sondagem nem chegou a carregar a página.

Ou seja, para o pedido "quero a ilustração em PDF para o cliente": o caminho é
o Foresight, e ele começa onde a sondagem parou — `NWI/Main/Layout.aspx`.

### Foresight tem autenticação própria, e ela decai antes do portal

Duas sondagens do mesmo `/agent/sso/foresight`, com minutos de diferença:

| momento | onde caiu |
| --- | --- |
| sessão mais fresca | `www.nationallife.com/NWI/Main/Layout.aspx`, autenticado |
| sessão a 3 min de expirar | `nlg-prod.auth0.com/login`, tela de login |

A cadeia real é `/agent/sso/foresight` → `/nwi/Main/FormPostAuth0.aspx` →
`nlg-prod.auth0.com/authorize` → ou o app, ou o login.

Então **"o Foresight entra autenticado" não é propriedade do sistema, é estado**.
Ele depende da sessão Auth0, não dos cookies do portal — e as duas morrem em
tempos diferentes. Isto é a descoberta operacional: **o keep-alive preserva o
portal e não preserva o SSO a jusante.** Ver [[project_national_life_session_limits]]:
a sessão do carrier morre em ~20 min e a re-autenticação silenciosa foi medida
como morta.

Consequência para quem for integrar o Foresight: a primeira pergunta não é
"como gerar o PDF", é **"como manter a sessão Auth0 viva"** — sem isso a sonda
mede a tela de login e conclui a coisa errada, que foi o que aconteceu aqui
duas vezes em sequência, com respostas opostas.

### O Foresight por dentro (mapeado 2026-07-31 13:28, sessão viva)

A ferramenta é WebForms clássico com **serviços ASMX JSON** — o que importa,
porque significa que existe contrato chamável, como o Rapid Solve, e não só tela.

Cadeia completa de entrada, agora com o retorno visível:
`/agent/sso/foresight` → `/nwi/Main/FormPostAuth0.aspx` →
`nlg-prod.auth0.com/authorize` → **`/NWI/Main/LoginCallback.ashx`** →
`/NWI/Main/FormPost.aspx` → `/NWI/Main/Layout.aspx`.

Estrutura: `Layout.aspx` é casca. O trabalho acontece no iframe
`ctl00_mobilityPH_iframeMain` → `StartPage.aspx` (*NLGroup Illustrations -
Foresight Web*), e há um segundo iframe de modal (`modalDialog__Iframe`).
Versão do app: `ForeSight.Release-5.3.65.30.js`.

Serviços que a própria abertura já chama:

| endpoint | verbo |
| --- | --- |
| `PageService.asmx/GetApplications` | POST |
| `ValidationMessagesService.asmx/GetAllMessages` | POST |
| `WidgetService.asmx/GetState` | GET |
| `WidgetService.asmx/GetInsuredInformation` | GET |
| `WidgetService.asmx/GetEAppStatus` | GET |
| `WidgetService.asmx/GetQuickCalcStatus` | GET |

Note `GetEAppStatus`: **o Foresight já sabe do e-App**, o que sugere que a ponte
ilustração → proposta existe dentro da própria ferramenta e talvez não precise
passar pelo salto separado do iGo.

Falta o endpoint que produz o documento. Ele não aparece nas chamadas de
abertura — está nos bundles que a página carrega, e é o que
`scripts/national-life-describe-foresight-services.ts` lê. **Esse script ainda
não rodou com sucesso**: as três tentativas caíram no muro, porque o SSO morreu
antes. É a primeira coisa a rodar na próxima janela viva.

### Resolvido: o keep-alive matava o SSO, e o contrato do PDF está mapeado

Com a flag **desligada** às 13:52, a sessão de 13:44 — cujo último cruzamento de
`/authorize` foi 13:50 — respondeu `NWI/Main/Layout.aspx` **autenticada** em uma
verificação feita bem depois. Sem toque periódico no IdP, ela vive. Com toque a
cada 10 min, morria em ~7. **A hipótese da inversão está confirmada: o keep-alive
do SSO era a causa, não o remédio.**

Regra operacional que decorre, e que a sonda agora cumpre: **quem cruza o SSO
recaptura e persiste o contexto**, em `finally`. Cruzar rotaciona o cookie
`auth0`; descartar o cookie rotacionado deixa o próximo job apresentando um
superado, que é o que o IdP trata como replay.

#### O contrato de geração do PDF

Lido dos próprios bundles do Foresight (`ForeSight.Release-5.3.65.30.js`,
`ForeSight.Release.Controls`, `Main.Release`), 23 endpoints ao todo:

| endpoint | papel |
| --- | --- |
| `PageService.asmx/IllustrateCase` | roda a ilustração |
| `PageService.asmx/RenderReports` | gera o relatório |
| `PageService.asmx/GetReportProgress` | acompanha até ficar pronto |
| `PageService.asmx/LaunchReportLoadingDialog` | diálogo de progresso |
| `PageService.asmx/SetupReportDisplay` | prepara a exibição |
| `/Main/DocuSignReportDisplay.aspx` | entrega o documento |
| `PageService.asmx/AbortReports` | cancela |

Lido o código em volta de cada chamada, a sequência e os argumentos saíram em
claro (`ForeSight.Main.Controls.ReportLoading` e `InformationContainer`):

```js
// 1. prepara, com a hora local formatada "h:mm:ss AM/PM"
sendRequest(appPath + "/Main/PageService.asmx/SetupReportDisplay",
            [$ITCommon.sessionTokenId(), "10:02:37 AM"])
// 2. dispara
sendRequest(appPath + "/Main/PageService.asmx/RenderReports",
            [$ITCommon.sessionTokenId()])
// 3. acompanha até terminar; a resposta traz HasException
sendRequest(appPath + "/Main/PageService.asmx/GetReportProgress",
            [$ITCommon.sessionTokenId()])
// 4. o documento
appPath + "/Main/ReportDisplay.rspx?SessionTokenId=" + $ITCommon.sessionTokenId()
```

Três fatos que isso fixa:

- **O único parâmetro real é `sessionTokenId`.** Não é o antiforgery do Rapid
  Solve: é um token de sessão do próprio Foresight, exposto no cliente por
  `$ITCommon.sessionTokenId()` e portanto legível da página.
- **O documento sai de `/Main/ReportDisplay.rspx`**, não do `.asmx`. O
  `DocuSignReportDisplay.aspx` é outra variante, para o fluxo de assinatura.
- **A hora é argumento**, formatada pelo cliente — detalhe pequeno que quebraria
  a chamada se fosse enviada em ISO.

O que ainda falta descobrir é o passo anterior: como carregar/definir o caso que
será ilustrado (`PageService.asmx/IllustrateCase`) — os bundles não mostraram o
call site dele nesta leitura, e é o que liga uma cotação nossa a um relatório
dele.

Resto do contrato, útil para o que vem depois: `GetPolicyInformation`,
`SetupSave`, `SetupSaveAs`, `SetupCopyTo`, `SetupClose`, `SetupInsMark`,
`ExpandCollapseMenuItem`, `CloseDialog`, e `WidgetService.asmx/GetQuickCalcData`.

#### ⚠️ `SetupEAppLauncher` muda a decisão sobre o iGo

`PageService.asmx/SetupEAppLauncher`, somado ao `WidgetService.asmx/GetEAppStatus`
já visto na abertura, diz que **o e-App é lançado de dentro do Foresight**. A
integração separada com `federate.ipipeline.com` provavelmente é desnecessária:
o caminho ilustração → proposta já existe dentro da ferramenta que a sessão do
portal alcança. Ver `docs/architecture/national-life-igo-eapp.md`, cuja premissa
— iGo como sistema terceiro a integrar à parte — precisa ser revista à luz disto.

#### Desenho que isso habilita

O PDF **não** precisa de sessão Auth0 permanentemente viva. Precisa dela viva no
instante do pedido. Então o salto entra dentro do job de gerar a ilustração:
cruzar, chamar `IllustrateCase`/`RenderReports`, buscar o documento, persistir o
contexto, sair. Nada toca o IdP fora disso — que é exatamente a condição sob a
qual ele foi medido sobrevivendo.

### A inversão: o keep-alive do SSO é o suspeito de **matar** a sessão

Confrontando os dois dias, com a variável certa isolada:

| | 2026-07-30 | 2026-07-31 |
| --- | --- | --- |
| salto atravessado a cada 10 min | **não** (flag inexistente) | **sim** |
| Foresight alcançável | **~11 h após o login** | **morto em ~7 min** |

Ontem a sondagem achou o Foresight autenticado cerca de onze horas depois do
login, com o keep-alive tocando **só o portal**. Hoje, cruzando o `/authorize` a
cada poucos minutos, morreu em sete. A intervenção criada para manter a sessão
viva correlaciona com a morte rápida; a ausência dela, com sobrevivência longa.

Mecanismo plausível, coerente com o que já foi medido: cada `/authorize` **gira**
o cookie `auth0` (visto: foi para momento+3d). Cada job monta um navegador novo a
partir do contexto salvo, então basta um script que cruze o salto e **não**
persista o cookie girado para que o próximo job apresente um cookie superado —
que é exatamente o sinal que um IdP trata como replay e responde invalidando a
sessão. `describe-foresight` e a sonda fazem isso: cruzam e não persistem.

**Ação tomada (13:52 UTC):** `NATIONAL_LIFE_KEEP_ALIVE_SSO_JUMP` removido do
env-file e container recriado (`printenv` = `false`). A sessão de 13:44, viva às
13:50, segue recebendo só toque de portal. O teste é **não olhar**: uma única
verificação horas depois. Se continuar alcançável, a hipótese está confirmada.

#### Consequência de produto, se confirmar

Não é preciso manter o Auth0 vivo continuamente — é preciso que ele esteja vivo
**no instante em que o agente pede o PDF**. Isso é mais simples e mais barato do
que um keep-alive: o salto vira parte do próprio job de gerar a ilustração, e
nada toca o IdP fora disso. Regra que decorre da hipótese e vale desde já:
**todo job que cruzar o SSO precisa recapturar e persistir o contexto**, como o
keep-alive faz e as sondas não fazem — cruzar sem persistir é o que envenena a
sessão seguinte.

### 2026-07-31 13:36 UTC: o salto **não** segura o Auth0, e o "12 h" era limite superior

Login novo às 13:25:00, com `NATIONAL_LIFE_KEEP_ALIVE_SSO_JUMP=true` já ligado —
ou seja, todo tique atravessando `/authorize` desde o primeiro minuto.

| hora | o quê | Foresight |
| --- | --- | --- |
| 13:26:06 | tique keep-alive | alcançável |
| ~13:28 | `describe-foresight` mapeou a ferramenta | alcançável |
| 13:30:23 | tique keep-alive | alcançável |
| ~13:32, ~13:34, ~13:36 | sondas | muro do Auth0 |
| 13:36:41 | tique keep-alive | muro do Auth0 |

**A sessão Auth0 morreu ~7 minutos depois do login, com o salto sendo
atravessado a cada 2 a 4 minutos.** Atravessar o `/authorize` não a mantém viva:
o experimento respondeu, muito mais rápido do que se esperava, e respondeu não.

Corrige o que esta doc afirmou horas antes: **o "12 h" nunca foi medido.** Ontem
só se sabia que estava morto às 03:55; ninguém olhou no intervalo. Era limite
superior, não duração — e hoje mostra que a morte cabe em minutos.

⚠️ Confundidor honesto, ainda não descartado: as próprias sondas podem ter
matado a sessão. Entre 13:26 e 13:32 entrei no Foresight de verdade uma vez
(`describe-foresight` carrega `StartPage.aspx` e os `WidgetService`), e fechar o
navegador no meio de uma sessão da ferramenta é candidato plausível a derrubar o
SSO. Separar isso agora é barato e **não custa código nenhum**: a coluna
`illustrationSsoReachable` grava o veredicto de cada tique, então basta um login
novo e **nenhuma sonda** — o instante em que ela vira `false` é a hora da morte,
medida limpa. Só depois disso vale concluir se a decisão é de credencial.

### Medido em 2026-07-31 03:55 UTC: confirmado, o Auth0 morre e o portal não

O par que faltava, dentro do mesmo intervalo de keep-alive:

| às | o quê | resultado |
| --- | --- | --- |
| 03:50:15 | keep-alive tocou `/agent/` | **autenticado** — só grava `lastUsedAt` depois de ver logout sem campo de senha |
| ~03:55 | `describe-foresight` saltou | `nlg-prod.auth0.com/login`, com `btn-login` e `entercodetxt` |

12 h após o login. Cadeia completa e sem bloqueio de origem:
`/agent/sso/foresight` → `/nwi/Main/FormPostAuth0.aspx` → `/authorize` →
`/login`. **A sessão Auth0 decai independentemente da do portal, e o keep-alive
como está não a alcança.** A ressalva abaixo fica registrada porque explica por
que isto precisou de uma terceira medição.

Consequência direta para o experimento seguinte: **não se renova sessão morta.**
Ligar `NATIONAL_LIFE_KEEP_ALIVE_SSO_JUMP` agora não ressuscita nada. O teste
válido é ligar a flag **antes** de um login novo, para que todo tique atravesse o
`/authorize` desde o início da vida da sessão, e horas depois perguntar de novo
ao `describe-foresight` se o Foresight ainda entra autenticado.

#### Estado em produção (2026-07-31 04:30 UTC): armado, faltando o login

Feito no btapps: checkout do runtime em `origin/main`, imagem reconstruída,
`NATIONAL_LIFE_KEEP_ALIVE_SSO_JUMP=true` gravado em
`/root/keeprone-national-life-runtime.env`, container recriado. Verificado dentro
do container (`printenv` = `true`).

Um tique manual do keep-alive com a flag ligada:

```json
{"alive":true,"refreshed":true,"cookies":29,
 "ssoJump":{"landedOn":"https://nlg-prod.auth0.com/login","onAuth0":true,"authenticated":false}}
```

O muro do Auth0 foi registrado e **ignorado** — a sessão do portal seguiu
`CONNECTED`. A regra "só o `/agent/` marca `SESSION_EXPIRED`" está demonstrada em
produção, com o caso adversário real, não em teste.

Falta só o que exige humano: **um login novo do carrier**. A partir dele o
crontab (`*/10`) atravessa o `/authorize` desde o primeiro tique; ~12 h depois,
rodar `describe-foresight`. Entrou autenticado → prazo de inatividade, a flag
resolveu. Muro na mesma marca → prazo absoluto, e é decisão de credencial.

#### O que a sonda mediu, e o critério que ela derrubou

Mesma sessão, minutos depois:

| cookie | antes do salto | depois do salto |
| --- | --- | --- |
| `nlg-prod.auth0.com \| auth0` | `2026-08-02T16:10:39` | `2026-08-03T04:04:17` (+713 min) |
| `nlg-prod.auth0.com \| auth0_compat` | idem | idem |
| `nlg-prod.auth0.com \| _csrf` | `2026-08-09T16:08` | `2026-08-10T04:04` |

Login foi 16:10 e a sonda rodou 04:04: os dois valores são exatamente
**momento + 3 dias**. O cookie `auth0` é rolante de 3 dias e **o salto o renova**.

E mesmo assim o salto caiu no muro de login. Então o cookie tinha mais dois dias
de validade enquanto a sessão por trás dele já estava morta. **Prazo de cookie
não é proxy da sessão do servidor** — o critério "prazo que avança = janela
ociosa" escrito abaixo está *refutado por esta medição*, e fica registrado só
para que ninguém o reinvente. O único veredicto confiável é onde o salto
**cai**.

Dois achados que continuam valendo, e são os que decidem:

- `portalTouchMoved` não moveu **nenhum** cookie do Auth0 — só analytics. Tocar
  `/agent/` de fato nunca alcança o IdP; o salto alcança. O mecanismo por trás da
  flag está confirmado.
- `jumpMoved.live.vanished` e `.appeared` vieram **vazios**, e `live` e `steel`
  vieram idênticos (o snapshot do Steel não está velho). O salto que cai no muro
  não degrada o jar, então o keep-alive recapturar depois dele é seguro. **É o
  sinal verde para ligar a flag.**

Como o cookie sobrevive 3 dias e a sessão morreu em ~12 h, o que expirou é o
lado servidor do SSO do tenant. Se esse prazo for de **inatividade**, um tique a
cada 10 min atravessando o `/authorize` o segura — e é exatamente o que a flag
faz. Se for **absoluto**, morre igual às 12 h e a resposta é credencial. Os dados
de hoje não separam os dois; só o experimento acima separa.

#### `carrierExpiresAt` está medindo um cookie da Cloudflare, não a sessão

O jar da sonda mostra quem é o mínimo que `deriveCarrierExpiresAt` escolhe:
`.insider.nationallife.com|__cf_bm` (Cloudflare bot management, 30 min fixos) e
`.nationallife.com|_hjSession_990012` (Hotjar, 30 min). Os dois expiravam
`04:20:11` e `04:20:12` — e o `carrierExpiresAt` gravado era `04:20:12`. A sonda
rodou às `04:23:25`, **3,2 min depois do prazo**, e o portal respondeu
`AUTHENTICATED`.

Ou seja o campo nunca mediu autenticação: mede o cookie de bot da Cloudflare, que
renova a cada requisição. É daí que veio o "~20 min deslizante" desta doc.

E não há conserto por filtro: os cookies de sessão reais do portal
(`ASP.NET_SessionId`, `ITMAuthentication`, `naac`, `ncac`) **não têm prazo** —
são cookies de sessão. Excluir analytics deixaria só os do Auth0, rolantes de 3
dias, que também não predizem nada: a sessão morreu em 12 h com eles válidos por
mais dois. **Nenhum prazo de cookie prevê a morte da sessão; só uma sonda
autenticada.** O comentário em `deriveCarrierExpiresAt` já dizia isso; a medição
agora mostra o quanto.

⚠️ Consequência de produto, não resolvida aqui: o card do agente e a página de
admin exibem esse valor como se fosse o prazo da sessão. É informação enganosa
para quem lê — decidir se vira "última verificação bem-sucedida" ou some.

#### Ponta solta: o Auth0 tem dois domínios aqui

`mfa.nationallife.com` é o domínio customizado do mesmo tenant e tem o seu
próprio par `auth0`/`auth0_compat`, gravado no login (16:10:37) e **não renovado
pelo salto** — que vai para o domínio canônico `nlg-prod.auth0.com`. No Auth0 os
dois domínios são jars de sessão distintos. Se a sessão SSO que o Foresight
consulta viver no domínio customizado, renovar o canônico não adianta. Some-se
que `mfa.nationallife.com` **não está** em `NATIONAL_LIFE_PORTAL_ORIGINS`, então
qualquer navegação de documento para lá é abortada pelo guard. Verificar
`blockedOrigins` na saída da sonda antes de concluir qualquer coisa sobre isto.

### Ressalva: "o Auth0 morre antes do portal" ainda não foi medido

Reler as duas sondagens acima com cuidado: a que falhou rodou **3 minutos antes
do `carrierExpiresAt`**, quando a sessão do portal também estava no fim. Nenhuma
execução até hoje reportou os dois veredictos — portal e Foresight — do mesmo
navegador, no mesmo minuto. Então "o Auth0 decai antes do portal" é compatível
com os dados, mas igualmente compatível com "tudo expirou junto". É hipótese,
não medição.

Some-se a isso que `deriveCarrierExpiresAt` tira o **mínimo** entre cookies de
`nationallife.com` **e** de `nlg-prod.auth0.com`. Se o cookie mais curto for o do
Auth0, o `carrierExpiresAt` que já está gravado no banco *é* o prazo do Auth0 —
e o "~20 min deslizante" da seção anterior estaria medindo outra coisa.

Lido direto no `lifeos` (`ssh btdb`) em 2026-07-31 03:51 UTC, com o keep-alive
rodando: `lastConnectedAt` 2026-07-30 16:10, `lastUsedAt` 03:50:15,
`carrierExpiresAt` 04:20:12 — **~30 min depois do último toque, 12 h depois do
login**. Ou seja o prazo mínimo *desliza a cada tique*: é cookie renovado pelo
toque no portal, não um relógio absoluto de 11 h como a leitura anterior sugeriu.
O que a sonda ainda precisa separar é se algum cookie do Auth0 acompanha esse
deslize ou fica parado — é literalmente a mesma pergunta, agora com nome de
campo.

`scripts/national-life-probe-foresight-session.ts` fecha essa lacuna numa
execução só:

| passo | o que responde |
| --- | --- |
| contexto salvo | inventário de cookies (domínio, nome, prazo — nunca o valor) |
| `/agent/` | o portal ainda está autenticado? |
| `/agent/sso/foresight` | cai na ferramenta ou no muro do Auth0? — mesmo navegador, mesmo minuto |
| diff dos prazos | o toque no portal moveu algum prazo do Auth0? e o salto? |

⚠️ O discriminador proposto aqui — `jumpMoved.live.moved`, "prazo que avança =
janela ociosa" — **foi refutado na primeira execução**: o cookie `auth0` avançou
para momento+3d enquanto o salto caía no muro de login. Ler a seção acima. O que
a sonda entrega de útil é o par de veredictos no mesmo minuto, o `vanished`, e a
confirmação de que o toque no portal não move nada do Auth0.

Duas leituras, de duas fontes, de propósito: `live` é o cookie jar do próprio
navegador, `steel` é o `sessions.context()`. O resto do código só chama o Steel
uma vez por job, no fim, então nunca se verificou se ele reflete o estado vivo no
meio da sessão. **Se `live` e `steel` discordarem, o snapshot do Steel está velho
— isso é achado sobre a ferramenta, não sobre o carrier, e não pode ser lido como
"o prazo é absoluto".**

Antes de ligar a flag, olhar também `jumpMoved.live.vanished`: se o salto derruba
o cookie do SSO, o keep-alive — que recaptura *depois* do salto — gravaria o jar
degradado por cima de um bom, piorando a cada tique.
Rode duas vezes, fresco e ~15 min depois: decaimento é pergunta de duas amostras.
E com o keep-alive rodando não há corrida contra o relógio — a leitura acima
mostra a sessão viva 12 h após o login, porque cada tique desliza a janela. A
sonda **não** precisa ser tiro único; a restrição real é colocar o arquivo dentro
do container.

`NATIONAL_LIFE_KEEP_ALIVE_SSO_JUMP=true` faz cada tique do keep-alive atravessar
`/agent/sso/foresight` antes de recapturar o contexto — o `/authorize` renova a
janela do Auth0 *se* ela for ociosa. Nasce **desligado**: ligar sem a medição só
acrescenta ~144 idas ao IdP do carrier por dia sem saber se compram algo.

Regra que o código garante: **só o `/agent/` pode marcar `SESSION_EXPIRED`.** O
resultado do salto é registrado no log e nunca vira decisão — um muro do Auth0
significa que o SSO a jusante caiu, não que a sessão do portal caiu, e agir sobre
ele jogaria fora uma sessão viva e obrigaria um humano a logar de novo.
