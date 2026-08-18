# National Life como área de informação do Keepr One — leitura de entrada

Data: 2026-08-07
Autor: leitura independente do repo, feita do zero, com verificação em código
Estado: análise + recomendação. Nada foi alterado.

Pergunta que originou: *"sync com National Life Group sem API"* — e o desenho
proposto de headless browser com um bot interno empurrando para o Keepr One.

Resposta curta, e ela não é a esperada: **o mecanismo de sync já está resolvido
três vezes neste repo. O que não existe é o dado, e depois dele, o lugar onde
ele cai.** O headless browser com bot interno é exatamente o caminho que o
projeto já construiu, mediu e descartou — e o motivo do descarte é aritmético,
não de gosto.

---

## 1. O que existe hoje, verificado

Três caminhos de execução coexistem na árvore. Não é indecisão: são três
gerações, e só uma tem futuro.

| Caminho | Onde vive | Estado real |
| --- | --- | --- |
| **Steel / browserless server-side** | `workers/national-life/`, `Dockerfile.national-life-steel` | Ligado por padrão (`NATIONAL_LIFE_BROWSER_PROVIDER="steel"`). É o que roda hoje. Teto duro — ver §2. |
| **Runtime worker local** | `scripts/national-life-runtime.ts`, `Dockerfile.national-life-runtime` | Container separado, **não deployado pelo Coolify**, redeploy manual. É quem executa os jobs — e é ele que serializa no lock (§2). |
| **KeeproneConnect (extensão Chrome)** | `apps/keeprone-connect/`, `lib/national-life/local-connector/` | Arquitetura decidida. **Desligada por padrão** (`NATIONAL_LIFE_LOCAL_CONNECTOR_ENABLED="false"`). Não está na Store. |

### O contrato do portal está mapeado, e bem

`docs/operations/national-life-portal-contract.md` — 1.581 linhas de engenharia
reversa real, feita contra o portal autenticado. O achado que importa: **não se
raspa DOM.** O portal expõe uma API interna própria:

```
POST https://www.nationallife.com/agent/Datatable/GetJsonResult
```

Protocolo DataTables server-side, com `DatatableId` opaco lido da página.
Paginação por `start`/`length` até `recordsTotal`. Isso é qualitativamente
melhor que scraping: o que se repete é um `fetch` capturado, não um seletor CSS.

**Consequência de posicionamento, e ela é subestimada:** nosso problema de
manutenção é *drift de contrato de API*, não *drift de seletor*. Toda a
categoria de ferramenta que o mercado vende para este problema (Stagehand,
Browser Use, Skyvern, AgentQL) resolve a segunda. Não serve.

---

## 2. Por que "bot interno + headless" não escala — a aritmética

Tracei o caminho de chamada inteiro, não só a existência do lock.

`lib/national-life/browser-lock.ts:11`

```ts
const LOCK_KEY = 8_140_2601   // chave FIXA, global do deployment
```

E o motivo está no próprio docstring, que é o fato de infra por trás de tudo:

> *"Steel runs a single Chrome for this deployment."*

O caminho de produção o toma. `workers/national-life/runtime.ts:834` injeta
`runExclusively: (work) => withOwnedBrowserLockWaiting(...)`, e
`workers/national-life/run-job.ts:744` envolve **todo** job de carrier nele —
abrir sessão, autenticar, extrair, fechar.

Duas precisões que corrigem a leitura fácil:

- **Não é `try` que pula: é `waiting` que espera.** `withBrowserLockWaiting` faz
  poll a cada 5 s até um teto de **300 s** e então devolve `null`. Sob frota,
  isso não vira "pulei": vira **jobs enfileirados que expiram em 5 minutos** — o
  agente vê um sync que não falhou nem terminou.
- **O lock não é por conexão do pool por acidente.** `withOwnedBrowserLockWaiting`
  abre um client próprio e o fecha, porque o runtime nunca sai e o Prisma poderia
  desbloquear numa conexão diferente da que bloqueou — vazando o lock até o
  restart. O cuidado é correto e mostra que o lock é levado a sério como
  serializador real.

Some a isso (verificado em `workers/national-life/adapter.ts`):

- esperas fixas de 20 s (l. 422), 4 s (l. 480), 15 s (l. 485), 20 s (l. 704),
  mais polling de 3 s (l. 734) — **~59 s de espera fixa** por job do Foresight;
- a sessão do carrier morre em **~20 min**.

100 agentes × ~90 s serializados ≈ **2,5 h por rodada**. A sessão do agente 15
expira enquanto ele espera na fila. Não é caro: é impossível.

Existem `NATIONAL_LIFE_MAX_INTERACTIVE_SESSIONS` e
`NATIONAL_LIFE_MAX_SESSIONS_PER_SHARD`, o que sugere paralelismo planejado — mas
eles governam **sessões interativas de login**, e o lock fica acima da execução
dos jobs. O teto que vale é o do lock.

**E o caminho da extensão escapa dele — isto eu verifiquei, não inferi.**
`grep` por `withBrowserLock*` / `tryAcquireBrowserLock` em toda a árvore devolve
apenas `scripts/*` e `workers/national-life/`. `lib/national-life/local-connector/`
não tem **nenhuma** referência a lock: o browser é o do agente, na máquina do
agente. É esse fato — e não preferência de stack — que sustenta a decisão.

> Isso não condena o headless browser para *manutenção e sondagem*, onde ele é
> insubstituível (todo o `scripts/national-life-describe-*.ts` depende dele). Só
> o condena como **motor de produção para a frota**.

---

## 3. O teto que nenhuma arquitetura remove

Este é o ponto que a pergunta original não alcança, e é o que decide o projeto.

Os números abaixo **não são meus**: foram medidos contra o carrier real em
2026-07-30 e registrados em `docs/operations/national-life-portal-contract.md`.
Não tenho como reverificá-los sem sessão viva no portal — a provenance importa,
e é essa. O que verifiquei em código é tudo o mais neste documento.

- **`faceAmount` (capital segurado) não tem fonte no portal.** Nenhuma.
- `AAP` e `AccumulatedCashValue` chegam **nulos em 3.647 IUL ativas e 3.624 Term
  ativas** — sem uma exceção.
- **Prêmio cobre 22% do livro.**
- E-mail, telefone e endereço do segurado e do titular vêm nulos.

Trocar Steel por extensão, por Electron ou por qualquer outra coisa **não muda
um único desses números**. O transporte não cria dado que a origem não emite.

Único caminho remanescente para capital segurado: o PDF via
`EncryptedDocumentHandle`. Hoje esbarra em **64 documentos para 9.614 apólices**,
com suspeita de filtro de data default. A sonda que testaria essa hipótese
está escrita e **nunca foi executada** (`scripts/national-life-describe-correspondence-filter.ts`,
commit `8bded0e`).

---

## 4. O achado que eu não vi documentado: o dado é uma ilha

Verifiquei `prisma/schema.prisma`. `NationalLifeCaseSnapshot`,
`NationalLifeInforcePolicy` e `NationalLifeReportRow` têm **exatamente uma
relação**: `agentId → Agent`. Nenhuma para `Client`, `Policy`, `InsuranceCase`
ou `Application`.

E o consumidor é um só: `app/agent/integrations/national-life/data/page.tsx`.

Ou seja: **hoje a National Life não é uma área de informação do Keepr One. É uma
tela paralela que mostra dado da National Life.** O produto não fica mais
inteligente com o sync rodando — nenhum alerta, nenhum dashboard, nenhuma revisão
anual toca esses dados.

A ponte que existiria é `applyCaseObservation` (`lib/national-life/sync-service.ts:696`),
e ela está **estruturalmente fechada**:

```ts
const locked = await tx.lockAuthorizedApplication({ agentId, caseId, applicationId })
if (!locked) {
  throw new NationalLifeSyncError('National Life application not found …')
}
```

Ela **exige uma `Application` pré-existente**. Só atualiza o que já foi criado
pelo fluxo humano do Keepr One; nunca ingere. E `InsuranceCase.prospectId` é
obrigatório (`schema.prisma:524`), então nem o caso pode nascer do carrier sem
antes existir um prospect.

`ExternalReference` — a tabela que existe precisamente para casar identidade
externa com interna — é escrita **só por esse caminho fechado**
(`sync-service.ts:466`). Logo, está vazia.

**Isto é a maior lacuna do projeto e ninguém a nomeou como tal.** O trabalho
restante não é "sync". É **modelagem de ingestão**.

---

## 5. Todas as possibilidades, com veredicto

O pedido foi "todas as possibilidades". Elas cabem numa tabela — o valor está no
veredicto, não na lista.

### Transporte (como o dado sai do carrier)

| Opção | Veredicto |
| --- | --- |
| **Extensão Chrome (KeeproneConnect)** | ✅ **Única que escala.** Roda na máquina do agente, com a sessão dele. **Verificado: `local-connector/` não referencia o lock em lugar nenhum.** Já construída. |
| Steel/browserless server-side | ⚠️ Vivo hoje, teto em ~1 agente concorrente. Manter só para sondagem e manutenção. |
| Bot interno headless (a proposta) | ❌ É o item acima. Refutado pela aritmética do §2. |
| App desktop Electron | 🔵 **Plano B**, não A. Tira o review da Store e o relógio de update. **Não** estende a sessão, não remove MFA, não muda um-humano-por-credencial. ~US$ 219/ano. Tauri está excluído: WKWebView/ITP bloqueia cookie de terceiro em redirect SSO — a mesma classe de falha do Auth0 do Foresight, em stack nova. |
| Frameworks agênticos (Skyvern, Browser Use, Stagehand) | ❌ Resolvem drift de seletor; o nosso é drift de contrato. E movem o posicionamento para "agente de IA" — categoria bloqueada por padrão na Cloudflare desde set/2025. |
| CRX auto-hospedado | ❌ Morto no Windows (Chrome 33) e macOS (Chrome 44). |
| Política de empresa / força | ❌ Exige máquina gerenciada. As máquinas são pessoais. |
| Chrome Web Store *unlisted* | ⚠️ Não reduz o rigor do review. Mesma política, mesma trilha lenta (domínio financeiro + intercepta fetch no MAIN world + upload para terceiro). É o único caminho de distribuição. |

### Origem (de onde o dado vem)

| Opção | Veredicto |
| --- | --- |
| Grids do portal | ✅ Funciona. Mas é o teto do §3: sem `faceAmount`, prêmio a 22%, contato nulo. |
| **PDF via `EncryptedDocumentHandle`** | 🔑 **Único caminho conhecido para capital segurado.** Bloqueado em 64/9.614 docs. **Uma sonda não executada separa nós da resposta.** |
| **Feed do upline IMO/BGA** | 🔑 **Não é engenharia, e é o que pode destravar o §3.** Para `faceAmount` — campo sem fonte alguma no portal — pode ser o único caminho que existe. Merece uma ligação antes de mais código. |
| DTCC | ❌ Provável beco sem saída: LSW não é participante. |
| API oficial NLG | ❌ Não existe. É a premissa. |

### Destino (onde o dado cai) — **o gargalo real, e o não-endereçado**

| Opção | Veredicto |
| --- | --- |
| Tabelas-sombra + tela própria (hoje) | ⚠️ Funciona e não integra nada. É o estado atual. |
| **Ingestão via `ExternalReference`** | 🔑 **O trabalho que falta.** A tabela existe exatamente para isto e está vazia. |
| Afrouxar `applyCaseObservation` | ⚠️ Tratar com cuidado: o `throw` é uma checagem de autorização (`lockAuthorizedApplication`), não burocracia. O caminho é um *upsert* de ingestão novo, não relaxar o existente. |

---

## 6. Estado de entrega — o que está mesmo pronto

Chequei porque o commit mais recente do branch é literalmente
`docs: a lista de ordem estava mentindo sobre o que já foi feito`. Ceticismo bem
calibrado, então:

**Verificado como feito** (todos existem em código):
- `x-fyntra-connector-version` — `local-connector/remote-config.ts:21`
- Paridade de falha `RECONNECT_CODES` — `connector-failure-parity.test.ts`
- Varredores + disparo no boot — `instrumentation.ts`, com `try/catch` correto
- `storageKey` no `NationalLifeForesightDocument` — `schema.prisma`
- Índices das varreduras — migration `20260806010000`

**Mas — e isto muda o que se reporta a um stakeholder:**

```
main:  4ff1328  2026-08-05  docs: registrar decisão de arquitetura
HEAD:  23 commits à frente, não merjados
```

Isto não diz que `main` está vazio — o caminho Steel, o schema, `sync-service.ts`
e a maior parte de `lib/national-life/` já estão lá. Diz que **nada desta rodada
de hardening está em `main`**. Todo ele —
varredores, tolerância de versão, kill switch, PDF fora do Postgres, a pausa que
alcança o run em voo — está num branch de 23 commits esperando re-review.
**"Feito" aqui significa "feito e não entregue".**

Pendências operacionais que ninguém pode fazer por código: redeploy manual do
container do runtime (não sai no push para `main`), backfill do PDF em produção,
e o drop da coluna `bytes` em migração separada depois disso.

---

## 7. Recomendação

A pergunta "como sincronizar sem API" já tem resposta construída. As três coisas
que decidem o projeto não são de transporte.

**1. Rodar a sonda de correspondência. Hoje.**
`tsx scripts/national-life-describe-correspondence-filter.ts`
Custo: minutos. Retorno: se o filtro de data for a causa dos 64 documentos,
destrava o **único caminho conhecido para capital segurado**. É a maior
informação por minuto disponível no projeto inteiro, e está parada.

**2. Ligar para o upline IMO/BGA antes de escrever mais código.**
Para `faceAmount` não existe fonte no portal. Nenhuma arquitetura resolve isso.
Se o BGA fornece feed, ele resolve — e reordena tudo o que vem depois.

**3. Fechar a ingestão — é o trabalho não-endereçado.**
Enquanto `ExternalReference` estiver vazia, o sync alimenta uma tela, não um
produto. Um upsert de ingestão que crie `Client`/`Policy` a partir do snapshot,
com identidade em `ExternalReference`, é o que transforma "temos os dados da
National Life" em "o Keepr One ficou mais inteligente". As 2.168 linhas de seed
sintético em `Policy` (`NLG-0001`) precisam sair no mesmo movimento.

**Em paralelo, e sem competir com o acima:** merjar os 23 commits, submeter à
Store (com data de decisão — a trilha é lenta e não é acelerável), e obter o
**producer agreement** assinado pelo agente. É ele que governa, não o ToS
público, e é bloqueante para escalar — não para o piloto.

### O que eu não faria

Reabrir a escolha de transporte. Ela foi feita com medição, e a medição está
correta — reverifiquei o lock. Trocar extensão por Electron, por agente de IA ou
por um bot interno melhor não adiciona um campo ao dado nem uma linha a
`ExternalReference`.

---

# Atualização 2026-08-17 — cobertura do KeeproneConnect

Reverificação em código, na branch `codex/fix-national-life-runtime-server-only`.
Suíte verde: 757 testes de servidor (`lib/national-life`) + 147 da extensão.

## 8. Quanto do portal estamos pegando: 12 de 30

Número derivado de `nationalLifeReadCoverageSummary()`, não estimado:

```
{ required: 30, automatic: 12, remaining: 18 }
```

E o run padrão lê exatamente esses 12, porque
`LOCAL_CONNECTOR_DEFAULT_GRID_KEYS = NATIONAL_LIFE_SYNC_STAGES = NATIONAL_LIFE_AUTOMATIC_GRID_KEYS`
(`run-service.ts:43`, `sync-progress.ts:4`).

Os 18 que faltam se dividem em dois grupos com naturezas opostas:

| Grupo | Qtd | Estado real |
| --- | --- | --- |
| Páginas de descoberta (`NEEDS_COLLECTOR` + `NEEDS_PROBE`) | 14 | **Código pronto dos dois lados.** Só não são planejadas porque `NATIONAL_LIFE_LOCAL_CONNECTOR_PAGE_DISCOVERY_ENABLED` está desligada. |
| Detalhes de entidade + documentos (`ON_DEMAND`, `CORRESPONDENCE_DOCUMENTS`) | 4 | **Nenhum executor existe.** `CLIENT_DETAIL`, `POLICY_DETAIL`, `NEW_BUSINESS_CASE_DETAIL`, `CORRESPONDENCE_DOCUMENTS`. |

O primeiro grupo é configuração. O segundo é código que ninguém escreveu ainda —
e é onde, segundo a varredura de 2026-08-13, mora o dado que o §3 declarou
inexistente. Essa afirmação está contestada; ver §9.

## 9. O que o documento acima ainda afirma, revisto

**§6 — "23 commits à frente de `main`, nada merjado".** Obsoleto.
`git log main..HEAD` devolve **5**. Os PRs #38–#54 foram merjados. O hardening
está em `main`.

**§3 — "`faceAmount` não tem fonte no portal. Nenhuma."** ~~Contestado~~
**Resolvido em 2026-08-17, sessão viva, verificado por mim ao vivo (Policy #
LS1473219).**

Abri `policy-details?id=<32-hex>` sem clicar em nada e rolei a página — sem
interação nenhuma além de scroll:

```
Coverage Details
  Total Face Amount: $133,000.00
  Net Death Benefit: $133,000.00
  Guideline Premium Limit: $41,760.60 through 06/10/2027
  MEC Limit: $29,461.28 through 06/10/2027
```

Aba `VALUES` (um clique):

```
Accumulated Cash Value: $4,467.92
Surrender Penalty: $2,541.63
Net Cash Value: $2,031.44
Maximum Loan Available / Outstanding Balance / Interest Rate
Strategy Values (por subconta, com percentual)
```

A sonda de 07-30 não estava errada em metodologia — usou browser real e tinha
controle (`anyMoney` 87,5%/16,7%). O que ela mediu foi **conteúdo que não
carregou a tempo**: 3 s de espera fixa após `domcontentloaded` não foi
suficiente para a seção `Coverage Details`, que fica abaixo da dobra na aba
`POLICY` (default) — nenhuma aba escondida precisou ser clicada para o face
amount; só rolar. A leitura de `describe-page` como "uma única tabela
Date/Category/Detail" é inconsistente com o que a página mostra hoje; pode ter
sido outra rota, ou a página mudou de estrutura entre 07-30 e agora.

**Consequência para o projeto:** `READ_POLICY_DETAIL` é o caminho confirmado
para face amount, net death benefit e cash value. Vale a pena escrever o
executor. Ver §12.

**§3 — "e-mail, telefone e endereço vêm nulos".** Endereçado no código, **não
medido contra o portal**, pelo export oficial.
`buildOfficialExportRequest` força `IsEnableContactFields: true`
(`apps/keeprone-connect/lib/official-export-request.ts`), e
`toInforcePolicySnapshot` já mapeia os cabeçalhos do XLSX além dos campos da API:
`Owner Email`, `Insured/Annuitant Phone`, `Owner Address Line 1`, etc.
(`inforce-policy-service.ts:96-118`). Falta ligar
`NATIONAL_LIFE_LOCAL_CONNECTOR_EXPORT_ENABLED`.

**§4 — o dado é uma ilha.** *Continua verdadeiro na parte que importa.*
`externalReference` só é escrito em `sync-service.ts:466`, o caminho fechado por
`lockAuthorizedApplication`. O commit `0147c25` passou a ler os dados em
`app/agent/page.tsx`, `commissions/page.tsx` e `policies/[id]/page.tsx`, então
"um único consumidor" caiu — mas isso é leitura, não ingestão. Nenhum
`Client`/`Policy` nasce do carrier.

## 10. Onde exatamente o sync para hoje

Cadeia verificada, do flag ao executor:

- `runs/route.ts:44-79` — lê `isNationalLifePageDiscoveryEnabled()` e
  `isNationalLifeExportEnabled()`; ambos default `false`
  (`config.ts:128,137`). Sem eles, `startLocalConnectorRun` recebe o plano padrão de 12.
- A extensão **já declara as três capabilities**: `IMPLEMENTED_CAPABILITIES =
  ['READ_GRID','READ_PAGE','READ_EXPORT']` (`apps/keeprone-connect/lib/capabilities.ts:14`),
  versão 0.1.15. Não é gate de cliente.
- `READ_EXPORT` está inteiro ponta a ponta: `BEGIN_EXPORT` → `EXPORT_CHUNK` →
  `EXPORT_DONE` no `background.ts:726-1046`, e as rotas
  `local-connector/exports/[uploadId]/{chunks,complete}` + `export-workbook.ts` no servidor.
- `planReadPageStages` cobre as 14 chaves de descoberta e todas passam por
  `isRoutedGrid` — `raw-ingest.ts:35-49` já roteia cada uma para `REPORT_ROW`.

### Três armadilhas que fazem a flag parecer inerte

**1. Um run recente ignora o plano novo.** `startLocalConnectorRun` só usa
`options.gridKeys` quando **não existe** run ativo — e "ativo" inclui `COMPLETED`
dentro de `LOCAL_CONNECTOR_VERIFIED_FRESH_MS` (24 h), além de `FAILED`/`PARTIAL`
na mesma janela. `planChanged` compara apenas `activePlan.length !==
storedPlan.length` (chave depreciada removida); nunca compara com o que a chamada
pediu. O comentário em `run-service.ts:359` diz isso explicitamente.
O botão **Sync** da UI chama `startSync()` sem `forceRefresh`
(`NationalLifeLocalConnectorCard.tsx:357`); só o **Full refresh**
(l. 383) manda `forceRefresh: true`. Depois de ligar a flag, o teste tem de ser
pelo Full refresh — ou esperar 24 h.

**2. `EXPORT_ENABLED` exige extensão ≥ 0.1.15 instalada.**
`isNationalLifeExportEnabled() && supportsExportProtocol(headers)`, e
`EXPORT_PROTOCOL_VERSION = [0,1,15,0]` (`remote-config.ts:37`) — exatamente a
versão do repo. Em modo piloto (unpacked), a build carregada na máquina do agente
precisa ser reconstruída, senão a flag é inerte e silenciosa.

**3. "26 fontes" é plano, não dado.** Das 14 páginas, 9 são `NEEDS_PROBE` — e
`read-coverage.ts:47` já avisa: *"a probe is evidence, not completion"*. O retorno
honesto é **26 planejadas, 12 provadas, 14 medidas pela primeira vez**. Uma página
que exija submeter filtro/data antes de renderizar linhas vai falhar ou capturar
só o chrome, e `failLocalConnectorStage` leva o run a `PARTIAL` /
`SOURCE_PARTIAL_FAILURE`. Por isso: **um agente piloto primeiro, não a frota** —
para agentes não-técnicos, "PARTIAL" lê-se como quebrado.

Dois defeitos menores no caminho:

1. `NATIONAL_LIFE_LOCAL_CONNECTOR_PAGE_DISCOVERY_ENABLED` **não está no
   `.env.example`**, embora `EXPORT_ENABLED` esteja. Um operador não descobre a
   flag que dobra a cobertura.
2. O comentário em `config.ts:125` ainda diz "the proven 13-grid plan"; o array
   tem 12 desde a depreciação de `PROJECTED_COMMISSIONS`.

## 11. A run ao vivo de 2026-08-17 — resultado real, não simulado

Com as três flags ligadas em produção (`ENABLED`, `EXPORT_ENABLED` já estava
`true` de antes; `PAGE_DISCOVERY_ENABLED` ligada nesta sessão) e a extensão
0.1.15 carregada, rodei um sync completo contra o portal vivo do agente
`felipe@keeprone.com`. Run `cmsxrtar90003pj01c0j9wr4d`, 2026-08-17 21:53–22:16
UTC.

**Resultado: `PARTIAL`, 20 de 26 fontes escreveram dado, 6 falharam — todas
`retryable`, nenhuma travou o run.**

| Fonte | Recebido/Escrito |
| --- | --- |
| `CLIENT_INTELLIGENCE` | 2.692 |
| `TRANSFER_COMPANY_INFORMATION` | 1.399 |
| `NEW_BUSINESS` | 857 recebidos / 713 escritos |
| `RECENTLY_CLOSED` | 143 / 122 |
| `AGENT_DASHBOARD` | 256 |
| `CORRESPONDENCE` | 94 (índice de documentos, não os PDFs) |
| `COMMISSIONS_OVERVIEW`, `POLICY_PAYMENT_HISTORY`, `PENDING_GROSS_COMMISSIONS`, `COMMISSIONS_POLICY_HISTORY`, `DAILY_UNIT_VALUES`, `PIP_CONTRIBUTION_INCREASE`, `INFORMAL_REQUESTS` | ~225–245 cada |
| `PAID_COMMISSIONS`, `COMMISSIONS_EARNING_REPORT`, `PAYABLE_GROSS_COMMISSIONS`, `COMMISSIONS_PAYMENT_PORTAL` | valores pequenos, sem rejeição |
| `LIFE_PENDING_LAPSE`, `PIP_PENDING`, `TRANSFERS_EXCHANGES` | 0 — portal respondeu vazio, sem erro (livro sem casos nessas categorias agora) |

**Falharam (6), todas `retryable`:**

- `INFORCE_CLIENTS` → `PORTAL_REQUEST_FAILED`. É a etapa `READ_EXPORT`: o
  `POST /agent/Datatable/DownloadExcel` não respondeu OK na primeira tentativa.
  Confirma o que o §9 já marcava como "endereçado no código, não medido" — agora
  está medido, e falhou uma vez. Precisa investigar se é intermitente ou
  sistemático antes de confiar nele em produção.
- `PREMIUM_REPORT_AGENCY`, `LIFE_PERSISTENCY`, `PLACEMENT_REPORT`,
  `ANNUITY_PAST_DUE_CONTRIBUTIONS`, `ANNUITY_PAYROLL_FLOW_CHANGES` →
  `PORTAL_ROUTE_CHANGED`. A extensão navegou até a URL esperada repetidas vezes
  e a aba nunca chegou lá — o carrier redireciona para outra tela. Confirma a
  natureza `NEEDS_PROBE` dessas 5: não são rota direta, precisam de
  filtro/formulário antes de existir como página própria. Não é bug da
  extensão; é o catálogo assumindo rota que o portal não oferece assim.

## 12. Capital segurado — resolvido ao vivo, mesma sessão

Abri manualmente `policy-details?id=<hex>` de uma apólice do book (LS1473219,
Enrico Abdalla). **Face amount, net death benefit e cash value estão lá**, sem
precisar de interação nenhuma além de rolar a página e clicar na aba `VALUES`.
Detalhe completo em §9. Isso fecha a contradição que travava a decisão sobre
`READ_POLICY_DETAIL` — ver §13.

## 13. Documentos — o endpoint existe, e devolve o PDF direto

Também ao vivo: a aba `DOCUMENTS` de cada apólice lista documentos (Annual
Statements, Confirmation Statements, etc.) com "Retrieve Selected" e "Merge All
PDF". Selecionar um e clicar Retrieve dispara:

```
POST /agent/Document/GetDocumentViewerUrl
  → abre nova aba: /agent/correspondence/documentviewer?id=<32-hex>
```

Essa segunda URL é servida pelo **visualizador nativo de PDF do Chrome** — a
extensão de automação nem consegue tirar screenshot dela ("cannot attach to
this target"), o que por si confirma que é um `GET` autenticado por cookie que
devolve os bytes do PDF diretamente, sem wrapper de app. Mesmo padrão do
`EncryptedDocumentHandle` já mapeado em `CORRESPONDENCE`.

**Isso é bom sinal para `CORRESPONDENCE_DOCUMENTS`**: o mecanismo de busca é um
`fetch` autenticado simples — a mesma classe de trabalho que `READ_EXPORT` já
resolveu (baixar bytes, hash, enviar em chunks). Não foi medido se o PDF é
texto extraível ou imagem escaneada (decide se basta parse ou se precisa OCR) —
isso ainda é sonda de conteúdo, não de mecanismo.

## 14. Ordem revista, com o que a sessão de hoje já decidiu

1. ~~Ligar as duas flags~~ **Feito e medido.** 20/26 fontes confirmadas
   funcionando ao vivo; 6 identificadas com causa clara (ver §11). Duas ficam
   pendentes: por que `READ_EXPORT` falhou uma vez (retry manual resolveria, ou
   é sistemático?), e se as 5 `PORTAL_ROUTE_CHANGED` precisam de filtro/data
   antes de navegar — provável correção de catálogo, não de arquitetura.
2. **`READ_POLICY_DETAIL` está confirmado e vale escrever.** Não é mais aposta —
   é a entrega nº 2 do contrato de 2026-08-13, com o campo exato (Coverage
   Details + Values tab) e a URL (`policy-details?id=`) já mapeados por esta
   sessão.
3. **`CORRESPONDENCE_DOCUMENTS` também está mais barato do que parecia** — o
   mecanismo é `fetch` + `GetDocumentViewerUrl`, não scraping. Pode entrar no
   mesmo lote que `READ_POLICY_DETAIL`, já que ambos são "abrir uma tela
   adicional e extrair o que já é renderizado", a mesma classe de trabalho.
4. **Fechar a ingestão** — inalterado do §7.3. Continua sendo o gargalo de
   produto, e nenhuma das entregas acima o resolve: os dados continuam numa
   tela paralela até o upsert em `ExternalReference` existir.

A sonda de correspondência antiga (§7.1, script não executado) fica obsoleta:
media uma hipótese sobre 64/9.614 documentos por causa de um suposto filtro de
data. A sessão de hoje já confirma que o mecanismo de busca funciona por
handle individual, não por essa listagem — a pergunta que a sonda faria deixou
de ser a pergunta certa.

## 15. Continuação da mesma sessão: as três tarefas do punch list

### 15.1 O "hang" em READ_PAGE não existe — hipótese refutada com evidência de banco

A hipótese herdada da sessão anterior ("o coletor trava em página com tabela
vazia") não sobreviveu à leitura do código nem à consulta ao Postgres de
produção:

- `capturePageSnapshot` (`apps/keeprone-connect/lib/page-snapshot.ts`) é uma
  função síncrona e pura. Não espera tabela popular, não tem noção de "página
  pronta" — captura o DOM no instante em que a mensagem `CAPTURE_PAGE` chega.
- `capturePageWithRetry` (`background.ts`) só retenta se o ack não bater com o
  esperado; não há espera por conteúdo.
- Consulta direta no Postgres (`NationalLifeConnectorStageFailure`, run
  `cmsxrtar90003pj01c0j9wr4d`): as 6 falhas foram gravadas entre 23:26:10 e
  23:31:10 UTC, em cadência de ~60s — exatamente `SYNC_WATCHDOG_ALARM` (1 min)
  × `MAX_STAGE_NAVIGATION_ATTEMPTS` (2). O run avançou e terminou sozinho
  (`PARTIAL`); não há nenhum `NationalLifeSyncRun` criado após 22:49 UTC no
  dia. O que a sessão anterior viu como "travado" era um retry em andamento,
  observado no meio de uma sessão de debug manual que também tinha um diálogo
  nativo do Chrome ("keep me logged in") bloqueando a automação (ver memória
  `project_national_life_sync_live_run_2026_08_17`) — confundidor plausível,
  não reproduzido como defeito do coletor.
- Naveguei ao vivo para `annuity-flow-report/past-due-contribution/personal`:
  carrega direto, sem redirect, estado vazio real. Nenhum código foi alterado
  para este item — não havia o que corrigir.

### 15.2 INFORCE_CLIENTS / READ_EXPORT: causa raiz encontrada e corrigida

Reproduzi o `PORTAL_REQUEST_FAILED` isolado, ao vivo, comparando byte a byte o
corpo que a extensão reconstrói (`buildOfficialExportRequest`) com o corpo que
o próprio botão "Download" da UI envia (capturado via patch de
`XMLHttpRequest.prototype.send`, sem tocar em cookies). Divergência real: o
nosso corpo incluía um campo `page` que a UI nunca envia — só `draw`, `start`,
`length`, `columns`, `order`, `DatatableId`, `IsEnableContactFields`.

Corrigido com TDD em `apps/keeprone-connect/lib/official-export-request.ts`
(campo `page` removido de `modelFromServerRenderedConfig`), teste novo em
`official-export-request.test.ts` comparando a forma exata do payload capturado
ao vivo. Extensão reconstruída, versão `0.1.16`.

Não ficou provado que esse campo extra é a causa dos HTTP 500 medidos em
produção (abrir o diálogo de download na UI real também disparou 3× 500
automaticamente, antes de qualquer clique — sugere alguma instabilidade do
lado do carrier independente do payload), mas é uma divergência de contrato
real e concreta, e vale corrigir de qualquer forma.

**Medido em produção, mesma sessão:** extensão recarregada (v0.1.16), sync
disparado via `app.keeprone.com/agent/integrations/national-life` → "Sync
National Life". Run `cmsxrtar90003pj01c0j9wr4d` retomado, `INFORCE_CLIENTS`
completou com **10.926 registros recebidos / 10.802 gravados, sem
truncamento** — contra 0 registros / `PORTAL_REQUEST_FAILED` antes do fix.
`resolvedAt` da falha antiga ficou marcado. Confirmado: o fix resolve o
problema. Run terminou `PARTIAL` só pelas 5 rotas `PORTAL_ROUTE_CHANGED`
(catálogo, item pendente separado) — 21 de 26 fontes ok agora, subindo de
20/26.

### 15.3 READ_POLICY_DETAIL: o bloqueio de desenho resolvido, a capability não

O bloqueio nomeado no punch list — `isSafeNavigatePath` rejeita qualquer `?`,
e `policy-details?id=<hex>` precisa de um `?` — está resolvido como uma
primitiva isolada e testada, **não** como a capability inteira ligada.

Decisão de desenho: `isSafeNavigatePath` continua uma allowlist de catálogo
fechado (fica rejeitando todo `?`, de propósito — afrouxar isso abriria `?`
para qualquer rota estática, não só esta). Em vez disso, uma segunda função,
estreita e separada, cobre só esta página:

- `policyDetailNavigatePath(id)` — monta `policy-details?id=<id>`, lança
  `UNSAFE_ENTITY_ID` se `id` não for exatamente 32 hex minúsculos (a forma que
  os links do próprio portal usam, verificada ao vivo).
- `isSafePolicyDetailPath(path)` — aceita só exatamente essa rota, com só o
  parâmetro `id`, no formato acima; rejeita rota errada, query extra,
  fragmento, traversal e scheme smuggling na posição do id.

Implementado nos dois lados da fronteira de confiança de novo como
quase-duplicata deliberada (mesmo padrão de `isSafeNavigatePath`):
`lib/national-life/local-connector/capabilities.ts` (servidor) e
`apps/keeprone-connect/lib/capabilities.ts` (extensão), com 11 casos de teste
novos em cada lado — todos os 88 arquivos de teste do lado servidor (766
testes) e os 15 do lado extensão (154 testes) passam, `tsc --noEmit` limpo dos
dois lados.

**O que falta para a capability existir de verdade, e não foi feito aqui:**

1. `READ_POLICY_DETAIL` já está no protocolo mais amplo
   (`connector-command-contract.ts`) e no catálogo
   (`read-coverage.ts:POLICY_DETAIL`, `collector: 'ENTITY_DETAIL'`,
   `implementation: 'ON_DEMAND'`), com params `{ policyNumber }` — não
   `navigatePath` cru. Isso significa: a resolução `policyNumber → id hex`
   precisa acontecer em algum lugar antes de chamar
   `policyDetailNavigatePath`. O candidato óbvio é o próprio `AGENT_LINK` que
   `capturePageSnapshot` já captura do grid `INFORCE_CLIENTS`/`CLIENT_DETAIL`
   (`href` inclui `policy-details?id=`, `Label` é o texto do link) — mas isso
   ainda não foi verificado como fonte suficiente para todos os 10.924
   registros do book, nem desenhado como tabela de lookup.
2. Não existe parser para o conteúdo da página (`Total Face Amount` / IUL vs
   `Base Face Amount` / Term, `Accumulated Cash Value` na aba `VALUES`, etc. —
   ver §12). `capturePageSnapshot` capturaria o texto bruto, mas extrair os
   campos estruturados por produto ainda não foi escrito nem testado.
3. Não há rota de ingestão nem colunas de destino para os campos de capital
   segurado — decisão de schema que cabe ao dono do produto, não a esta
   sessão.
4. `EXECUTABLE_LOCAL_CONNECTOR_CAPABILITIES` continua `['READ_GRID',
   'READ_PAGE', 'READ_EXPORT']` — `READ_POLICY_DETAIL` não foi adicionado, de
   propósito: adicionar sem os três itens acima anunciaria uma capability
   executável que na verdade quebraria no primeiro run.

Ordem sugerida para retomar: (1) verificar se `AGENT_LINK` de
`INFORCE_CLIENTS`/`CLIENT_DETAIL` cobre o book inteiro como fonte do id; (2)
escrever o parser de `Coverage Details` + aba `VALUES` com TDD, cobrindo IUL e
Term; (3) só então ligar `READ_POLICY_DETAIL` em
`EXECUTABLE_LOCAL_CONNECTOR_CAPABILITIES` e no plano do run.
