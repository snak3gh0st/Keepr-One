# National Life — documentos, Foresight e iGO em 2026-08-26

Estado: captura sob demanda de documentos validada em produção e publicada em
`main` pelo PR #73 (`eb3be78`). A branch isolada
`feat/national-life-illustration-igo` implementa a geração local de Illustration
e o probe somente-leitura do iGO; ainda não foi publicada nem validada ponta a
ponta no Keepr One. Um único caso sintético autorizado foi salvo manualmente no
Foresight e gerou o relatório NAIC. Nenhum rascunho/application iGO foi criado,
salvo ou submetido.

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
leituras e não entram no sync diário. O executor de Illustration da branch
confirma o caso e o snapshot aprovado antes de gerar/salvar o artefato e exige
confirmação explícita. `SetupEAppLauncher` permanece desabilitado até o fluxo
iGO ser validado separadamente.

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

### Smoke sintético autorizado

No mesmo dia, o caso sintético `KEEPRONE-TEST-20260826-SMOKE` foi criado e salvo
no Foresight com FlexLife, Florida, capital de US$ 100.000 e prêmio mensal de
US$ 250. O relatório oficial NAIC abriu como PDF e mostrou prêmio anual de
US$ 3.000, coerente com 12 parcelas. Esse teste comprova o comportamento do
portal e do relatório; não comprova ainda o transporte assinado do PDF, a
persistência no banco ou a renderização pelo fluxo completo do Keepr One.

## iGO: estado observado

A primeira navegação isolada para `/agent/sso/igo-eapp` chegou ao Auth0, mesmo
com o portal e o Foresight acessíveis. Depois da renovação manual do login, a
mesma rota atravessou `federate.ipipeline.com/sp/ACS.saml2` e chegou a
`igoforms2.ipipeline.com/CossEnterpriseSuite/SilentSignIn.aspx`. Nesse ponto o
Chrome controlado bloqueou a página com `ERR_BLOCKED_BY_CLIENT`, antes da
landing. Nenhum application foi aberto ou preparado.

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

O KeeproneConnect 0.1.27 da branch permite somente o comando `OPEN_EAPP`: abre a
rota oficial, classifica Auth0/MFA/gateway/origem inesperada e, se chegar a
`igoforms2`, devolve apenas `IGO_HOME`, `IGO_CASE_LIST`, `IGO_FORM` ou
`IGO_UNKNOWN`. Ele não lê valores, não clica, não abre `Start New Case` e não
salva. Os hosts iPipeline são allowlists exatas; não existe wildcard.

Como a tentativa atual confirmou federação e destino, mas parou em
`GATEWAY_BLOCKED_BY_CLIENT`, a landing e o contrato dos campos não foram
revalidados nessa sessão. Por isso
`PREPARE_APPLICATION_DRAFT` e `SUBMIT_APPLICATION` continuam localmente
desabilitados. `SetupEAppLauncher` também não é chamado pelo probe.

## Estado dos portões

1. Concluído em produção: migration, app e KeeproneConnect 0.1.25 no piloto
   unpacked para documentos.
2. Concluído: smoke autenticado com um único documento: índice -> request ->
   chunks -> `PolicyDocument` -> abertura autorizada na apólice.
3. Concluído na branch: executor Foresight com snapshot selado, releitura dos
   campos materiais, geração do NAIC PDF, hash e upload assinado.
4. Pendente: smoke ponta a ponta com a extensão 0.1.27 carregada, artefato único
   persistido e aberto pelo Keepr One; depois, deploy controlado e PR.
5. iGO probe: código e testes somente-leitura prontos; autenticação renovada e
   cadeia real confirmada até `igoforms2`, onde o Chrome controlado devolveu
   `GATEWAY_BLOCKED_BY_CLIENT`.
6. iGO draft: bloqueado por decisão de segurança até alcançar a landing num
   browser sem esse bloqueio e mapear/read-back os campos reais. Submit continua
   fora do primeiro release.
