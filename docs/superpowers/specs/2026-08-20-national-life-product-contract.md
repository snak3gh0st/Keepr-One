# National Life -> KeeprOne: contrato de produto antes da nova varredura

Data: 2026-08-20
Estado: contrato para revisão; nenhuma ação no portal autorizada por este documento

## Objetivo

Definir, a partir do que o KeeprOne realmente usa, quais informações e ações
precisam ser mapeadas na National Life antes de uma nova conexão autenticada.
A próxima sessão no portal deve responder perguntas fechadas e produzir prova
reconciliável. Ela não deve ser uma navegação exploratória sem destino.

## Regra de ordem

1. O KeeprOne define o dado necessário e o destino.
2. O catálogo define a fonte provável na National Life.
3. A varredura mede campos, filtros, contagens e identificadores.
4. O resultado é reconciliado de ponta a ponta.
5. Só depois são desenhados ou ativados coletores e ações.

Durante a primeira varredura, tudo é leitura. Não criar ou salvar ilustração,
não preparar rascunho de aplicação, não anexar documento, não enviar mensagem e
não submeter e-App.

## Estado atual confirmado no repositório

### Cobertura de leitura

`lib/national-life/read-coverage.ts` reconhece 30 fontes obrigatórias:

- 15 `AUTOMATIC`;
- 9 `NEEDS_PROBE`;
- 5 `ON_DEMAND`;
- 1 `NEEDS_COLLECTOR`.

Um run completo do conector não é sinônimo de cobertura completa do produto.
Cada fonte precisa de um estado próprio:

1. `NOT_VISITED` — não observada na sessão atual;
2. `SURFACE_OBSERVED` — página e controles vistos;
3. `CONTRACT_CAPTURED` — campos, filtros, identificadores e transporte medidos;
4. `COUNT_RECONCILED` — total do portal bate com o bruto recebido;
5. `NORMALIZED` — registros úteis foram interpretados sem perda silenciosa;
6. `CONSUMED` — o dado chega à superfície correta do KeeprOne;
7. `ACTION_VERIFIED` — somente para ações, com alvo, confirmação e recibo.

### O que já existe

- Páginas brutas por fonte em `NationalLifeRawGridPage`.
- Casos de new business em `NationalLifeCaseSnapshot`.
- Livro em vigor em `NationalLifeInforcePolicy`.
- Relatórios genéricos em `NationalLifeReportRow`.
- Recibos com recebido, escrito, duplicado e rejeitado.
- Ingestão de cliente e apólice ao término do run.
- Rapid Solve como cotação preliminar interna do agente.
- Modelos de staging do Foresight e catálogo de ações.
- Modelos locais de `Prospect`, `InsuranceCase`, `Illustration`, `Application`,
  `ApplicationRequirement`, `Policy`, transações, comissões e documentos.
- Ledger de comandos com risco, confirmação, idempotência e eventos.

### Lacunas que impedem confiar no produto hoje

1. `Policy.premium` continua obrigatório. Na ingestão, prêmio desconhecido vira
   `0`, repetindo a classe de erro já corrigida em `faceAmount`.
2. A ingestão da carteira pode falhar e retornar `null` sem um recibo de promoção
   visível. Um run lido não prova que `Client` e `Policy` foram atualizados.
3. Cliente e apólice são ingeridos, mas o vínculo de origem não cobre todos os
   papéis da pessoa. Owner, insured, annuitant, payor e beneficiary não podem ser
   colapsados em uma única identidade por nome.
4. `Application` só recebe observação da National Life quando já existe uma
   aplicação local autorizada. O portal não cria automaticamente o caso local.
5. O KeeproneConnect executa `READ_GRID`, `READ_PAGE` e `READ_EXPORT`. Não executa
   Foresight, `READ_POLICY_DETAIL` nem ações de Application.
6. O detalhe de apólice foi comprovado como fonte de capital segurado e valores,
   mas o parser, o lookup `policyNumber -> id` e o destino estruturado ainda não
   estão fechados.
7. Correspondence lista documentos, mas os PDFs ainda não chegam ao KeeprOne.
8. Comissões são consumidas de `NationalLifeReportRow`; o histórico medido era
   curto e muitas linhas não casam com uma apólice em vigor. O trabalho de abrir
   detalhes de comissão está presente no worktree, mas ainda não é base estável
   para declarar cobertura.
9. A tela de detalhe de apólice contém texto antigo dizendo que a National Life
   não fornece capital segurado, embora a página de detalhe tenha provado o
   contrário.
10. A Illustration atual é Rapid Solve. O PDF mostrado nesse fluxo não é o PDF
    oficial do Foresight, e a cotação é "agent use only" e não pode ser mostrada
    ao consumidor.
11. `Application.rawPayload` não substitui um contrato de dados para applicant,
    owner, beneficiary, payor, replacement, suitability, saúde, assinatura,
    pagamento e recibo de submissão.

## Contrato de informação necessário

### 1. Identidade, relacionamento e hierarquia

| Informação | Campos mínimos | Destino no KeeprOne | Fonte provável | Prova exigida |
| --- | --- | --- | --- | --- |
| Agente que escreveu | número, nome, agência, nível | Agent/hierarquia e comissão | new business, inforce, comissão | mesmo número em duas fontes |
| Agente que recebe | payee/global id, nome, companhia | comissão/promoção | payment portal + detalhe de comissão | total por payee reconciliado |
| Agente de serviço | nome, número, agência | responsável pela carteira | export inforce | amostra cruzada com policy detail |
| Pessoa | external/party id, nome, DOB, e-mail, telefone, endereço | Client/Prospect | inforce export, client detail, client intelligence | papéis e identidade sem fusão por nome |
| Papel da pessoa | insured, owner, annuitant, payor, beneficiary | nova relação tipada | client/policy/application detail | papel explícito, não inferido |

O modelo atual de `Client` não guarda endereço, identificador externo nem papel.
A varredura deve medir primeiro; a modelagem vem depois.

### 2. Carteira e apólice

| Grupo | Campos necessários |
| --- | --- |
| Identidade | PolicyNumber, NBPolicyNumber, detail id, company/system/product/plan codes |
| Produto | classe, nome, código, riders e opções quando disponíveis |
| Estado | status cru, status normalizado, issue/effective date, última mudança, delivery status, pending lapse |
| Prêmio | modal premium, annual premium, premium mode, billing frequency, paid-to date |
| Cobertura | face amount, base face amount, net death benefit, guideline premium limit e data, MEC limit e data |
| Valores | accumulated cash value, surrender penalty, net cash value, loan available, loan balance, interest rate |
| Estratégias | nome da subconta, valor, percentual/alocação e data da posição |
| Term | term conversion date, end of level period |
| Pagamentos | histórico, tipo, valor, data, status, método e saldo quando existir |
| Documentos | handle, tipo, categoria, data, policy reference, PDF, hash, tamanho e capacidade de extrair texto |

Destino: `Policy`, `PolicySnapshot`, `PolicyTransaction`, documentos e, onde o
modelo compartilhado não comportar a fidelidade do carrier, uma entidade nativa
National Life com vínculo opcional à apólice.

### 3. New Business, underwriting e Application

| Grupo | Campos necessários |
| --- | --- |
| Identidade | external application/case id, policy number, insured, owner, agent |
| Produto | product/company, face amount, modal/AAP, riders/opções |
| Pipeline | submitted/sent date, submit method, carrier status, delivery status, action required |
| Responsáveis | writing agent, agency, case manager, underwriter quando visível |
| Requirements | external id, título, descrição, status cru, status normalizado, due/received date, conversa e anexos |
| Comunicação | external id, título, mensagem, autor, data e vínculo com requirement/case |
| Documentos | tipo, nome, data, handle, PDF/hash e vínculo com a aplicação |
| Resultado | underwriting decision, approved/issued/declined/withdrawn, issue date e policy id |

Destino: `InsuranceCase`, `Application`, `ApplicationRequirement`,
`CaseTimelineEvent`, `Policy` e documentos. O casamento deve usar external ids;
nome e número de apólice são evidência auxiliar, não chave universal.

### 4. Comissão e resultado financeiro

Campos mínimos por lançamento:

- statement id e alcance do período;
- PaymentDate, ProcessDate, PremiumEffDate e PolicyIssueDate;
- PolicyNumber e NBPolicyNumber;
- payee id/nome e writing agent number/name/agency;
- writing level: personal ou override;
- compensation type: first year ou renewal;
- transaction type: standard, excess, chargeback ou adjustment;
- product, company e billing frequency;
- premium amount, commission rate, participation percentage e gross earned;
- saldos de chargeback e link para o detalhe da dívida;
- identificador estável para idempotência.

Antes de modelar série histórica, a varredura deve descobrir o maior intervalo
de datas disponível. Totais precisam fechar em três níveis: detalhe por
transação, statement/pay date e resumo do dashboard.

### 5. Client Intelligence e retenção

Campos: PartyId, PolicyNumber, data, categoria, motivo, descrição, follow-up,
agente, e-mail, telefone e commission impact.

Uso no produto:

- risco de lapse, EFT e surrender;
- oportunidade por aniversário e policy anniversary;
- fila de contato;
- histórico da apólice;
- validação de contato, sem sobrescrever dado local mais confiável.

Texto livre é PII. Deve permanecer no mesmo limite de acesso da carteira e não
entrar em logs ou documentos de auditoria.

### 6. Relatórios de controle

Agent Dashboard, Premium Report, Persistency, Placement, PIP, transfers,
annuity flows, daily unit values e informal requests são fontes de benchmark e
ação. Eles não devem criar entidades duplicadas quando repetem o mesmo dado de
uma fonte transacional.

Para cada relatório medir:

- período e filtros padrão;
- filtros máximos disponíveis;
- colunas adicionáveis;
- total exibido;
- granularidade da linha;
- export oficial;
- chave natural;
- sobreposição com outra fonte;
- ação concreta que o KeeprOne poderá recomendar.

## Contrato de Illustration

### Rapid Solve: manter como cotação preliminar interna

Entradas já conhecidas:

- estado de emissão;
- nome, DOB, gender e rate class;
- solve type;
- amount;
- death benefit option;
- strategy e allocation;
- product code.

Saídas já conhecidas:

- face amount;
- annual e monthly premium;
- lapse year.

Regra: nunca apresentar ao cliente como ilustração oficial. O registro deve
continuar `PRELIMINARY` e identificar claramente a origem Rapid Solve.

### Foresight: contrato necessário para ilustração oficial

Informações a mapear:

- case key, folder, versão, created/updated date e estado saved/unsaved;
- contact/insured e vínculo com Client/Prospect;
- product e jurisdiction;
- age/gender/rate class/tobacco;
- solve mode, face amount, premium mode e premium;
- death benefit option, riders, charges e assumptions;
- index strategies, allocations e illustrated rates;
- summary values, lapse projection e policy information;
- tipos de report, páginas/variantes selecionadas;
- PDF oficial, mime type, byte size, content hash e fetchedAt;
- EApp status associado ao caso.

Ações necessárias, com classe de risco:

| Ação | Risco | Regra |
| --- | --- | --- |
| Ler case/folder/contact lists e serviços | leitura | pode integrar sem confirmação |
| Abrir caso ou policy context | navegação | alvo local e carrier devem coincidir |
| Create Product Illustration | gera artefato | confirmação explícita |
| Select/Remove Contact | escreve rascunho | confirmação e alvo visível |
| Save/Save As/Copy To | escreve rascunho | idempotência e recibo |
| Run Reports | gera artefato | confirmação, opções à vista e hash do resultado |
| Baixar PDF já gerado | leitura | hash, tamanho e vínculo ao caso |
| Abrir e-App a partir do caso | navegação potencialmente preparatória | não executar na primeira varredura |

## Contrato de Application / iGO e-App

### Dados que o KeeprOne já tem

- nome, contato, DOB, estado e tabaco do prospect;
- objetivo, tipo de produto, cobertura alvo e orçamento;
- needs analysis;
- caso, timeline e checklist local;
- Illustration preliminar.

### Dados que a varredura precisa descobrir no iGO

Não assumir nomes de campo antes da observação. Catalogar por seção:

1. applicant, insured e owner;
2. beneficiary e contingent beneficiary;
3. payor, billing e initial premium;
4. produto, face amount, premium, riders e replacement/1035;
5. residência, cidadania, identidade e tax information;
6. suitability/financial profile;
7. medical, health, medications e physicians;
8. existing insurance e replacement notices;
9. agent licensing, split e agency;
10. documents, signatures, disclosures e consents;
11. validations por estado/produto;
12. review, submission, receipt e status posterior.

Dados de saúde e identidade sensível não devem ser copiados para logs, screenshots
ou docs. Antes de persistir, o produto precisa decidir retenção, criptografia,
acesso e exclusão.

### Ações necessárias

| Ação | Risco | Condição mínima |
| --- | --- | --- |
| Ler lista/status/requirements | leitura | external application id e contagens |
| Abrir aplicação/e-App | navegação | alvo confirmado |
| Preparar rascunho | escreve rascunho | revisão de payload, confirmação e idempotência |
| Anexar documento | escreve rascunho | hash, tipo, tamanho e destino visíveis |
| Enviar mensagem/requirement | submete ao carrier | confirmação no ato |
| Submeter aplicação | submissão vinculante | revisão final, payload hash, usuário, timestamp e recibo do carrier |
| Ler underwriting/status posterior | leitura | atualização monotônica e status cru preservado |

Recomendação de produto: primeira entrega para Application termina em rascunho
revisável. A submissão final é um projeto e um gate separados.

## Plano da próxima varredura autenticada

### Sessão e segurança

- Uma única aba autenticada, preservada do início ao fim.
- Nenhuma alteração de viewport durante a sessão.
- Nenhuma nova autenticação, logout ou abertura de outra sessão sem necessidade.
- Não tocar em create/save/run/submit/upload/message.
- Registrar somente nomes de campos, controles, totais e formas de transporte;
  nenhum valor pessoal entra nos documentos.
- Antes de cada navegação, registrar origem e destino esperados.

### Ordem de varredura

1. Home e navegação: inventário de áreas, totais de benchmark e rotas.
2. All Clients/export: colunas padrão/adicionáveis, filtros, contagem, ids de
   client/policy e campos de contato.
3. Policy Detail: amostra IUL, Term, Active, Pending Lapse e Lapsed; abas Policy,
   Values, Payments, Documents e ações disponíveis.
4. New Business: lista, colunas, filtros, detalhe, requirements, mensagens,
   underwriting e documentos.
5. Commissions: date ranges, overview, earning detail, policy history, pending,
   payable, payee map e chargeback detail.
6. Relatórios de persistência, premium, placement, PIP, transferências, annuity,
   daily values e informal requests.
7. Correspondence: índice, filtros, handle, retrieval e natureza do PDF; sem
   baixar em massa.
8. Foresight em leitura: listas, casos existentes, serviços e reports já
   existentes; sem criar/salvar/rodar report.
9. iGO em leitura estática: bundles, launcher, origens e formulário; sem preparar
   rascunho ou submeter.

### Amostra mínima de detalhe

- 2 IUL Active;
- 2 Term Active;
- 1 Pending Lapse;
- 1 Lapsed ou Not Active;
- 1 aplicação com Action Required;
- 1 aplicação recentemente fechada;
- 1 apólice com documentos;
- 1 comissão pessoal e 1 override;
- 1 comissão sem casamento com a carteira em vigor.

### Reconciliação obrigatória por fonte

Para cada fonte:

`portal total -> received raw -> written normalized -> distinct business keys -> promoted domain rows -> visible UI rows`

Toda diferença recebe uma causa: duplicata legítima, chave ausente, filtro,
rodapé, paginação, status excluído, join ausente ou falha. Diferença sem causa
mantém a fonte como não confiável.

## Critérios de saída

A varredura só está encerrada quando houver:

- matriz das 30 fontes com estado e evidência;
- catálogo de campos e filtros por fonte;
- mapa de sobreposição e precedência;
- contagens reconciliadas por fonte;
- amostras de detalhe cobrindo os casos mínimos;
- lista exata de campos ausentes no KeeprOne;
- contrato separado de Illustration e Application;
- nenhuma ação de escrita executada;
- backlog dividido em projetos testáveis.

Não usar a frase "vimos tudo" por quantidade de páginas ou estágios. A conclusão
é por contrato, contagem e consumo no produto.
