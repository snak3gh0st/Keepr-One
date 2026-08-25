# Runbook — operar o escopo prioritário do sync National Life

Data: 2026-08-25
Para: quem opera o piloto. Cada passo tem um resultado observável; se o
resultado não bater, **pare** — o passo seguinte não conserta o anterior.

O sync diário agora abre apenas o escopo prioritário escolhido para o Keepr One:
**13 áreas** quando a leitura de páginas está habilitada, ou **9 áreas
estruturadas** durante a compatibilidade com clientes antigos. O detalhe de
comissão é uma dependência de `Paid Commissions`, porque é de lá que vêm os
links para `CommissionStatementId` e `GrossCommEarned`.

O export oficial do carrier para o in-force continua sendo opcional e troca a
forma de leitura dessa área; ele não amplia o escopo do sync.

O que ele **não** fecha, e ninguém pode fechar por código: a execução contra o
portal vivo. É um humano por credencial.

---

## Passo 0 — a extensão instalada precisa ser ≥ 0.1.18

O export existe desde 0.1.15, mas o plano prioritário exige o detalhe de comissão
por statement, que entrou em 0.1.18. Como essa etapa faz parte tanto do plano de
13 quanto do de 9 fontes, o endpoint de criação do run recusa versões anteriores
com `426 CLIENT_TOO_OLD`; ele não cria um run que o cliente não consegue terminar.

```bash
pnpm --filter @fyntra/keeprone-connect build
```

Saída em `apps/keeprone-connect/.output/chrome-mv3/`. No Chrome do agente:
`chrome://extensions` → Developer mode → **Load unpacked** (ou **Reload**, se já
estava carregada) apontando para essa pasta.

**Verificar:** `chrome://extensions` mostra KeeproneConnect **0.1.18** ou superior.

## Passo 1 — ligar as flags necessárias

No ambiente do app (Coolify), acrescentar:

```
NATIONAL_LIFE_LOCAL_CONNECTOR_PAGE_DISCOVERY_ENABLED="true"
NATIONAL_LIFE_LOCAL_CONNECTOR_EXPORT_ENABLED="true"
NATIONAL_LIFE_LOCAL_CONNECTOR_MIN_VERSION="0.1.18"
```

As duas flags `...PAGE_DISCOVERY_ENABLED` e `...EXPORT_ENABLED` aceitam apenas
`true` ou `false` — qualquer outro valor derruba o boot com mensagem explícita,
de propósito. `...MIN_VERSION` recebe uma versão pontuada, como `0.1.18`.

`NATIONAL_LIFE_LOCAL_CONNECTOR_PAGE_DISCOVERY_ENABLED=true` habilita somente as
quatro fontes de página que
fazem parte do escopo prioritário (`AGENT_DASHBOARD`, `PENDING_GROSS_COMMISSIONS`,
`COMMISSIONS_OVERVIEW` e `COMMISSIONS_POLICY_HISTORY`). Não transforma o sync
diário em uma varredura das 26 áreas.

**Verificar:** após o redeploy, o app sobe. Se não subir, o valor da variável
está errado.

## Passo 2 — um agente piloto, não a frota

As páginas prioritárias ainda são snapshots de portal e podem exigir filtro ou
data antes de renderizar dados. Se isso ocorrer, a área pode capturar somente o
menu ou terminar `PARTIAL` / `SOURCE_PARTIAL_FAILURE`. Isso é uma medição
honesta; não converteremos snapshot em linhas operacionais sem parser seguro.

Rodar com **um** agente antes de expor a qualquer outro.

## Passo 3 — disparar

Clicar **Sync** na página de integração do National Life.

O plano prioritário entra automaticamente. Um run `COMPLETED` das últimas 24 h
só é reutilizado quando seu plano bate exatamente com o escopo solicitado; um
run histórico mais largo, como o de 26 áreas, não mascara o novo denominador e
é substituído por um run prioritário. O Sync comum preserva o plano de runs
`RUNNING`, `FAILED` ou `PARTIAL` para não quebrar o cursor durável. **Full
refresh** nunca cria outro run enquanto existe um `RUNNING`, mas substitui um
`FAILED` ou `PARTIAL` pelo plano prioritário atual.

**Verificar:** com a flag de páginas ligada, a barra mostra **13** etapas; sem
ela, mostra **9**. Nenhuma das duas contagens significa “todas as áreas do
portal”.

## Passo 4 — ler o resultado como evidência, não como sucesso/fracasso

O objetivo do run prioritário é salvar as fontes diárias e manter a evidência
separada entre linhas estruturadas e snapshots de página.

Consultas úteis depois do run:

```sql
\set agent_id '<agent-id-exato>'
\set run_id '<run-id-exato>'

-- linhas operacionais atuais do agente; "escritas" são upserts, então a
-- cardinalidade final é conferida diretamente aqui
SELECT "gridKey", COUNT(*) AS linhas
FROM "NationalLifeReportRow"
WHERE "agentId" = :'agent_id'
  AND "deploymentScope" = 'LOCAL_CONNECTOR'
GROUP BY 1 ORDER BY 2 DESC;

-- fontes que falharam no run exato, com o código
SELECT "gridKey", "safeErrorCode", "retryable"
FROM "NationalLifeConnectorStageFailure"
WHERE "runId" = :'run_id'
  AND "resolvedAt" IS NULL;

-- recebido x escrito x duplicado x rejeitado no run exato
SELECT "gridKey", SUM("recordCount") recebido, SUM("writtenCount") escrito,
       SUM("duplicateCount") duplicado, SUM("rejectedCount") rejeitado
FROM "NationalLifeConnectorStageReceipt"
WHERE "runId" = :'run_id'
GROUP BY 1;

-- snapshots de página preservados separadamente, nunca promovidos como linha
-- operacional sem parser específico
SELECT "gridKey", SUM("recordCount") registros_snapshot
FROM "NationalLifeRawGridPage"
WHERE "agentId" = :'agent_id'
  AND "deploymentScope" = 'LOCAL_CONNECTOR'
  AND "runId" = :'run_id'
GROUP BY 1;
```

Nas quatro fontes `READ_PAGE`, `recebido > 0` e `escrito = 0` é esperado: o
snapshot foi preservado em `NationalLifeRawGridPage`, mas não virou linha
operacional. Nas nove fontes estruturadas, a mesma combinação indica mapper sem
chave natural e precisa ser investigada.

## Passo 5 — o export do in-force trouxe contato?

```sql
SELECT COUNT(*) total,
       COUNT("ownerEmail") emails,
       COUNT("ownerPhoneNumber") telefones,
       COUNT("insuredAddressLine1") enderecos
FROM "NationalLifeInforcePolicy" WHERE "agentId" = '<agent>';
```

O código força `IsEnableContactFields: true` e já mapeia os cabeçalhos do XLSX.
Se os contadores vierem zerados, o campo não vem do carrier — e aí é conversa
com a upline, não código.

## Passo 6 — a pergunta de 5 minutos que decide a próxima entrega

Com a sessão ainda viva, abrir **uma** apólice no portal:

`/agent/book-of-business/inforce-book/all-clients/policy-details?id=<id>`

e procurar **face amount / death benefit / cash value**. Clicar as abas e
expandir as seções — a sonda de 2026-07-30 mediu 0% em 40 páginas lendo só o
estado default, e a varredura de 2026-08-13 diz que os números estão lá.

- **Achou** → escrever `READ_POLICY_DETAIL` é a próxima entrega, e anotar em qual
  aba/XHR o número aparece.
- **Não achou** → o caminho para capital segurado volta a ser documento + parse,
  e a sonda `national-life-describe-correspondence-filter.ts` sobe para o topo.

Registrar a resposta em `national-life-como-area-de-informacao.md` §9, que hoje
guarda a contradição em aberto.

---

## Se der errado

| Sintoma | Causa provável |
| --- | --- |
| Progresso mostra 12 ou 26, não 9/13 | Run `FAILED`/`PARTIAL` sendo retomado no plano antigo — use Full refresh. (Um run `COMPLETED` já não causa isso: é substituído automaticamente.) |
| Endpoint responde `426 CLIENT_TOO_OLD` | Extensão carregada é < 0.1.18 (passo 0) |
| Run termina `PARTIAL` | Uma ou mais páginas `NEEDS_PROBE` não renderam — é a medição, veja passo 4 |
| App não sobe após a flag | Valor diferente de `true`/`false` |
| `BRIDGE_UNAVAILABLE` em loop | Registro acima do limite de 16 KiB; ver `page-upload-parity.test.ts` |
