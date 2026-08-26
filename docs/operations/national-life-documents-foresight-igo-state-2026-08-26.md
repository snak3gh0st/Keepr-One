# National Life — documentos, Foresight e iGO em 2026-08-26

Estado: captura sob demanda de documentos validada em produção e publicada em
`main` pelo PR #73 (`eb3be78`); Foresight/iGO somente observados em leitura.
Nenhum caso, relatório, rascunho ou application foi criado ou submetido.

## Correspondence: contrato confirmado e implementação

O índice `CORRESPONDENCE` continua no sync prioritário como dado estruturado. O
PDF não entra no sync diário: ele é buscado somente quando o agente pede em uma
apólice do Keepr One.

Contrato observado no portal autenticado:

1. `POST /agent/Document/GetDocumentViewerUrl` com um único
   `EncryptedDocumentHandle`, `isMergePdf: false`, `isClientTab: true`,
   `SubAgentNumber: ""` e `X-Requested-With: XMLHttpRequest`;
2. resposta contendo uma rota exata
   `/agent/correspondence/documentviewer?id=<32-hex>`;
3. `GET` dessa rota devolve `application/pdf`.

O KeeproneConnect 0.1.25 delega a solicitação da URL ao `jQuery.ajax` já
carregado pela própria página do portal e valida origem, path, query, MIME,
assinatura `%PDF-`,
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

### Evidência de produção

Em 2026-08-26, um único `ANNUAL STATEMENTS` percorreu o fluxo real completo:

- botão `Trazer para o Keepr One` virou `Abrir no Keepr One`;
- transferência `COMPLETED`, sem `safeErrorCode`, com 244.325 bytes recebidos;
- `PolicyDocument` com provider, source row, data de captura e SHA-256;
- arquivo iniciado por `%PDF-`, com tamanho e hash idênticos no banco e no
  armazenamento;
- rota autenticada `/api/documents/<id>` aberta pelo agente.

`UPLOADS_DIR=/data/uploads` precisa permanecer montado no volume persistente
Coolify `z135kw39vj61ph46j8fg6w1c-uploads`. Armazenar esses PDFs apenas na camada
gravável do container perde os arquivos no próximo deploy.

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

### Correção por observação autenticada em 2026-08-26

A afirmação histórica de que a `StartPage.aspx` não oferecia criação estava
incompleta: ela considerou apenas o painel central. O menu lateral `Activities`
expõe `New Illustration`, cujo contrato atual é:

1. `SetupLaunchProduct()` chama
   `PageService.asmx/SetupLaunchProduct` com o session token corrente;
2. abre `/NWI/Main/ProductSelectionDialog.aspx`;
3. o diálogo permite escolher estado, tipo e conceito e lista `FlexLife` como
   `2025 Indexed Universal Life`;
4. selecionar FlexLife abre `/NWI/ProductWorkflow/ModuleLandingPage.aspx` e o
   workflow `/NWI/IUL2025/*`.

O formulário atual foi inspecionado sem salvar nem executar relatório. Ele
separa os dados em `client.aspx`, `ledger.aspx`, `product.aspx`,
`InterestRates.aspx`, `quickview.aspx` e `reportselection.aspx`. Os campos de
cliente, risco, capital, opção de benefício, prêmio e riders têm IDs estáveis
sob `ctl00_mobilityPH_*`. A release carregada permaneceu
`ForeSight.Release-5.3.65.31.js`.

O formulário abre com valores de demonstração/default. Portanto o executor não
pode considerar o estado inicial como entrada confirmada: ele precisa escrever
o snapshot aprovado, reler todos os campos materiais e comparar o fingerprint
antes de `Save`. A página de Reports não ficou operacional antes de um Save;
isso vira uma precondição explícita, não uma tentativa a repetir.

## iGO: estado observado

A navegação isolada para `/agent/sso/igo-eapp` chegou ao Auth0, mesmo com o
portal e o Foresight acessíveis na sessão atual. A observação parou ali: nenhum
login adicional foi feito e nenhum application foi aberto ou preparado.

`Remember this device` reduz desafios enquanto a National Life confiar no
dispositivo, mas não autoriza o Keepr One a tratar portal, Foresight e iPipeline
como uma sessão ilimitada. Cada perna SSO pode pedir autenticação novamente.

Em uma segunda observação no Chrome normal, o tile `iGo eApp` chegou com sucesso
à origem exata `https://igoforms2.ipipeline.com` e abriu o iPipeline Velocity.
A landing oferece `Start New Case` e `View My Cases`. A primeira tela do wizard
contém Proposed Insured, Case Description, Solicitation State, Product Type e
Product; nenhum campo foi preenchido e nenhum Save/Next foi acionado. Isso
confirma que `Start New Case` pertence ao fluxo application/iGO, enquanto `New
Illustration` pertence ao Foresight. Identificadores temporários de sessão não
foram persistidos nem entram na allowlist.

Como o destino do launcher vem apenas na resposta de `SetupEAppLauncher`, os
assets estáticos não provam ainda a origem final nem os campos do formulário
iGO. Chamar esse endpoint apenas para descobrir seria uma ação preparatória no
caso corrente e permanece bloqueado.

## Estado dos portões

1. Concluído: migration, app e KeeproneConnect 0.1.25 no piloto unpacked.
2. Concluído: smoke autenticado com um único documento: índice -> request ->
   chunks -> `PolicyDocument` -> abertura autorizada na apólice.
3. Foresight em leitura: inventário, detalhes, serviços e PDFs já existentes,
   sem `IllustrateCase`, `RenderReports`, save ou launcher.
4. Illustration oficial: criação/execução somente como comando separado, alvo
   reconfirmado e confirmação humana; nunca como sync diário.
5. iGO: autenticação assistida e varredura de nomes/controles sem PII. A primeira
   automação termina em rascunho revisável; submissão final continua fora do
  escopo até existir auditoria, idempotência e confirmação no ato.
