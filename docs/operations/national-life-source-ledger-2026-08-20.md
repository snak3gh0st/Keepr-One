# National Life — matriz de fontes e evidências

Data: 2026-08-20

Esta matriz é o denominador da varredura. Uma fonte só avança quando há evidência observável; abrir a página não equivale a extrair, normalizar ou consumir o dado no KeeprOne.

## Estados permitidos

- `NOT_VISITED`: não inspecionada nesta sessão.
- `SURFACE_OBSERVED`: tela, filtros e contadores vistos.
- `CONTRACT_CAPTURED`: campos, identificadores, paginação e transporte registrados.
- `COUNT_RECONCILED`: total do portal reconciliado com a captura bruta.
- `NORMALIZED`: registros escritos e rejeições explicadas.
- `CONSUMED`: dado promovido e visível no domínio correto do KeeprOne.
- `ACTION_VERIFIED`: ação validada separadamente, com risco e confirmação.

## Fontes obrigatórias

| # | Chave | Fonte | Coletor atual | Implementação | Estado inicial | Destino principal |
|---:|---|---|---|---|---|---|
| 1 | `NEW_BUSINESS` | New business cases | Grid | Automatic | `NOT_VISITED` | Cases / Applications |
| 2 | `RECENTLY_CLOSED` | Recently closed cases | Grid | Automatic | `NOT_VISITED` | Cases / Applications |
| 3 | `INFORCE_CLIENTS` | In-force clients and policies | Grid/export | Automatic | `NOT_VISITED` | Clients / Policies |
| 4 | `PAID_COMMISSIONS` | Paid commissions | Grid | Automatic | `NOT_VISITED` | Commission transactions |
| 5 | `CLIENT_INTELLIGENCE` | Client intelligence | Grid | Automatic | `NOT_VISITED` | Risks / opportunities |
| 6 | `CORRESPONDENCE` | Correspondence index | Grid | Automatic | `NOT_VISITED` | Document index |
| 7 | `COMMISSIONS_PAYMENT_PORTAL` | Commission payees | Grid | Automatic | `NOT_VISITED` | Payees / statements |
| 8 | `PIP_PENDING` | Pending PIP increases | Grid | Automatic | `NOT_VISITED` | Policy alerts |
| 9 | `TRANSFERS_EXCHANGES` | Transfers and exchanges | Grid | Automatic | `NOT_VISITED` | Cases / requirements |
| 10 | `LIFE_PENDING_LAPSE` | Pending lapse policies | Grid | Automatic | `NOT_VISITED` | Retention queue |
| 11 | `COMMISSIONS_EARNING_REPORT` | Commission earning detail | Grid | Automatic | `NOT_VISITED` | Commission detail |
| 12 | `PAYABLE_GROSS_COMMISSIONS` | Payable gross commissions | Grid | Automatic | `NOT_VISITED` | Commission forecast |
| 13 | `AGENT_DASHBOARD` | Dashboard totals and action items | Dashboard | Automatic | `NOT_VISITED` | Control totals |
| 14 | `PREMIUM_REPORT_AGENCY` | Premium report | Filtered report | Automatic | `NOT_VISITED` | Premium validation |
| 15 | `COMMISSIONS_OVERVIEW` | Commission overview by pay date | Filtered report | Automatic | `NOT_VISITED` | Statements / control totals |
| 16 | `CORRESPONDENCE_DOCUMENTS` | Correspondence documents | Document | Needs collector | `NOT_VISITED` | Policy documents |
| 17 | `LIFE_PERSISTENCY` | Life persistency report | Filtered report | Needs probe | `NOT_VISITED` | Persistency KPIs |
| 18 | `PENDING_GROSS_COMMISSIONS` | Pending gross commissions | Filtered report | Needs probe | `NOT_VISITED` | Commission forecast |
| 19 | `PLACEMENT_REPORT` | Placement report | Filtered report | Needs probe | `NOT_VISITED` | Placement KPIs |
| 20 | `DAILY_UNIT_VALUES` | Daily unit values | Filtered report | Needs probe | `NOT_VISITED` | Policy values |
| 21 | `PIP_CONTRIBUTION_INCREASE` | PIP contribution increases | Filtered report | Needs probe | `NOT_VISITED` | Policy opportunities |
| 22 | `ANNUITY_PAST_DUE_CONTRIBUTIONS` | Annuity past-due contributions | Filtered report | Needs probe | `NOT_VISITED` | Retention queue |
| 23 | `ANNUITY_PAYROLL_FLOW_CHANGES` | Annuity payroll flow changes | Filtered report | Needs probe | `NOT_VISITED` | Policy servicing |
| 24 | `INFORMAL_REQUESTS` | Informal requests | Filtered report | Needs probe | `NOT_VISITED` | Cases / requirements |
| 25 | `TRANSFER_COMPANY_INFORMATION` | Transfer company information | Filtered report | Needs probe | `NOT_VISITED` | Transfers / cases |
| 26 | `POLICY_PAYMENT_HISTORY` | Policy payment history | Filtered report | On demand | `NOT_VISITED` | Policy transactions |
| 27 | `COMMISSIONS_POLICY_HISTORY` | Policy commission history | Filtered report | On demand | `NOT_VISITED` | Commission transactions |
| 28 | `CLIENT_DETAIL` | Client details | Entity detail | On demand | `NOT_VISITED` | Client roles / contacts |
| 29 | `POLICY_DETAIL` | Policy details | Entity detail | On demand | `NOT_VISITED` | Policy values / benefits |
| 30 | `NEW_BUSINESS_CASE_DETAIL` | Case details and requirements | Entity detail | On demand | `NOT_VISITED` | Application / requirements |

## Superfícies de ação, fora do total das 30 fontes

| Superfície | Objetivo | Regra desta varredura |
|---|---|---|
| Foresight | Illustration oficial | Observar listas, campos, serviços e artefatos existentes; não criar, salvar, copiar ou executar |
| iGO/e-App | Application | Observar launcher, campos, seções, estados e documentos; não criar rascunho, anexar ou enviar |

## Estado após a varredura autenticada de 2026-08-21

Resumo: 25 `CONTRACT_CAPTURED`, 4 `SURFACE_OBSERVED` e 1 `NOT_VISITED`.
Nenhuma fonte avançou para `COUNT_RECONCILED`, `NORMALIZED` ou `CONSUMED` sem
prova da cadeia portal → bruto → banco → produto.

| Chave | Estado | Observação |
|---|---|---|
| `NEW_BUSINESS` | `CONTRACT_CAPTURED` | lista, totais, colunas e filtros |
| `RECENTLY_CLOSED` | `SURFACE_OBSERVED` | lista e janela de 90 dias |
| `INFORCE_CLIENTS` | `CONTRACT_CAPTURED` | lista e diferença de escopo 394 vs. 10.896 |
| `PAID_COMMISSIONS` | `CONTRACT_CAPTURED` | resumo e drill-down por lançamento |
| `CLIENT_INTELLIGENCE` | `CONTRACT_CAPTURED` | lista, campos e janelas de 7 dias/2 meses |
| `CORRESPONDENCE` | `SURFACE_OBSERVED` | índice visto; documento não recuperado |
| `COMMISSIONS_PAYMENT_PORTAL` | `CONTRACT_CAPTURED` | payees e GlobalID |
| `PIP_PENDING` | `SURFACE_OBSERVED` | campos da lista observados |
| `TRANSFERS_EXCHANGES` | `CONTRACT_CAPTURED` | campos e estados observados |
| `LIFE_PENDING_LAPSE` | `CONTRACT_CAPTURED` | contrato observado; zero no filtro padrão |
| `COMMISSIONS_EARNING_REPORT` | `CONTRACT_CAPTURED` | pay date, statement e saldos |
| `PAYABLE_GROSS_COMMISSIONS` | `CONTRACT_CAPTURED` | resumo e detalhe por transação |
| `AGENT_DASHBOARD` | `CONTRACT_CAPTURED` | controles e totais por escopo |
| `PREMIUM_REPORT_AGENCY` | `CONTRACT_CAPTURED` | períodos, totais e decomposição |
| `COMMISSIONS_OVERVIEW` | `CONTRACT_CAPTURED` | payable/pending e calendário |
| `CORRESPONDENCE_DOCUMENTS` | `NOT_VISITED` | PDF/conteúdo não recuperado |
| `LIFE_PERSISTENCY` | `CONTRACT_CAPTURED` | 12/24 meses, premium e taxa |
| `PENDING_GROSS_COMMISSIONS` | `CONTRACT_CAPTURED` | contrato observado; zero no escopo padrão |
| `PLACEMENT_REPORT` | `CONTRACT_CAPTURED` | indisponível no próprio portal |
| `DAILY_UNIT_VALUES` | `SURFACE_OBSERVED` | exige produto para materializar linhas |
| `PIP_CONTRIBUTION_INCREASE` | `CONTRACT_CAPTURED` | formulário de ação, não relatório passivo |
| `ANNUITY_PAST_DUE_CONTRIBUTIONS` | `CONTRACT_CAPTURED` | contrato observado; zero no escopo padrão |
| `ANNUITY_PAYROLL_FLOW_CHANGES` | `CONTRACT_CAPTURED` | campos e janelas 7/14/21 dias |
| `INFORMAL_REQUESTS` | `CONTRACT_CAPTURED` | formulário de underwriting, não submetido |
| `TRANSFER_COMPANY_INFORMATION` | `CONTRACT_CAPTURED` | carriers, contatos, forms e notes |
| `POLICY_PAYMENT_HISTORY` | `CONTRACT_CAPTURED` | busca autorizada; 33 transações em dois anos |
| `COMMISSIONS_POLICY_HISTORY` | `CONTRACT_CAPTURED` | busca autorizada; sem lançamento na amostra/um ano |
| `CLIENT_DETAIL` | `CONTRACT_CAPTURED` | identidade, contato, policies e activities |
| `POLICY_DETAIL` | `CONTRACT_CAPTURED` | cobertura, valores, empréstimos, riders e billing |
| `NEW_BUSINESS_CASE_DETAIL` | `CONTRACT_CAPTURED` | underwriting, requirements, timeline e billing |

Foresight chegou a `CONTRACT_CAPTURED` por observação de caso existente, sem
Save, Run Reports ou Export. O iGO ficou `BLOCKED_AT_SILENT_SIGN_IN`: após
autorização, o gateway não emitiu POST para a iPipeline e nenhum draft foi
criado.
