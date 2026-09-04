# Runbook — operar o escopo prioritário do sync National Life

Data: 2026-08-26
Para: quem opera o piloto. Cada passo tem um resultado observável; se o
resultado não bater, **pare** — o passo seguinte não conserta o anterior.

O sync diário agora abre apenas o escopo prioritário escolhido para o Keepr One:
**13 áreas** quando a leitura de páginas está habilitada, ou **9 áreas
estruturadas** durante a compatibilidade com clientes antigos. O detalhe de
comissão é uma dependência de `Paid Commissions`, porque é de lá que vêm os
links para `CommissionStatementId` e `GrossCommEarned`.

O export oficial do carrier para o in-force continua sendo opcional e troca a
forma de leitura dessa área; ele não amplia o escopo do sync.

Na extensão 0.1.20+, `Commission Earning Detail` pede até 1.000 linhas por
resposta do carrier e continua transportando lotes assinados de no máximo 200
linhas. Isso reduz viagens HTTP sem alterar `CommissionStatementId`,
`GrossCommEarned`, os limites do endpoint ou o cursor de retomada.

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

Para usar a captura sob demanda dos PDFs de Correspondence, a extensão precisa
ser **0.1.21+** e a migration
`20260826134000_national_life_correspondence_documents` precisa estar aplicada.
Versões anteriores continuam aptas ao sync prioritário, mas não entendem o
comando `FETCH_NATIONAL_LIFE_DOCUMENT`.

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

### Execução diária em segundo plano (extensão 0.1.20+)

Depois do primeiro pareamento, a extensão verifica a cada 15 minutos se a
última execução terminou há pelo menos 24 horas. Quando estiver vencida, ela
inicia o mesmo plano prioritário sem depender da página de Integrações e usa uma
aba inativa da National Life. Não cria um segundo run enquanto outro está ativo.

O Chrome precisa estar aberto e o computador acordado. Se a sessão da National
Life exigir login ou MFA, a aba é trazida para frente e o run aguarda o agente;
o Keepr One também cria um aviso no sino de notificações e o resolve quando a
sessão volta. No fluxo normal do conector local, o Keepr One não retém a senha
da National Life, nem a resposta de MFA; o agente completa ambas no portal
oficial. O `Remember this device`, quando o agente o escolher no portal,
continua pertencendo exclusivamente à National Life e ao perfil do Chrome.
Fechar a aba vinculada ao conector continua sendo um cancelamento explícito e
não é desfeito em silêncio.

Existe um credential broker opcional, separado e dependente de consentimento,
para a recuperação de uma sessão de carrier em uma operação já aprovada. Quando
ele é deliberadamente habilitado, o banco guarda somente ciphertext do Vault
Transit e metadados mascarados. O runtime web usa uma identidade apenas de
criptografia e não consegue descriptografar o material; o broker privado
separado tem a identidade de descriptografia. Nenhuma API revela ou copia a
credencial armazenada. Este runbook não afirma que esse recurso esteja ativo em
produção; siga `docs/operations/kbot-credential-broker-runbook.md` antes de
qualquer ativação.

### PDFs de Correspondence sob demanda (extensão 0.1.21+)

O sync diário salva o índice; ele não baixa arquivos em massa. Na apólice, o
botão **Trazer para o Keepr One** solicita um único PDF. O sucesso visual só
aparece depois de validar MIME, tamanho, `%PDF-`, SHA-256 e persistir o
`PolicyDocument`. Se a National Life pedir login/MFA, a extensão abre a aba
oficial e o agente repete o clique após entrar.

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

A tela **Carteira atual** usa a projeção da exportação completa reconciliada. O
**Histórico** é uma leitura local separada, inclusive para registros que não
aparecem mais nessa projeção; não apresente o histórico como prova da carteira
vigente.

Build e healthcheck verdes comprovam somente o artefato e a disponibilidade
técnica. Eles não comprovam um sync no carrier nem um resultado de cobrança;
para esses fluxos, mantenha a evidência do run e execute apenas o smoke
explicitamente autorizado.

### Publicação de carteira e produção administrativa

A partir da migration
`20260904190000_publish_verified_national_life_report_rows`, a carteira é
promovida exclusivamente das páginas raw verificadas do **mesmo** `agentId`,
`deviceId` e `runId` que acabou de terminar. Um run de outro dispositivo nunca
empresta linhas normalizadas do agente. Se a prova de páginas, sequências ou
contagem não estiver íntegra, a promoção falha fechada e não escreve carteira.

As linhas de relatório chegam primeiro em `NationalLifeRawGridPage`. Depois da
reconciliação, o servidor materializa somente o snapshot completo em
`NationalLifePublishedReportRow`; comissões, dados National, detalhes de apólice,
documentos e o painel administrativo leem essa projeção
separada, nunca a landing table `NationalLifeReportRow`. Cada linha publicada
guarda o `stageCompletionId`, o `runId` e o `deviceId` que a comprovaram. Uma
publicação por agente/escopo/grid é serializada por
`NationalLifeReportPublication`, portanto dois dispositivos não podem misturar
snapshots no mesmo conjunto de chaves. O horário da completion é imutável:
repetir uma conclusão antiga não substitui uma publicação mais recente. Novas
páginas são recusadas para uma etapa já concluída. A promoção de `Policy`
também compara esse horário antes de atualizar uma linha mais nova.
As páginas raw de outros runs não são
apagadas no término do stage: um GC futuro precisa ser consciente de run e de
consumidores para não remover a prova antes da promoção.

**Ordem obrigatória de rollout:** fazer backup, aplicar a migration, subir a
imagem que contém esta regra e só então disparar um sync novo. Não subir a nova
imagem antes da migration. O código anterior pode continuar gravando linhas
sem prova durante a janela de rollout, mas o novo leitor as recusa; drene as
réplicas anteriores antes de declarar o rollout concluído.

**Trade-off histórico deliberado:** linhas `LOCAL_CONNECTOR` que já existiam
não têm `runId`/completion de publicação suficiente para provar que vieram de
um snapshot completo. A migration não as apaga nem inventa prova, mas elas ficam
fora das telas de relatório até a primeira captura completa posterior. As
linhas no escopo legado `keepr-one-production-v1` continuam legíveis. Antes do
rollout, informe a operação que a produção local pode ficar temporariamente
vazia até o sync completo; isto é uma quarentena de confiança, não perda de
dados.

A captura nova recupera somente a janela que o portal fornecer. Histórico local
mais antigo que essa janela permanece armazenado, mas não deve voltar aos totais
sem uma prova de captura completa; a primeira sincronização não garante recuperar
todo esse histórico.

Documentos novos usam `publishedReportRowId` na transferência e
`publishedSourceRowId` no arquivo salvo. As referências antigas permanecem
válidas; arquivos já recuperados também são encontrados pela identidade externa
da correspondência. O histórico de correspondência não é podado durante sync.

Validação local reproduzível: provisionar PostgreSQL descartável em loopback,
com banco `keeprone_audit_test`, aplicar as migrações e executar
`NATIONAL_REPORT_TEST_DATABASE_URL=<url-local> pnpm vitest run tests/national-life/report-publication.postgres.test.ts`.
O teste usa registros sintéticos, verifica publicação concorrente, replay,
rejeição de nova página após conclusão e transferência de documento até os bytes
salvos. Nunca apontar essa variável para produção.

Depois do primeiro sync completo, verificar a proveniência, não só a contagem:

```sql
\set agent_id '<agent-id-exato>'

SELECT r."gridKey", COUNT(*) AS linhas_publicadas,
       MIN(c."completedAt") AS primeira_prova,
       MAX(c."completedAt") AS ultima_prova
FROM "NationalLifePublishedReportRow" r
JOIN "NationalLifeConnectorStageCompletion" c
  ON c."id" = r."stageCompletionId"
JOIN "NationalLifeSyncRun" run ON run."id" = c."runId"
WHERE r."agentId" = :'agent_id'
  AND r."deploymentScope" = 'LOCAL_CONNECTOR'
  AND c."truncated" = false
  AND run."executionSource" = 'LOCAL'
GROUP BY r."gridKey" ORDER BY 1;

SELECT "gridKey", "runId", "deviceId", "completedAt"
FROM "NationalLifeReportPublication"
WHERE "agentId" = :'agent_id'
  AND "deploymentScope" = 'LOCAL_CONNECTOR'
ORDER BY "gridKey";
```

Se a primeira captura falhar ou terminar parcial, não force um backfill na
tabela publicada: corrija a causa e execute outra captura completa. Uma rollback
de código não deve reabilitar leitura administrativa da landing table sem prova;
mantenha esta versão ou faça uma correção compatível antes de voltar.

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
