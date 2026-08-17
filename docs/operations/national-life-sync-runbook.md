# Runbook — ligar a cobertura completa do sync National Life

Data: 2026-08-17
Para: quem opera o piloto. Cada passo tem um resultado observável; se o
resultado não bater, **pare** — o passo seguinte não conserta o anterior.

O que este runbook fecha: sair de **12 fontes** lidas para **26 planejadas**, e
trocar a leitura paginada do in-force pelo **export oficial do carrier** com
contato de insured/owner.

O que ele **não** fecha, e ninguém pode fechar por código: a execução contra o
portal vivo. É um humano por credencial.

---

## Passo 0 — a extensão instalada precisa ser ≥ 0.1.15

`EXPORT_PROTOCOL_VERSION = [0,1,15,0]` (`lib/national-life/local-connector/remote-config.ts:37`).
Abaixo disso o servidor **ignora a flag em silêncio** e continua planejando
leitura paginada — não dá erro, só não faz.

```bash
cd apps/keeprone-connect && npm run build
```

Saída em `apps/keeprone-connect/.output/chrome-mv3/`. No Chrome do agente:
`chrome://extensions` → Developer mode → **Load unpacked** (ou **Reload**, se já
estava carregada) apontando para essa pasta.

**Verificar:** `chrome://extensions` mostra KeeproneConnect **0.1.15**.

## Passo 1 — ligar as duas flags

No ambiente do app (Coolify), acrescentar:

```
NATIONAL_LIFE_LOCAL_CONNECTOR_PAGE_DISCOVERY_ENABLED="true"
NATIONAL_LIFE_LOCAL_CONNECTOR_EXPORT_ENABLED="true"
```

Ambas aceitam apenas `true` ou `false` — qualquer outro valor derruba o boot com
mensagem explícita, de propósito.

**Verificar:** após o redeploy, o app sobe. Se não subir, o valor da variável
está errado.

## Passo 2 — um agente piloto, não a frota

9 das 14 páginas novas são `NEEDS_PROBE`: nunca foram abertas por um coletor.
Uma página que exija submeter filtro ou data antes de renderizar linhas vai
falhar ou capturar só o menu, e o run termina `PARTIAL` /
`SOURCE_PARTIAL_FAILURE`. Isso é a medição funcionando — mas para um agente não
técnico, "PARTIAL" lê-se como quebrado.

Rodar com **um** agente antes de expor a qualquer outro.

## Passo 3 — disparar

Clicar **Sync** na página de integração do National Life.

O plano novo entra automaticamente: um run `COMPLETED` das últimas 24 h que não
cobria as fontes novas é substituído por um run novo
(`startLocalConnectorRun`, ramo `missesRequestedSources`). Um run `FAILED`
retoma no plano antigo primeiro e só adota o plano largo no ciclo seguinte —
se quiser o plano largo imediatamente nesse caso, use **Full refresh**.

**Verificar:** a barra de progresso mostra **26** etapas, não 12.

## Passo 4 — ler o resultado como evidência, não como sucesso/fracasso

O objetivo deste primeiro run **não** é ficar verde. É descobrir quais das 14
páginas rendem dado.

Consultas úteis depois do run:

```sql
-- o que cada fonte entregou
SELECT "gridKey", COUNT(*) AS linhas
FROM "NationalLifeReportRow"
WHERE "agentId" = '<agent>'
GROUP BY 1 ORDER BY 2 DESC;

-- fontes que falharam, com o código
SELECT "gridKey", "safeErrorCode", "retryable"
FROM "NationalLifeConnectorStageFailure"
WHERE "resolvedAt" IS NULL;

-- recebido x escrito x rejeitado por página
SELECT "gridKey", SUM("recordCount") recebido, SUM("writtenCount") escrito,
       SUM("rejectedCount") rejeitado
FROM "NationalLifeConnectorStageReceipt"
GROUP BY 1;
```

Uma fonte com `recebido > 0` e `escrito = 0` significa que o mapper não achou
chave natural — é trabalho de mapeamento, não falha de coleta.

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
| Progresso mostra 12, não 26 | Run `FAILED`/`PARTIAL` sendo retomado no plano antigo — use Full refresh. (Um run `COMPLETED` já não causa isso: é substituído automaticamente.) |
| Export não roda, sem erro | Extensão carregada é < 0.1.15 (passo 0) |
| Run termina `PARTIAL` | Uma ou mais páginas `NEEDS_PROBE` não renderam — é a medição, veja passo 4 |
| App não sobe após a flag | Valor diferente de `true`/`false` |
| `BRIDGE_UNAVAILABLE` em loop | Registro acima do limite de 16 KiB; ver `page-upload-parity.test.ts` |
