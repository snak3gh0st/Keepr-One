# National Life — documentos, Foresight e iGO em 2026-08-26

Estado: implementação de documentos pronta na branch
`feat/national-life-documents`; Foresight/iGO somente observados em leitura.
Nenhum caso, relatório, rascunho ou application foi criado ou submetido.

## Correspondence: contrato confirmado e implementação

O índice `CORRESPONDENCE` continua no sync prioritário como dado estruturado. O
PDF não entra no sync diário: ele é buscado somente quando o agente pede em uma
apólice do Keepr One.

Contrato observado no portal autenticado:

1. `POST /agent/Document/GetDocumentViewerUrl` com um único
   `EncryptedDocumentHandle`, `isMergePdf: true`, `isClientTab: true` e
   `SubAgentNumber: ""`;
2. resposta contendo uma rota exata
   `/agent/correspondence/documentviewer?id=<32-hex>`;
3. `GET` dessa rota devolve `application/pdf`.

O KeeproneConnect 0.1.21 valida origem, path, query, MIME, assinatura `%PDF-`,
tamanho máximo de 25 MiB e SHA-256. O arquivo passa em chunks assinados de até
1 MiB e só vira `PolicyDocument` depois da remontagem e da segunda validação no
servidor. A autoridade do pedido inclui device, agente, source row de
`CORRESPONDENCE` e apólice local do mesmo agente.

UX na apólice:

- antes da captura: `Trazer para o Keepr One`;
- sessão expirada: a extensão abre o login oficial e orienta tentar novamente;
- depois da persistência confirmada: `Abrir no Keepr One`;
- retry de uma transferência interrompida retoma chunks íntegros; uma tentativa
  que falhou em hash é descartada antes do próximo clique.

Migration aditiva:
`20260826134000_national_life_correspondence_documents`. Ela torna
`PolicyDocument.uploadedById` opcional para artefatos do sistema, adiciona a
proveniência National Life e cria as tabelas resumíveis de transferência/chunk.

## Foresight oficial: o que a leitura estática comprovou

O SSO de Foresight abriu o app oficial no mesmo host da National Life. Os assets
carregados identificaram a release `5.3.65.31`.

O bundle comprova três fronteiras:

- `WidgetService.asmx/GetEAppStatus` é leitura do status do caso corrente;
- `PageService.asmx/SetupEAppLauncher` prepara o launcher usando somente o
  session token. O caso-alvo está implícito na sessão. A resposta devolve
  dinamicamente `Url`, `Caption` e `IsDirty`; o browser abre modal ou nova janela;
- `PageService.asmx/IllustrateCase` e
  `PageService.asmx/RenderReports` geram ou alteram artefatos do caso corrente.

Consequência: `IllustrateCase`, `RenderReports` e `SetupEAppLauncher` não são
leituras e não entram no background sync. Um executor futuro precisa confirmar
que o caso visível no Foresight é o mesmo caso local antes de qualquer chamada,
mostrar as opções ao agente e exigir confirmação explícita.

## iGO: estado observado

A navegação isolada para `/agent/sso/igo-eapp` chegou ao Auth0, mesmo com o
portal e o Foresight acessíveis na sessão atual. A observação parou ali: nenhum
login adicional foi feito e nenhum application foi aberto ou preparado.

`Remember this device` reduz desafios enquanto a National Life confiar no
dispositivo, mas não autoriza o Keepr One a tratar portal, Foresight e iPipeline
como uma sessão ilimitada. Cada perna SSO pode pedir autenticação novamente.

Como o destino do launcher vem apenas na resposta de `SetupEAppLauncher`, os
assets estáticos não provam ainda a origem final nem os campos do formulário
iGO. Chamar esse endpoint apenas para descobrir seria uma ação preparatória no
caso corrente e permanece bloqueado.

## Portões para as próximas entregas

1. Deploy controlado da migration, app e KeeproneConnect 0.1.21.
2. Smoke autenticado com um único documento: índice -> request -> chunks ->
   `PolicyDocument` -> abertura autorizada na apólice.
3. Foresight em leitura: inventário, detalhes, serviços e PDFs já existentes,
   sem `IllustrateCase`, `RenderReports`, save ou launcher.
4. Illustration oficial: criação/execução somente como comando separado, alvo
   reconfirmado e confirmação humana; nunca como sync diário.
5. iGO: autenticação assistida e varredura de nomes/controles sem PII. A primeira
   automação termina em rascunho revisável; submissão final continua fora do
  escopo até existir auditoria, idempotência e confirmação no ato.
