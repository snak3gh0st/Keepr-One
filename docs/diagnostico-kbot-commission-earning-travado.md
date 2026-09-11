# K-Bot travado em "commission earning detail" — diagnóstico

Run observado ao vivo em 2026-09-11 (produção, `app.keeprone.com`).

## Evidência coletada

Estado do servidor (`GET /api/agent/integrations/national-life/sync`):

```
runId cmtxfgmtw004rmr01zx2zysik  state RUNNING  completed 4/14
currentGridKey COMMISSIONS_EARNING_REPORT
startedAt 2026-09-11T20:47:31Z
receivedRecords 14522  writtenRecords 13139  duplicateRecords 1383  rejected 0
```

Estado da extensão (`GET_CONNECTOR_STATUS`), idêntico em leituras às 21:09:43 e 21:11:36:

```
status EXTRACTING           stageIndex 4 (COMMISSIONS_EARNING_REPORT, mode COMMISSION_DETAILS)
commissionDetailIndex 4     de 8 statements
commissionDetailCurrentOffset 0     ← nenhum chunk subiu deste statement
commissionDetailReceivedRecords 2402
uploads 41                  resumeSequence 27      errorCode undefined
carrierTabId 1522835119
```

Ou seja: mais de 20 minutos parado no statement 5 de 8, offset 0, sem erro.

A página do statement em si está saudável — aberta em aba separada, ela dispara
`POST /agent/Datatable/GetJsonResult` normalmente (8,4 s de latência) e os content
scripts MAIN/ISOLATED estão injetados (`window.fetch` e `XMLHttpRequest.send`
aparecem monkey-patched).

### Confirmação no banco de produção

Consultado depois, pelo próprio container do app (`docker exec … node`, o Postgres do
servidor keeprOne — não o `btdb` do túnel local, que é outro banco e por isso recusava a
credencial do `.env`):

```
RUN        state FAILED   completed 4/14   completedAt 21:19:31Z
           safeErrorCode "C_______________________________R____________________________"
RECEIPTS   COMMISSIONS_EARNING_REPORT: 27 recibos, sequences 0..26 contíguas,
           2402 linhas recebidas / 2401 gravadas, último às 20:54:32Z
COMPLETIONS INFORCE_CLIENTS, NEW_BUSINESS, PAID_COMMISSIONS, RECENTLY_CLOSED
FAILURES   nenhuma
```

Três coisas ficam provadas. **As sequences são contíguas** — não houve `STAGE_INCOMPLETE`
nem falha de estágio; foi silêncio puro, exatamente como o diagnóstico descreve. **O run
morreu por timeout do servidor** (30 minutos sem sinal), 25 minutos depois do último
recibo. E o `safeErrorCode` gravado é a mensagem crua do Chrome passada pelo filtro
`[A-Z0-9_]` da rota `/fail`: 61 caracteres, `C` na posição 0 e `R` na 32 — *"Could not
establish connection. Receiving end does not exist."* Ou seja: o par de content scripts
tinha sumido daquela aba, e essa mensagem virou o código de falha do run inteiro.

Os 14.522 da tela são o run todo (11076 + 879 + 8 + 157 + 2402), não esta etapa.

## Defeito 1 — `EXTRACTING` não tem prazo de vida

`beginExtraction` (`apps/keeprone-connect/entrypoints/background.ts:2775`) grava
`status: 'EXTRACTING'` e envia `BEGIN_GRID` via `sendBeginGridWithRetry`. O ACK vem da
ponte ISOLATED (`nlg-bridge.content.ts:193`), que responde **antes e
independentemente** de o mundo MAIN receber o `window.postMessage`. O ACK prova
entrega à ponte, não que a extração começou.

Todas as esperas *dentro* do extrator MAIN são limitadas — `waitForTemplate` tem 30 s
(`nlg-main.content.ts:173`) e cada página passa por `fetchWithinBudget`. Portanto, se o
laço tivesse rodado, teríamos um `GRID_ERROR` visível. Não houve nenhum. Logo o laço
nunca rodou para este statement, e nada no background tem prazo para perceber isso.

## Defeito 2 — o caminho de recuperação trava no probe de sessão

O watchdog (`SYNC_WATCHDOG_ALARM`, 1 min) chama `resumePending`
(`background.ts:3797`), que só reconcilia com o servidor quando o status é
`UPLOADING`; para `EXTRACTING` ele segue para `handleTabReady`. No caminho do detail,
antes de `beginExtraction`, vem `hasAuthenticatedPortalSession`
(`background.ts:559`): um `await chrome.tabs.sendMessage(...)` **sem prazo**, cuja
contraparte na ponte é um `fetch(NLG_ORIGIN + '/agent/')` **sem budget**
(`nlg-bridge.content.ts:68`).

Se essa conexão ficar pendurada na aba da seguradora, a promessa nunca liquida, a porta
pendente mantém o service worker vivo e cada tique do alarme entra no mesmo await. É
exatamente o que se observa: contadores idênticos, sem erro, indefinidamente — e é a
mesma classe de falha que o cabeçalho de `lib/fetch-budget.ts` documenta para o export
XLSX, deixada sem correção neste probe.

## Correções aplicadas (KeeproneConnect 0.1.85)

1. **Sonda de sessão com prazo dos dois lados.** `PROBE_AUTH` passa por
   `fetchWithinBudget` (20 s) na ponte e por `withDeadline` (25 s) em
   `hasAuthenticatedPortalSession`. Um portal mudo agora responde
   `AUTH_PROBE_FAILED` — nunca `authenticated: false`, que mandaria o agente para um
   login desnecessário. O background recarrega a aba (scripts novos) e repete a etapa;
   depois de duas tentativas, pula a fonte com `PORTAL_BRIDGE_UNRESPONSIVE` e segue
   lendo as demais, em vez de deixar o run parado.
2. **ACK do `BEGIN_GRID` só depois de a extração começar.** O mundo MAIN posta
   `EXTRACTION_STARTED` (inclusive no eco, que é o caso do reenvio do mesmo token) e a
   ponte segura a resposta até 3 s por ele. Um `postMessage` perdido entre os mundos
   virou falha retentável em vez de silêncio permanente.
3. **Sinal de vida durável.** `lastProgressAt` é carimbado **só onde o cursor anda**:
   lote aceito, statement virado, etapa trocada. Uma reentrada em `EXTRACTING` não
   conta — se contasse, a própria retentativa de um minuto adiaria para sempre a
   recuperação. No tique do watchdog, um `EXTRACTING`/`UPLOADING` parado há mais de 8
   minutos (folga para o export do in-force, que tem 3 minutos de orçamento) descarta a
   navegação em memória, reconcilia com o cursor durável do servidor e reabre a etapa —
   o run volta a andar sozinho, sem erro e sem reler o que já entrou. Um estado escrito
   pela versão anterior, sem carimbo, recebe um na primeira observação, para que um run
   já travado durante a atualização também seja recuperável. A reabertura é contada
   (`stallRecoveryAttempts`, zerada por movimento real): duas sem resultado e a fonte é
   pulada com `STAGE_STALLED`, porque uma recuperação que não recupera não pode virar
   reconciliação a cada oito minutos para sempre.

Cobertura: `lib/deadline.test.ts` (quatro casos), três em
`tests/nlg-bridge-content.test.ts`, nove em `tests/background.test.ts` — recarga,
desistência limitada, reconciliação da etapa muda, a garantia de não mexer numa etapa
saudável, as duas que prendem a semântica de progresso (três reentradas seguidas não
movem o carimbo; um lote aceito move) e as duas do limite de reabertura (a segunda conta,
a terceira pula; um lote novo perdoa a conta) — e o eco em `lib/grid-extraction.test.ts`.

4. **Par de content scripts ausente vira recarga, não fim de run.** `Could not establish
   connection. / Receiving end does not exist.` passou a contar como ponte que não
   responde: recarrega a aba (o que traz de volta os *dois* mundos — reinjetar só a ponte
   não restauraria o MAIN) e repete a etapa, em vez de encerrar o run com a mensagem crua
   do Chrome como código de auditoria. Foi o buraco que a evidência do banco revelou na
   primeira versão desta correção.

## O que ainda depende de release

A correção vive na extensão. O agente só a recebe depois de build e publicação na Chrome
Web Store; a 0.1.84 instalada continua com o comportamento antigo. Depois de duas
recargas sem resposta, a etapa é **pulada** (`PORTAL_BRIDGE_UNRESPONSIVE`, retentável):
o sync termina lendo todas as outras fontes e o commission earning detail volta no
próximo sync, em vez de o run inteiro ficar parado.

## Desbloqueio imediato do run em andamento

Fechar a aba da National Life **antes** de clicar em Sincronizar de novo. Clicar direto
passa pelo mesmo `hasAuthenticatedPortalSession` na mesma aba e pode travar igual; com a
aba fechada, o conector abre uma nova, com par de content scripts e probe novos, e
retoma pelo cursor que o servidor já guardou.
