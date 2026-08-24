# National Life como engine de informação do Keepr One

Data: 2026-08-13
Estado: contrato consolidado a partir de sessão autenticada e código atual

## Decisão

O **Keepr One é o orquestrador** e o **KeeproneConnect é o canal autenticado**.

- Keepr One decide o que precisa ser atualizado, mantém checkpoints, normaliza,
  relaciona entidades, calcula prioridades, apresenta ações e guarda auditoria.
- KeeproneConnect executa uma capability fechada na sessão Chrome do próprio
  agente e devolve o resultado bruto com proveniência.
- National Life continua sendo a origem e a superfície final de qualquer ação
  comercial que altere a conta.

Para o sync de carteira, este contrato é obrigatório em todos os passos:

```text
Keeprone Sync
  -> KeeproneConnect solicita a fonte planejada
  -> navegador autenticado da National Life
  -> KeeproneConnect recebe lotes raw e envia recibos
  -> Keepr One valida, deduplica e elimina redundância
  -> banco Keepr One
  -> Keepr One App renderiza o snapshot verificado
```

O caminho remoto legado não pode criar a fonte exibida no app. Sessões, jobs ou
dados antigos desse caminho só podem ser tratados como compatibilidade/migração;
qualquer nova leitura de carteira precisa entrar pelo `LOCAL_CONNECTOR` e ter
`executionSource=LOCAL`.

A extensão não recebe URL, seletor ou JavaScript arbitrário do servidor. Cada
operação tem nome, parâmetros, limite, efeito e política de confirmação conhecidos
pela extensão publicada.

## O que foi comprovado no portal

### Exportações oficiais

O botão Download das grades usa o endpoint oficial
`POST /agent/Datatable/DownloadExcel`. A resposta é JSON com nome, tipo e bytes do
arquivo. Portanto, a melhor fonte para tabelas extensas é o export oficial, não
paginar visualmente milhares de linhas.

Fontes com export oficial já observadas:

- New Business
- Inforce Clients
- Client Intelligence
- Payable Gross Commissions
- Pending Gross Commissions
- Transfers and Exchanges
- Pending Lapse Policies
- Pending Increase Program
- histórico de transações e comissões dentro da apólice

Recently Closed Cases possui um fluxo de download próprio e deve ter adapter
separado. Correspondence usa recuperação de documentos individuais ou em lote.

O export Inforce com `Include Contact Information` contém, além da grade atual:

- apólice, produto, status, agência e agente;
- endereço de insured e owner;
- e-mail e telefone quando disponíveis;
- anticipated annual premium;
- datas de emissão e elegibilidade/conversão de term.

Face amount, cash value, loan values, beneficiaries e payment details aparecem na
página detalhada da apólice, e não nesse arquivo.

### Aplicações

A página de detalhe de aplicação entrega:

- tracker de estágio da aplicação;
- face amount e modal premium;
- underwriting decision e requirements por responsável;
- case communication e anexos;
- policy/coverage, riders, datas, state, agency e agent split;
- customer information e billing details.

Isso permite ao Keepr One transformar a lista de casos em uma fila operacional:
`o que está parado`, `quem precisa agir`, `qual requisito falta`, `há quanto tempo`
e `qual é o próximo botão seguro`.

### Apólices

A página de detalhe de apólice entrega:

- owner, insured, beneficiaries, status, produto e datas;
- total face amount e net death benefit;
- cash value, surrender, loans e interest;
- pagamentos e premium limits;
- transactions, commission history, correspondence e case archive;
- ações contextuais: upload form, customer view, run illustration, interest
  credited, submit claim e inventory letter.

### Illustrations / Foresight

O SSO autenticado abre Foresight na mesma origem e expõe:

- inventário de casos recentes;
- Case List, Folder List e Unsaved Cases List;
- Contact List;
- New Illustration;
- seleção de caso, leitura de serviços e geração de relatório/PDF.

A extensão precisa passar a instrumentar também `/NWI/*`. O inventário e a leitura
podem ser automáticos. Abrir um caso é navegação. Criar ou alterar uma ilustração
exige confirmação porque gera estado no carrier.

## Arquitetura do engine

```text
Keepr One
  plano incremental + fila de ações + checkpoints + auditoria
      |
      | capability fechada, idempotency key e expiração
      v
KeeproneConnect
  sessão autenticada + execução local + hash + upload resumível
      |
      v
National Life / Foresight
  export oficial -> detalhe -> documento -> ação confirmada
```

Ordem de aquisição:

1. export oficial para cobertura em massa;
2. grade/endpoints JSON para deltas rápidos;
3. detalhe apenas para entidades novas, alteradas ou que exigem ação;
4. documentos apenas quando novos ou solicitados;
5. Foresight por inventário, depois detalhe sob demanda;
6. escrita somente por comando confirmado.

Essa ordem evita reler 10 mil apólices para descobrir que poucas mudaram.

## Capabilities e risco

| Classe | Exemplos | Execução |
|---|---|---|
| `READ_ONLY` | `READ_EXPORT`, `READ_POLICY_DETAIL`, `FORESIGHT_INVENTORY` | automática e resumível |
| `NAVIGATION_ONLY` | `OPEN_APPLICATION`, `OPEN_POLICY`, `OPEN_ILLUSTRATION` | automática após clique contextual |
| `GENERATES_CARRIER_ARTIFACT` | `FLEXLIFE_QUOTE`, `GENERATE_ILLUSTRATION` | confirmação explícita |
| `WRITES_CARRIER_DRAFT` | `PREPARE_APPLICATION_DRAFT`, `UPLOAD_APPLICATION_DOCUMENT` | revisão do payload e confirmação |
| `SUBMITS_TO_CARRIER` | `SUBMIT_APPLICATION` | confirmação final, hash do payload e recibo |

MFA, CAPTCHA, consentimento, assinatura e submit nunca são contornados. O comando
entra em `AUTH_REQUIRED` ou `WAITING_FOR_CONFIRMATION`, preserva o checkpoint e
continua depois da intervenção humana.

## Inventário autenticado de action buttons

### Applications

- Lista: indicadores All/Pending/Chargeback/Pending Requirements/eDelivery/EFT/
  Unread Messages, Action Required Status, Download, Filters e Columns.
- Detalhe: Save for review, Send case message, Send requirement message, Attach,
  Pending/Completed requirements e abas Policy & Coverage, Customer Information e
  Billing Details.
- iGO e-App: abrir pelo SSO, preparar draft, anexar documentos e submeter. Abrir é
  navegação; draft/upload exigem revisão; submit exige confirmação final sobre o
  hash exato do payload e recibo do carrier.

### Policies

- Quick Tools: Upload a Form, Customer View, Run Illustration, Interest Credited,
  Submit a Claim e Inventory Letter.
- Transactions: Download e Show Additional History.
- Documents: Retrieve Selected e Merge All PDF.
- Commission History: Download.
- Case Archive: Download Attachments.

### Foresight

- Navegação: Home, Cases, Contacts, Activities, New Illustration, Case List,
  Folder List, Unsaved Cases List e Contact List.
- Caso: Select Contact, Remove Contact, Save, Save As, Copy To, Close, InsMark e
  Run Reports.
- Criação: Create a Product Illustration.

### Atalhos globais

- iGO e-App, Life Illustrations, Annuity Illustrations, RapidProtect Solve, Inforce
  Illustrations, Informal Request, Underwriting Quotes (XRAE), Upload Documents,
  Client Intelligence e Commission Payment Portal.

O catálogo executável está em `lib/national-life/portal-actions.ts`. A presença de
um botão no catálogo não o libera na extensão: cada executor ainda precisa ser
implementado, testado e publicado explicitamente.

## Download e ingestão segura

O arquivo não deve ser serializado inteiro como um array dentro do envelope de
linhas de 2 MiB. O fluxo correto é:

1. a extensão aciona o endpoint oficial na sessão atual;
2. valida nome permitido, MIME, assinatura do arquivo e tamanho máximo;
3. reconstrói os bytes e calcula SHA-256;
4. envia blocos binários/base64 numerados, abaixo do limite do endpoint;
5. o servidor confirma cada bloco e permite retomar do último recibo;
6. o servidor monta o arquivo, confere tamanho/hash, limita ZIP/XLSX e faz parsing;
7. persiste o original em storage privado e as linhas normalizadas com provenance;
8. conclui a fonte apenas quando recebido, validado e salvo batem.

Um recibo de fonte deve registrar: `sourceKey`, período, carrierUpdatedAt,
nome do arquivo, MIME, bytes, SHA-256, linhas recebidas, linhas aceitas, linhas
rejeitadas, schema version e horário.

## Modelo operacional no Keepr One

O usuário não deve navegar por espelhos do portal. O Keepr One deve entregar:

- **Hoje:** aplicações paradas, requirements, lapse/payment risk, documents e
  oportunidades de relacionamento;
- **Clientes:** visão consolidada de contato, apólices, valores, pagamentos,
  comissões, documentos e histórico;
- **Applications:** tracker, pendências, mensagens, documentos e próxima ação;
- **Illustrations:** inventário, status, produto, PDF e ação de continuar/criar;
- **Commissions:** paid, projected, gross, earning detail e reconciliação;
- **Documents:** correspondences e relatórios com data, origem e hash;
- **Sync:** uma execução, progresso por fonte, dados recebidos/salvos, retomada e
  erros acionáveis sem abrir tempestade de abas.

Cada botão contextual deve declarar antes do clique:

- o que será aberto ou alterado;
- em qual cliente/aplicação/apólice;
- quais dados serão usados;
- se exige login, MFA ou confirmação;
- qual recibo será salvo quando terminar.

## Estado atual e próxima entrega

Já existe no protocolo do servidor o catálogo amplo de commands e o ledger de
confirmação/auditoria. A extensão publicada executa hoje somente `READ_GRID` e
`READ_PAGE`.

Sequência de implementação:

1. publicar `READ_EXPORT` com upload resumível e ingestão do Inforce completo;
2. adicionar `READ_POLICY_DETAIL` e `READ_APPLICATION_STATUS` incrementais;
3. habilitar `/NWI/*`, `FORESIGHT_INVENTORY`, detalhe e PDF;
4. ligar `OPEN_*` aos botões contextuais do Keepr One;
5. liberar geração/drafts sob confirmação;
6. liberar upload/submit somente após auditoria ponta a ponta.

O Side Panel é adequado como UX complementar ao portal: mostra o contexto do
Keepr One sem roubar foco nem abrir abas repetidas. Ele exige a permissão
`sidePanel`; downloads controlados pelo Chrome exigem `downloads`. A captura do
export oficial também pode ser feita por `fetch` autenticado dentro da origem,
evitando salvar cópias desnecessárias no computador.

Referências oficiais do Chrome:

- https://developer.chrome.com/docs/extensions/reference/api/sidePanel
- https://developer.chrome.com/docs/extensions/reference/api/downloads
