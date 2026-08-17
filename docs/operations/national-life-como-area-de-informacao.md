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

**§3 — "`faceAmount` não tem fonte no portal. Nenhuma."** *Contestado, e a
contradição não se resolve sem uma sessão viva.* As duas evidências são reais e
se chocam de frente:

| Evidência | Data | Diz |
| --- | --- | --- |
| `scripts/national-life-sample-policy-details.ts`, 40 carregamentos, 3 amostras (`portal-contract.md:332-403`) | 2026-07-30 | `faceAmountHitRate` **0%** na página `policy-details?id=`. `describe-page` viu **uma única tabela** `Date, Category, Detail`. |
| Varredura em sessão autenticada (`orchestrator-contract-2026-08-13.md:88-98`) | 2026-08-13 | A página de detalhe da apólice entrega **total face amount, net death benefit, cash value, surrender, loans, beneficiaries, pagamentos**. |

A sonda de 07-30 **não** é fraca: usou browser real (Steel/Playwright,
`page.content()` após `domcontentloaded` + 3 s), corrigiu um falso negativo de
regex antes de concluir, e tinha controle `anyMoney` — que deu 87,5% numa amostra
e 16,7% em outra. Ou seja: havia cifras na página, só não rotuladas como face
amount.

A hipótese que concilia as duas — e é a única que sobrevive ao fato de ambas
usarem browser real — é que a sonda leu **a aba/estado default**, e os números
moram atrás de uma interação (aba `Policy & Coverage`, seção expansível, XHR
disparado por clique) que a sonda nunca fez. A variação do `anyMoney` entre
amostras reforça isso.

Custo de resolver: **abrir uma apólice no portal e olhar**. Minutos. Enquanto não
for feito, `READ_POLICY_DETAIL` é a aposta mais provável para capital segurado,
mas **não é um caminho confirmado** — e o PDF via `EncryptedDocumentHandle` não
pode ser descartado ainda.

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

## 11. Ordem revista

1. **Ligar as duas flags** (`PAGE_DISCOVERY_ENABLED`, `EXPORT_ENABLED`), com
   extensão ≥ 0.1.15 carregada, e disparar por **Full refresh** num agente
   piloto. Custo: uma variável de ambiente cada. Retorno: 12 → 26 fontes
   planejadas e 14 medidas pela primeira vez, mais contato de insured/owner via
   export oficial. Nada disso precisa de código novo — precisa de uma execução
   contra o portal vivo, que é o que não foi feito.
2. **Antes de escrever `READ_POLICY_DETAIL`, abrir uma apólice e olhar.** A
   contradição do §9 decide se essa capability vale o esforço ou se o caminho é
   documento + parse. Cinco minutos de sessão viva separam as duas. Se os números
   estiverem lá atrás de uma aba, `READ_POLICY_DETAIL` vira a entrega nº 2 (passo
   2 do contrato de 2026-08-13); se não estiverem, a sonda de correspondência
   volta ao topo.
3. **Fechar a ingestão** — inalterado do §7.3. Continua sendo o gargalo de
   produto, e nenhuma das duas anteriores o resolve.

A sonda de correspondência (§7.1) desce de prioridade: ela testava uma hipótese
sobre o único caminho *então conhecido* para capital segurado. Agora existe outro,
mais direto.
