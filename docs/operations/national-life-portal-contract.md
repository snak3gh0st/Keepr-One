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
