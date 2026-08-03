# Sincronização de leitura do Foresight — desenho

Data: 2026-08-03  
Estado: aprovado para especificação; implementação ainda não iniciada

## Objetivo

Depois de o agente conectar a National Life, o Keepr One poderá usar a mesma
sessão autenticada para ler informações já existentes no Foresight, sem pedir
um segundo login e sem chamar Rapid Solve.

O primeiro resultado é um espelho auditável de leitura: casos que o Foresight
já conhece, dados estruturados que os serviços do caso devolverem e documentos
de ilustração solicitados para um caso existente. O carrier continua sendo a
fonte de autoridade; o Keepr apenas conserva uma observação com data e origem.

## Limite aprovado

### Incluído

- reutilizar o browser Steel vivo criado pelo login National Life;
- aquecer o portal antes de atravessar o SSO para o Foresight;
- abrir o painel Recent do Foresight e listar casos existentes;
- fazer o inventário de todos os casos que o painel Recent devolver naquela
  execução, sem abrir cada caso automaticamente;
- identificar, quando o carrier expuser, o nome, identificador, tipo de caso,
  produto, estado e datas do caso;
- ler, para um caso explicitamente selecionado pelo agente ou já vinculado por
  uma chave externa confiável, os serviços de dados já identificados no cliente
  do Foresight:
  - `WidgetService.asmx/GetQuickCalcData`;
  - `WidgetService.asmx/GetQuickCalcStatus`;
  - `WidgetService.asmx/GetInsuredInformation`;
  - `WidgetService.asmx/GetState`;
  - `PageService.asmx/GetPolicyInformation`;
- conservar os payloads de leitura validados, com redaction e escopo por agente;
- gerar e baixar, sob demanda, o relatório PDF de uma ilustração/caso já
  existente;
- mostrar progresso e resultado separado do sync das nove grades do portal;
- atualizar o contexto autenticado antes de qualquer desconexão do worker.

### Excluído

- Rapid Solve, inclusive qualquer POST de cotação;
- criação de novo caso no Foresight;
- criação ou envio de application/e-App;
- seleção, alteração ou gravação de produto Term, IUL, FlexLife ou outro;
- alteração de dados do segurado, caso ou apólice no carrier;
- criação automática de `Client`, `Policy`, `Application` ou `Illustration`
  por aproximação de nome;
- geração automática de PDF para todos os casos;
- decisão de underwriting, recomendação de produto ou cálculo próprio;
- automação de MFA, CAPTCHA ou qualquer desafio humano.

Term e IUL poderão aparecer como valores observados quando o Foresight os
devolver. A presença de um produto observado não autoriza a criação de um novo
caso ou application desse produto.

## Evidência atual e limites de conhecimento

O repositório já demonstrou que o Foresight é uma aplicação WebForms em frames,
acessada por `/agent/sso/foresight`, e que o caso selecionado mantém estado no
servidor. As chamadas carregam um `sessionTokenId` efêmero da página.

Também já foi identificado o fluxo de relatório:

1. selecionar um caso existente no painel Recent;
2. chamar `SetupReportDisplay`;
3. chamar `RenderReports`;
4. consultar `GetReportProgress`;
5. buscar `ReportDisplay.rspx` como PDF.

Esse fluxo gera um documento para um caso que já existe, mas não prova que o
Foresight possa criar um novo caso Term/IUL nem que ele seja o sistema que cria
applications. Esses pontos permanecem fora desta fase.

Os nomes dos cinco serviços acima são conhecidos. Os campos completos de cada
resposta serão descobertos em uma leitura controlada e persistidos somente
depois de validação de tipo, tamanho e redaction. O sistema não deve inventar
campos ausentes nem tratar o PDF como payload estruturado sem evidência.

## Arquitetura

O sync atual das nove grades continua intacto. O Foresight será uma operação de
leitura separada, com job próprio e progresso próprio, mas usará:

- a mesma conexão National Life do agente;
- o mesmo `liveSteelSessionId`;
- o mesmo lock exclusivo de browser;
- o mesmo mecanismo de refresh e persistência do contexto autenticado;
- o mesmo worker durável e a mesma política de ownership por agente e escopo.

A separação é intencional: o portal National Life costuma continuar vivo quando
a perna do Foresight expira. Uma falha no SSO do Foresight não pode apagar nem
reclassificar como falha os dados já sincronizados nas nove grades.

O worker nunca recebe URL ou script arbitrário do cliente. As rotas do portal,
SSO, frames e endpoints de serviço ficam em allowlists no servidor. Todas as
chamadas usam a sessão do browser para preservar cookies, tokens e headers que
o próprio cliente do Foresight exige.

## Fluxo de execução

1. O login confirma a conexão National Life.
2. O sistema enfileira no máximo uma leitura Foresight ativa para o agente e o
   escopo da conexão.
3. O worker aguarda o browser lock; nenhuma leitura Foresight roda em paralelo
   com keep-alive, sync de grade, outro job de carrier ou outra leitura.
4. O worker abre `/agent/` para aquecer a sessão do portal.
5. O worker atravessa `/agent/sso/foresight` uma única vez.
6. Se cair no Auth0 ou não encontrar a aplicação `StartPage.aspx`, a operação
   fica pausada como ação necessária; não há loop de tentativas.
7. O worker lê todos os casos que o painel Recent devolver e grava somente o
   inventário, sem abrir cada caso.
8. Se a execução tiver um caso-alvo escolhido pelo agente, ou um vínculo
   previamente confirmado por identificador externo, o worker seleciona esse
   caso e lê os cinco serviços em sequência, reobtendo o frame depois de cada
   navegação ou postback.
9. Cada resposta obtida é validada, redigida e persistida como snapshot.
10. Um pedido de PDF é uma operação separada, explicitamente selecionada para
    um caso existente. O worker acompanha o progresso do relatório e valida a
    assinatura `%PDF` antes de guardar o documento.
11. No `finally`, o worker recaptura cookies e storage autorizados e atualiza o
    contexto persistido.
12. Para uma sessão pertencente ao login humano, o worker apenas desconecta o
    transporte Playwright. Ele não chama `Browser.close` nem libera a sessão
    Steel.

As etapas são sequenciais porque o Foresight é stateful: abrir outro caso muda
qual caso o `sessionTokenId` representa. Paralelismo poderia misturar dados de
duas pessoas ou invalidar o token.

O inventário não usa o nome exibido como prova de identidade comercial. Se o
Foresight só devolver um rótulo sem chave externa estável, ele será guardado
como rótulo de staging e não poderá ser usado para associar automaticamente um
`Client`, `Policy`, `Application` ou `Illustration`.

## Dados persistidos

Será criada uma zona de aterrissagem própria do Foresight, sem escrever
diretamente nas entidades comerciais do Keepr.

### Snapshot do caso

Cada observação deverá conservar, quando disponível:

- `agentId` e `deploymentScope`;
- identificador externo estável, se existir;
- nome exibido pelo painel Recent;
- classificação observada, como quick quote ou caso completo;
- produto/estratégia exatamente como o carrier retornar;
- status e timestamps retornados pelo carrier;
- `observedAt`, status da leitura e erro seguro;
- payload bruto redigido para auditoria e investigação de contrato.

### Snapshot de dados

Cada serviço deverá ter uma observação própria ligada ao snapshot do caso:

- nome do serviço;
- versão/forma do payload, se disponível;
- campos normalizados somente quando o tipo estiver confirmado;
- payload original redigido;
- `observedAt` e resultado da validação.

O modelo não deve transformar automaticamente nome de segurado em `Client`, nem
um número de apólice em `Policy`. A ligação com entidades existentes será uma
fase posterior com chave externa e regra de confirmação.

### Documento

O PDF sob demanda deverá guardar:

- caso externo e identificador do relatório;
- filename seguro;
- MIME type e tamanho;
- hash do conteúdo;
- bytes ou referência ao armazenamento de documentos adotado pelo Keepr;
- timestamps de criação e download;
- estado do render e erro seguro.

O documento só será associado a uma `Illustration` existente quando a identidade
da ilustração estiver explícita. Caso contrário, fica como documento de
staging do Foresight, sem criar uma ilustração comercial silenciosamente.

## Estados e progresso

A operação Foresight terá estados independentes:

- `QUEUED`;
- `RUNNING`;
- `PAUSED_ACTION_REQUIRED`;
- `PARTIAL`;
- `COMPLETED`;
- `FAILED`.

O progresso será por unidades observáveis, não por percentual inventado:

- conexão/SSO;
- leitura da lista de casos;
- caso atual;
- serviço atual;
- relatório PDF, quando houver pedido explícito.

A interface deve mostrar, por exemplo, `Foresight: lendo 2 de 5 serviços`, sem
prometer duração. Auth0, códigos internos, cookies e IDs de sessão não aparecem
para o agente.

O status do sync das nove grades e o status do Foresight aparecem como linhas
separadas. O primeiro pode terminar como completo enquanto o segundo fica
pausado; o resultado geral explica essa diferença sem apagar o progresso já
persistido.

## Segurança e preservação do login

- Toda leitura é filtrada por `agentId` e `deploymentScope` no servidor.
- O cliente não escolhe `agentId`, sessão, caso ou endpoint como autoridade.
- Payloads passam por redaction antes de logs, erros ou respostas de status.
- Senhas, cookies, tokens e `sessionTokenId` nunca entram em banco de dados de
  negócio, analytics ou mensagens visíveis.
- O worker não atravessa o SSO repetidamente para testar se ainda funciona.
- A sessão humana não é fechada no fim do job.
- Um erro no Foresight não dispara automaticamente novo login nem uma sequência
  de tentativas contra a conta do proprietário.
- Cada PDF e snapshot recebe uma identidade idempotente para reprocessamento
  controlado sem duplicar documentos.

## Critérios de aceitação

- Uma conexão National Life pode iniciar a leitura Foresight sem outro login.
- A leitura não chama nenhum módulo ou endpoint Rapid Solve.
- O worker aquece o portal antes do SSO e atravessa o SSO no máximo uma vez por
  execução.
- A lista de casos é lida sem criar, editar ou excluir caso.
- Os cinco serviços de leitura são chamados somente em sequência, no caso
  selecionado, e cada payload é validado e redigido antes de persistir.
- O sistema distingue ausência de campo de campo com valor nulo e não inventa
  produto, application ou apólice.
- Um caso Term ou IUL existente pode ser identificado quando o Foresight expõe
  essa informação, sem que isso acione criação ou submissão.
- Um PDF solicitado para caso existente só é armazenado quando a resposta tem
  assinatura PDF válida.
- Auth0 pausa apenas a etapa Foresight e conserva as etapas de portal já
  concluídas.
- Reconectar depois de pausa retoma sem repetir snapshots concluídos
  desnecessariamente.
- A sessão Steel permanece viva após a leitura; o worker desconecta o cliente
  sem enviar `Browser.close`.
- Dois agentes não conseguem ler ou ver snapshots um do outro.
- Não existe criação automática de `Client`, `Policy`, `Application` ou nova
  `Illustration` neste escopo.

## Fases posteriores, fora deste desenho

Somente depois de a leitura estar estável e o contrato ser confirmado com uma
sessão controlada poderão ser desenhadas fases separadas para:

1. promoção assistida de um snapshot para cliente, caso, apólice ou ilustração;
2. criação de nova ilustração Term/IUL com confirmação humana;
3. preparação de application/e-App com revisão campo a campo;
4. envio ou submissão somente após protocolo de teste e aprovação explícita.

Essas fases exigem outro desenho porque mudam o sistema de leitura para um
agente que escreve em um sistema regulado.
