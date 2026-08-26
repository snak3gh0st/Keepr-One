# KeeproneConnect — smoke test com sessão real

O que 1621 testes automatizados provam: as peças fazem o que dizem, e os defeitos
encontrados estão fechados com teste que falha se alguém reverter. O que eles **não**
provam: que o portal da National Life devolve o que o código espera. Nenhum teste
tocou o carrier.

Este runbook fecha essa lacuna. A regra é uma só: **não confie na barra verde da
tela — olhe o banco.**

## Pré-requisitos

Em ordem, e a ordem importa.

1. **Merge e deploy.** O `migrate deploy` roda no boot do container antes do
   `server.js` ([Dockerfile:38](../../Dockerfile#L38)), então a migration
   `20260804180000_add_local_connector_planned_grids` é aplicada junto com o código
   que depende dela. O código **não roda** contra o banco sem ela: tanto
   `startLocalConnectorRun` quanto `ingestLocalConnectorStage` selecionam
   `plannedGridKeys`.

2. **Confirmar a flag em produção.** Sem entrar no servidor:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" -X POST \
     https://app.keeprone.com/api/agent/integrations/national-life/local-connector/pairings \
     -H 'content-type: application/json' -d '{}'
   ```

   `403` significa flag ligada e rota viva (rejeitou por falta de sessão).
   `404` significa `NATIONAL_LIFE_LOCAL_CONNECTOR_ENABLED` desligada.

3. **Rebuildar e recarregar a extensão.** Este passo não é opcional e não é
   cosmético. O servidor agora só aceita o envelope v2 cru; os schemas tipados
   foram removidos, não depreciados. A extensão carregada hoje manda v1 e vai
   receber 400 até ser reconstruída.

   ```bash
   cd apps/keeprone-connect && npx wxt build
   ```

   Depois: `chrome://extensions` → recarregar a extensão unpacked apontando para
   `apps/keeprone-connect/.output/chrome-mv3`.

   Confirme no manifest gerado que as permissões são exatamente
   `["storage","tabs","alarms"]` e os hosts permanecem restritos ao Keepr One
   configurado e à National Life. `alarms` sustenta o sync diário em background.

   Para o smoke de documentos, confirme também KeeproneConnect **0.1.21+** e a
   migration `20260826134000_national_life_correspondence_documents` aplicada.

## O teste

1. Abrir `https://app.keeprone.com/agent/integrations/national-life`.
2. Clicar em conectar. Se o device não estiver pareado, o card pareia sozinho antes
   de iniciar o sync.
3. Se o portal pedir login, o card mostra `login-required` e **para** — ele não
   força navegação para fora de uma tela de MFA. Faça o login no
   `nationallife.com` normalmente e volte.
4. Acompanhar a barra de progresso.

O caminho feliz visível: `NEW_BUSINESS` → navega sozinho para a grade de inforce →
`INFORCE_CLIENTS` → concluído.

### Smoke de um documento oficial

Depois do sync de `CORRESPONDENCE`, abra uma apólice que liste documento na
National Life e clique **Trazer para o Keepr One**. Se houver login/MFA, conclua
na aba oficial e clique novamente. O resultado só é válido quando:

1. o botão muda para **Abrir no Keepr One**;
2. o endpoint `/api/documents/<id>` abre um PDF;
3. o banco contém `PolicyDocument.provider = 'NATIONAL_LIFE'`, `sourceRowId`,
   `contentHash` e `fetchedAt`;
4. a transferência está `COMPLETED` e os chunks temporários foram apagados.

Não use o primeiro smoke para baixar todos os documentos da apólice.

## O que olhar no banco — esta é a parte que importa

Conectado ao `lifeos`:

```sql
-- 1. O run existe, é local, e o servidor registrou o que planejou
SELECT id, state, "executionSource", "deploymentScope",
       "plannedGridKeys", "totalStages", "completedStages",
       "currentGridKey", "safeErrorCode", "completedAt"
FROM "NationalLifeSyncRun"
WHERE "deploymentScope" = 'LOCAL_CONNECTOR'
ORDER BY "createdAt" DESC LIMIT 1;
```

Esperado: `state = 'COMPLETED'`, `plannedGridKeys = {NEW_BUSINESS,INFORCE_CLIENTS}`,
`safeErrorCode` nulo, `completedAt` preenchido.

```sql
-- 2. Os recibos: recebido x gravado, e truncamento
SELECT "gridKey", sequence, truncated, "recordCount", "writtenCount"
FROM "NationalLifeConnectorStageReceipt"
WHERE "runId" = '<runId acima>'
ORDER BY "gridKey", sequence;
```

**Este é o check central.** `writtenCount` muito menor que `recordCount` significa
que o normalizador está descartando linha — o sync "funcionou" e o dado não entrou.
`writtenCount = 0` com `recordCount > 0` é o sinal de que uma coluna do portal mudou
de nome. Sem essa coluna, esse cenário aparece como sucesso.

Pelo menos um recibo por grade precisa ter `truncated = false`, senão o run não
finaliza aquela grade.

```sql
-- 3. A linha crua do carrier chegou intacta?
SELECT "policyNo", "insuredName", jsonb_pretty(raw::jsonb)
FROM "NationalLifeCaseSnapshot"
WHERE "deploymentScope" = 'LOCAL_CONNECTOR'
ORDER BY "fetchedAt" DESC LIMIT 1;
```

**Este é o check que só passou a existir agora.** Antes, `raw` era `{}`. Agora deve
conter a linha original do portal, com todas as colunas — inclusive as que nenhum
normalizador lê. Compare com o que a grade mostra na tela: se uma coluna aparece no
portal e não está no `raw`, a captura está incompleta.

```sql
-- 4. Contagem por grade
SELECT 'case' AS tabela, "gridKey", count(*)
FROM "NationalLifeCaseSnapshot" WHERE "deploymentScope" = 'LOCAL_CONNECTOR'
GROUP BY "gridKey"
UNION ALL
SELECT 'inforce', 'INFORCE_CLIENTS', count(*)
FROM "NationalLifeInforcePolicy" WHERE "deploymentScope" = 'LOCAL_CONNECTOR';
```

Compare com o total que o portal exibe no rodapé de cada grade. Diferença pequena
pode ser deduplicação legítima por chave de upsert; diferença grande não é.

## Se falhar, o que cada sinal quer dizer

| Sintoma | Provável causa |
|---|---|
| `400` na criação do estágio | Extensão não foi reconstruída — ainda manda `schemaVersion: 1` |
| `401 DEVICE_REQUEST_REJECTED` | Device revogado, ou relógio fora de sincronia por mais de 5 min |
| `404 GRID_NOT_PLANNED` | O device reportou grade fora do plano do run — é a guarda funcionando |
| `404 RUN_NOT_FOUND` | Run expirou no TTL de 30 min, ou pertence a outro device |
| `TEMPLATE_UNAVAILABLE` | O portal não emitiu o `GetJsonResult` em 30s. Layout mudou, ou a página não é a grade esperada |
| Run fica `RUNNING` para sempre | Nenhum recibo com `truncated = false` para alguma grade planejada |
| Card verde, banco vazio | Olhe `writtenCount`. É o cenário que a coluna existe para tornar visível |

## Depois que passar

Registre no ledger da feature: quantas linhas por grade, e se o `raw` bateu com a
tela. É o baseline contra o qual a próxima mudança no portal vai ser medida.

Duas coisas continuam pendentes e não são resolvidas por este teste:

- **Os dois experimentos do Foresight** — `tsx scripts/national-life-describe-foresight-data.ts`
  e `tsx scripts/national-life-describe-foresight-newcase.ts`. Ambos só leem, e
  definem o escopo da Fase 2.
- **O producer agreement** do agente, que é o contrato que de fato governa acesso
  automatizado ao portal — não o ToS público do site.
