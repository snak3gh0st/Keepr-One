# Sincronização automática ampla da National Life

Data: 2026-08-03
Estado: proposta para revisão

## Objetivo

Depois que o agente conectar a National Life, o Keepr deve usar essa sessão
para atualizar automaticamente as informações de leitura pertinentes, sem
pedir outro clique. A interface deve mostrar progresso real enquanto isso
acontece.

O login continua sendo interativo e a sessão continua sendo reutilizada pelo
browser já conectado. O produto nunca pede nem armazena a senha da seguradora.

## Escopo da primeira versão

O primeiro sync automático executa, em ordem e como etapas independentes, as
nove grades `GetJsonResult` já validadas no portal:

1. `NEW_BUSINESS`
2. `RECENTLY_CLOSED`
3. `INFORCE_CLIENTS`
4. `PAID_COMMISSIONS`
5. `PROJECTED_COMMISSIONS`
6. `CLIENT_INTELLIGENCE`
7. `CORRESPONDENCE`
8. `COMMISSIONS_PAYMENT_PORTAL`
9. `PIP_PENDING`

Cada etapa persiste nos landing tables existentes
(`NationalLifeCaseSnapshot`, `NationalLifeInforcePolicy` e
`NationalLifeReportRow`) por meio de um serviço compartilhado. O script de
snapshot e o worker não terão implementações divergentes da paginação.

Ficam fora desta primeira versão:

- rotas SSO do Foresight e outras aplicações downstream;
- downloads de documentos e PDFs;
- rotas por apólice que não fazem parte das nove grades;
- operações de escrita, cotação ou geração de ilustração;
- criação automática de `Client`, `Policy` ou `Application` a partir de
  correspondência incerta.

Esses itens podem ser adicionados depois como etapas explicitamente validadas.
O sync amplo não deve reintroduzir a contradição já observada entre o código
de erro no topo e o `safeDetail`.

## Modelo de execução

Um login bem-sucedido cria no máximo um `NationalLifeSyncRun` ativo para o
agente e escopo da conexão. O run é pai de um job durável por grade. O job
existente continua sendo o mecanismo de lease/retry; o run acrescenta a
identidade da execução e torna o progresso consultável.

O run deve guardar, no mínimo:

- `agentId` e `deploymentScope`;
- estado geral: `QUEUED`, `RUNNING`, `PAUSED`, `COMPLETED`, `PARTIAL` ou
  `FAILED`;
- quantidade total, concluída e com erro;
- etapa atual e erro seguro para exibição;
- timestamps de criação, início e conclusão.

Cada job deve guardar a grade e o `syncRunId`. O worker só aceita uma grade da
allowlist, usa o mesmo lock de browser da National Life e atualiza o contexto
da sessão ao terminar. As etapas rodam sequencialmente para não concorrer com
o Chrome compartilhado nem aumentar a chance de invalidar a sessão.

O run é idempotente: conectar novamente enquanto existe um run ativo não cria
uma segunda leva. Depois de um run concluído, um novo login pode iniciar uma
nova execução. Jobs concluídos não voltam para a fila durante uma retomada.

## Sessão expirada durante o sync

Se uma etapa receber `FORESIGHT_SSO_EXPIRED` ou outro sinal já classificado
como sessão que exige login, ela vai para `ACTION_REQUIRED`, e o run fica
`PAUSED`. As etapas concluídas permanecem concluídas; a etapa bloqueada e as
seguintes continuam pendentes.

Quando o agente conectar de novo, a mesma transação que confirma a conexão
retoma os jobs parados do agente e o run volta a `QUEUED`. A barra continua de
onde parou. Erros de dados, rota ou persistência não devem ser mascarados como
pedido de login: a etapa registra falha e o run termina `PARTIAL` quando as
demais etapas puderem continuar.

## Contrato de progresso

O progresso é por etapas, não por número de linhas. Número de linhas oscila,
grades podem ser vazias e uma grade grande faria a barra parecer parada.

O endpoint de status devolve apenas dados do agente autenticado, incluindo:

- estado do run;
- `completed`, `total` e percentual inteiro derivado desses valores;
- nome amigável da etapa atual;
- contagens de concluídas, em andamento, pausadas e falhas;
- último erro seguro, quando houver.

Não há percentual inventado e não há promessa de tempo total.

## Experiência do usuário

Na página da integração National Life aparece uma barra completa enquanto o
run está ativo:

> Atualizando dados da seguradora

e uma linha de contexto como `3 de 9 áreas atualizadas`, junto do nome da
etapa atual. Ao concluir, a barra mostra `Dados atualizados` e a data da última
execução. Em estado parcial, informa que algumas áreas foram atualizadas e
oferece o erro seguro sem expor detalhes de sessão ou credenciais.

O selo compacto da barra superior passa a mostrar o progresso do run ativo,
por exemplo `Atualizando 3/9`. Quando não existe run ativo, preserva os
estados já definidos: `Em dia` ou `Precisa de você`. O selo só vira ação quando
há uma conexão necessária; a ação abre o fluxo de login existente.

O cliente consulta o status somente enquanto há um run ativo ou pausado. O
intervalo é encerrado ao concluir, falhar ou desmontar o componente. Não há
polling contínuo em telas ociosas.

## Segurança e isolamento

- Toda criação, leitura e transição filtra por `agentId` e `deploymentScope`.
- A API nunca aceita `agentId`, `gridKey` ou sessão fornecidos pelo cliente
  como autoridade.
- A allowlist de grades fica no servidor; o cliente apenas exibe o rótulo.
- Dados brutos ficam nas tabelas de staging já existentes, com a mesma política
  de retenção e upsert.
- Mensagens visíveis não contêm Auth0, códigos internos, cookies, IDs de
  sessão ou credenciais.
- O lock de browser continua exclusivo; keep-alive e sync não rodam juntos.

## Testes de aceitação

- Login cria um único run ativo e nove jobs, sem duplicação em reconexões.
- Cada job aceita somente uma grade da allowlist e persiste pelo serviço comum.
- O status reporta `0/9`, progresso intermediário, conclusão e parcial.
- Recarregar a página durante o sync mantém a mesma posição da barra.
- Expiração pausa na etapa correta; uma nova conexão retoma sem repetir etapas
  concluídas.
- Dois agentes nunca enxergam nem drenam os jobs um do outro.
- O selo mostra o mesmo progresso resumido da página e para de consultar quando
  o run termina.
- Nenhum caminho do sync amplo executa escrita no portal, SSO downstream,
  download de documento ou alteração automática de entidades ambíguas.

