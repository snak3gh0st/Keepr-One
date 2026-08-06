# National Life — decisão de arquitetura para 100 agentes

Data: 2026-08-05
Estado: decidido, pendente execução

Escrito após uma rodada de pesquisa cobrindo capacidade de infra, operação de
extensão em escala, frameworks agênticos, app desktop e custo de assinatura de
código. O objetivo é não redescobrir nada disto.

## A decisão

**A extensão continua.** Não por preferência — por ser a única arquitetura que
escala. O trabalho seguinte é operacional, não arquitetural.

---

## Os três gargalos

### 1. Execução — resolvido pela extensão

O caminho server-side é **impossível** a 100 agentes, e os números são do repo:

- `lib/national-life/browser-lock.ts:11` usa um advisory lock global do Postgres
  com chave fixa. **Um job de browser por vez no deployment inteiro** — não por
  agente. E é `try`: quem não pega, pula.
- Um job do Foresight tem ~59 s só de espera fixa (`adapter.ts`: 4 s, 15 s, 20 s,
  20 s, mais polling de até 20×3 s).
- A sessão do carrier morre em ~20 min.

100 agentes × ~90 s serializados = ~2,5 h por rodada. **A sessão do agente 15
morre enquanto ele espera na fila.** Impossibilidade aritmética, não custo.

### 2. Dado — teto que nenhuma arquitetura remove

Medido, não estimado:

- **`faceAmount` não tem fonte no portal.** `AAP` e `AccumulatedCashValue` chegam
  nulos em 3.647 IUL ativas e 3.624 Term ativas, sem exceção.
- **Prêmio cobre 22% do livro.**
- E-mail, telefone e endereço do segurado e do titular vêm nulos.

Único caminho restante para capital segurado: o PDF via
`EncryptedDocumentHandle`. Ali esbarra em 64 documentos para 9.614 apólices, com
suspeita de filtro de data e sonda **escrita e nunca rodada**
(`national-life-describe-correspondence-filter.ts`).

### 3. Destino — o modelo não aceita ingestão

- `applyCaseObservation` lança se não achar `Application` pré-existente.
- `InsuranceCase.prospectId` é obrigatório.
- `Policy` tem 2.168 linhas de seed sintético (`NLG-0001`).
- `ExternalReference` existe para isso e está vazia.

### 4. Crescimento sem varredor — resolvido para as três tabelas do conector

> **Estado:** varredores entregues (`lib/national-life/local-connector/janitor.ts`).
> O PDF no Postgres continua pendente — ver "Pendência: o PDF no Postgres" abaixo.

**Nenhum varredor existia.** `NationalLifeConnectorReplay` ganha uma linha por
requisição assinada; `expiresAt` era escrito e indexado e nada o lia.

Um sync completo do livro são ~53 requisições assinadas por agente. A 100 agentes
por dia: ~5.300 linhas/dia, **~1,9 M/ano**, para sempre. Idem recibos de estágio e
pairings consumidos.

**E o PDF do Foresight é gravado como `Bytes` dentro do Postgres**
(`schema.prisma:420`). Dezenas de GB/ano num banco que também serve a aplicação.

#### O que foi entregue

Uma varredura em lotes sobre as três tabelas, com o disparo junto — não há cron
neste projeto, e varredura sem disparo é como `expiresAt` chegou até aqui:

| Tabela | Corte | Por quê esse corte |
| --- | --- | --- |
| `NationalLifeConnectorReplay` | `expiresAt` + uma janela de assinatura (5 min) | A verificação de timestamp já rejeita sozinha qualquer assinatura vencida; a linha vira lastro no mesmo instante. A margem extra é folga se aquela checagem mudar. |
| `NationalLifeConnectorPairing` | vencido **ou** consumido há mais de 24h | O resgate exige `consumedAt: null` e `expiresAt` no futuro. As 24h são só para o suporte olhar um pareamento do mesmo dia. |
| `NationalLifeConnectorStageReceipt` | run em estado terminal e parado há mais de 30 dias | O recibo é a chave de idempotência do upload. O corte é a idade do **run**, não a do recibo: apagar recibo de run que ainda aceita upload transforma reenvio em escrita dupla. |

Disparo: intervalo dentro do próprio processo, ligado em `instrumentation.ts`
(padrão 900s, `NATIONAL_LIFE_JANITOR_INTERVAL_SECONDS`, desligável por
`NATIONAL_LIFE_JANITOR_DISABLED`). Mais `POST
/api/internal/national-life/connector-janitor` com `NATIONAL_LIFE_JANITOR_SECRET`,
que chama exatamente a mesma passada — se a rota funciona, o automático também.

Lotes de 1.000 com teto de 50 por passada: um `deleteMany` único sobre uma tabela
dimensionada para 1,9 M linhas/ano trava e incha. Atingido o teto, a passada
reporta `truncated: true` e a seguinte continua.

**O que a varredura não apaga:** `NationalLifeSyncRun` (é o que a tela lê, e some
por cascade junto com o agente) e recibos de run não-terminal — um run abandonado
em `RUNNING` guarda seus recibos para sempre. Cresce devagar; se virar problema, o
conserto é expirar o run, não afrouxar o recibo.

#### Pendência: o PDF no Postgres

Continua como `Bytes` em `NationalLifeForesightDocument`. Não foi movido nesta
rodada porque é troca de backend de storage mais migração de dado já gravado, e o
repositório não tem cliente de object storage. As duas saídas:

- **Disco com volume** — reusa o padrão que já existe em
  `app/api/documents/[id]/route.ts` (`UPLOADS_DIR`). Barato, mas o disco do
  container Coolify é efêmero: sem volume persistente montado, o PDF some no
  próximo deploy. O passo manual é a montagem do volume.
- **S3/R2** — não some em deploy nenhum, e é o caminho certo se o app um dia
  rodar em mais de um container. Custa `@aws-sdk/client-s3`, credenciais, bucket
  e região.

Recomendação: S3/R2, porque o motivo de tirar o PDF do banco é justamente durar, e
volume em host único troca um ponto único de falha por outro.

---

## O que foi descartado, e por quê

### Frameworks agênticos — Stagehand, Browser Use, Skyvern, AgentQL, computer-use

Três motivos, cada um suficiente:

1. **Resolvem o problema errado.** Tratam drift de *seletor*. Nós repetimos
   `fetch` capturado — nosso problema é drift de *contrato de API*.
2. **Não rodam onde rodamos.** São processos Node/Python falando CDP.
3. **Mudam nosso posicionamento.** Adotar agente de runtime move o Keepr One de
   "extensão carregando a sessão de um humano" para "agente de IA" — categoria que
   a Cloudflare bloqueia por padrão desde setembro de 2025.

Skyvern é o único que merece uma ligação: tem replay determinístico real e vende
automação de portal de seguradora. É **AGPL-3.0**, e a pergunta que decide é se o
Code Caching funciona a partir de template de API em vez de DOM. Se não, encerra.

### App desktop — plano B, não plano A

Retira o review da Store e o relógio de atualização do Chrome. **Não** estende a
sessão do carrier, não remove o MFA, não muda um-humano-por-credencial.

Se for, é **Electron, não Tauri**: o Tauri renderiza WebKit no macOS e Linux, e o
ITP do WKWebView bloqueia cookie de terceiro em redirect de SSO — exatamente a
classe de falha do decaimento do Auth0 do Foresight, ressurgindo em stack
diferente. Electron é Chromium em todo lugar, com `session.fromPartition`
persistente e o padrão preload + `contextBridge` documentado.

**Custo de assinatura, corrigido:** ~US$ 219/ano no total — Apple Developer US$ 99
mais Azure Artifact Signing Basic ~US$ 120. **Certificado EV não vale a pena**: a
Microsoft documentou em maio de 2026 que EV deixou de contornar o SmartScreen
("Paying a premium for EV solely to avoid SmartScreen warnings is no longer
justified"). OV e EV recebem o mesmo aviso.

**Prior art a copiar se for:** Ferdium (`<webview>` com partição `persist:` por
conta, preload injetando script, heartbeat mantendo sessão viva por horas) — mas
com isolamento por agente **obrigatório**, porque o default dele é sessão
compartilhada. E o fallback do Libation: abrir o navegador do sistema e colar a
URL de redirect de volta, para quando o WebView embutido quebrar.

**Validação independente:** o `browser-use`, 108 mil estrelas, tentou anexar ao
perfil real do Chrome, testou os contornos e desistiu — hoje entrega perfil
gerenciado próprio onde o usuário loga uma vez.

---

## Operação da extensão — onde o risco realmente está

### O relógio de atualização não é acelerável

Do código do Chromium: intervalo padrão de checagem **5 horas**
(`kDefaultUpdateFrequency`), e `requestUpdateCheck()` é limitado por backoff de
5 h que só reseta quando uma atualização real instala. É empurrão, não
acelerador.

Pior: o Chrome só **instala** quando o service worker está ocioso. Uma extensão
que fica acordando — a nossa — adia a própria atualização até o navegador
reiniciar. **Para planejar: dias, não horas.**

### ⚠️ O `reload()` pode desabilitar a extensão

```
kFastReloadCount = 5;      // packed
kFastReloadTime  = 10000;  // 10 s
```

Cinco `chrome.runtime.reload()` cada um dentro de 10 s do anterior → o Chrome
**termina e desabilita** a extensão. Em modo desempacotado o limite é 30 em 1 s —
**seis vezes mais frouxo**, então isso nunca reproduz em desenvolvimento.

Já aconteceu com o Bitwarden. Guardar com timestamp **persistido** (global morre
com o service worker) e nunca recarregar com trabalho em voo.

### Rollout gradual não está disponível

A Chrome Web Store exige **>10.000 usuários ativos em 7 dias** para rollout
percentual. Temos 100.

### Rollback é a única alavanca rápida — e cobra um preço

Não passa por review, fica no ar em um minuto. Mas entrega ao código da versão
anterior os dados escritos pela nova. E o `@wxt-dev/storage` **engole falha de
migração**: cai num `catch` que só faz `console.error`, e o `getValue()` devolve
o dado velho tipado como novo.

**Regra: toda release compatível com o storage da anterior. Só aditivo.**

### A alavanca de emergência é flag, não release

Latência da flag ≈ o heartbeat (15–60 min). Shipar código é dias a semanas.
**Desenhar para que o urgente seja sempre flag.**

Não existe solução pronta para isso — a busca por repos de version gating
encontrou arquivos de configuração de 65 bytes. São ~150 linhas nossas, custo
zero, sem dependência nova.

### Distribuição não tem alternativa

- CRX auto-hospedado: morto no Windows (Chrome 33) e macOS (Chrome 44).
- Política de empresa: exige máquina gerenciada; as máquinas são pessoais.
- Unlisted **não** reduz o rigor do review — mesma política, mesmo processo.

**A Store é o único caminho.** E nosso perfil — domínio financeiro, interceptação
de fetch no MAIN world, upload para terceiro — cai na trilha lenta.

### Telemetria: Sentry só no service worker

Funciona no SW desde a 8.26.0; é bloqueado em content script por design. **Nunca
`import * as Sentry`** — uma extensão foi rejeitada da Store porque o bundle
continha `browser.sentry-cdn.com` e `document.createElement("script")`; com
imports nomeados, aprovou.

`beforeSend` precisa ser **allowlist, não blacklist** — construir o evento a
partir de campos conhecidos, nunca apagar campos de um payload que vem de um
portal que não controlamos.

**Session replay está descartado:** gravaria o DOM do portal — dado de cliente, e
a aplicação de um terceiro. Cai no producer agreement, ainda pendente.

---

## O que fazer, em ordem

1. **Tolerância de versão** — header `X-Ext-Version`, servidor aceita N versões,
   `426` abaixo do piso, flag de kill no mesmo envelope. Com o guard de reload.
   Serve para extensão e para desktop.
2. **Canário de schema** — `ajv` validando toda resposta contra o schema da última
   versão boa. Zero LLM, zero dado saindo da máquina. É o único que ataca drift de
   contrato de API.
3. **UX de falha, em inglês** — erros distintos e acionáveis; os três becos
   (device revogado em loop, erro que some no reload, Store 404).
4. ~~**Varredores** — replay, recibos, pairings.~~ Feito. Falta tirar o PDF do
   Postgres — decisão de storage descrita acima.
5. **Chrome DevTools MCP** na máquina de dev — lê o painel de rede, que é onde a
   quebra mora. Manutenção, nunca runtime.
6. **Store, em paralelo, com data de decisão.**

## Duas correções baratas de alto retorno

- ~~**Rapid Solve**~~ — **feito** em `fb4e446`. O `HTTP 500` era a falta do header
  `__requestverificationtoken`. `requestRapidSolveQuote` agora carrega a própria
  página do Rapid Solve, lê `input[name="__RequestVerificationToken"]` e manda o
  header no POST — pelo contexto do browser da sessão, que é o que garante o
  cookie de antiforgery casando com o token. **Nunca exercitado contra o portal
  real**: só contra fixture. É item de smoke test.
- **Sonda de correspondência** — escrita, nunca rodada. Se o filtro de data for a
  causa dos 64 documentos, destrava o caminho do PDF, único caminho para capital
  segurado.

## Armadilha de compliance

A cotação do Rapid Solve carrega condição do carrier: *"for agent use only... may
not be shown to a consumer"*. Se alguma tela voltada ao cliente ler a tabela
`Illustration`, viola a condição da seguradora.

## Pendência externa

O **producer agreement** assinado pelo agente é o contrato que governa — não o ToS
público. Não obtido. Bloqueante para escalar, não para o piloto.
