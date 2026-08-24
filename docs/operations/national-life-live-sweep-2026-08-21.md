# National Life — varredura autenticada somente leitura

Data: 2026-08-21  
Escopo: portal do agente, Foresight Life e gateway iGO.  
Regra: nenhum registro foi criado, salvo, enviado, excluído ou movido.

## Resultado executivo

A varredura confirmou que o portal contém dados suficientes para corrigir os
principais gaps do KeeprOne, mas também confirmou que os totais atuais não
podem ser usados sem denominador, janela e escopo explícitos.

- Dashboard: 720 casos de New Business e 394 itens in-force no escopo resumido.
- Grade All Clients: 10.896 entradas no escopo carregado.
- Client Intelligence: 503 eventos nos últimos 7 dias no dashboard e 2.829
  eventos na janela de 2 meses da página detalhada.
- Premium Report: US$ 50.772,41 YTD e 23,20 novas apólices, com decomposição
  life/annuity, target/excess/annualized/PIP/single.
- Life Persistency: US$ 153.037,86 issued premium, US$ 133.353,28 in-force
  premium e 87% em 24 meses.
- Comissão payable: US$ 15.906 no dashboard; o drill-down observado contém
  1.605 transações para um dos agrupamentos/payees.

Esses números são evidência do portal na data acima. Ainda não foram
reconciliados com captura bruta, banco e UI do KeeprOne.

Das 30 fontes obrigatórias do catálogo, 25 chegaram a `CONTRACT_CAPTURED`, 4
ficaram em `SURFACE_OBSERVED` e 1 permaneceu `NOT_VISITED` (o conteúdo/PDF de
Correspondence). Nenhuma fonte chegou a `COUNT_RECONCILED`, `NORMALIZED` ou
`CONSUMED` nesta sessão; por isso os números continuam sendo referência do
carrier, não números validados do KeeprOne.

## Contratos confirmados

| Fonte/superfície | Estado | Contrato observado |
|---|---|---|
| Agent Dashboard | `CONTRACT_CAPTURED` | contagens New Business/in-force/transfers, AAP, modal premium, Client Intelligence, comissão e calendário |
| New Business | `CONTRACT_CAPTURED` | 720 total; pending, chargeback risk, requirements, eDelivery, EFT e unread messages; 20 colunas disponíveis |
| New Business detail | `CONTRACT_CAPTURED` | owner/insured, face amount, CTP, APP, modal premium, stages, underwriting, requirements, communications, riders, MEC/7-pay, replacement, agent split e billing |
| All Clients | `CONTRACT_CAPTURED` | owner, insured/annuitant, policy, type, status, agent e issue date; 10.896 entradas no escopo carregado |
| Client detail | `CONTRACT_CAPTURED` | DOB/age, relationship tenure, paperless, contact/address, policies e activities |
| Policy detail | `CONTRACT_CAPTURED` | owner/insured/beneficiary, face amount, net death benefit, MEC/guideline limits, riders, values, loans, strategies e payment details |
| Policy transactions | `CONTRACT_CAPTURED` | posting/effective dates, type, source e destination |
| Policy commission history | `CONTRACT_CAPTURED` | agent, date, premium, rate, participation e commission |
| Client Intelligence | `CONTRACT_CAPTURED` | date, category/subcategory, agent, client, policy, email, phone e notes; 2.829 eventos em 2 meses |
| Correspondence | `SURFACE_OBSERVED` | life/annuity, date, policy/trust, insured/annuitant, document type, retrieve, merge PDF e history; documentos não recuperados |
| Life pending lapse | `CONTRACT_CAPTURED` | owner, policy, face amount, lapse date, days, grace start, product e issued; zero no escopo default |
| PIP pending | `SURFACE_OBSERVED` | agent/agency, policy, annuitant, product, submit date e expected/total contribution |
| Premium Report | `CONTRACT_CAPTURED` | YTD/MTD/WTD/previous year, agent IDs, life target/excess e annuity annualized/PIP/single |
| Life Persistency | `CONTRACT_CAPTURED` | 12/24 months, issued premium, in-force premium e persistency rate |
| Daily Unit Values | `SURFACE_OBSERVED` | product/date, fund manager, subaccount, current/previous unit value e daily change; exige seleção de produto |
| Annuity past due | `CONTRACT_CAPTURED` | amounts/counts para 45–59 e 60+ dias; zero no escopo default |
| Payroll flow changes | `CONTRACT_CAPTURED` | premium, contribution restart/discontinue e billing, amounts/counts por 7/14/21 dias |
| PIP Contribution Increase | `CONTRACT_CAPTURED` | formulário de ação por policy; não é fonte passiva e não foi submetido |
| Transfers & Exchanges | `CONTRACT_CAPTURED` | status, amounts, AAP, product/LOB, closed reason/date, agency/agent e carrier |
| Transfer Company Information | `CONTRACT_CAPTURED` | carriers, product types, phone/fax/address/email, forms, notes e transfer tips |
| Recently Closed | `SURFACE_OBSERVED` | submitted, insured/annuitant, policy, AAP, product e status; janela de 90 dias |
| Placement Report | `CONTRACT_CAPTURED` | indisponível no próprio portal; não pode alimentar KPI atual |
| Informal Request | `CONTRACT_CAPTURED` | formulário de underwriting preliminar; nome, DOB, face amount, state, SSN, HIPAA, documentos e case contact; não foi submetido |
| Commission Overview | `CONTRACT_CAPTURED` | payable/pending, cut-off, EFT date e calendários por line of business |
| Payable Gross Commission | `CONTRACT_CAPTURED` | payee/agent e valores por company/product; detalhe por policy, insured, process date, premium, gross, rate, participation e pay date |
| Pending Gross Commission | `CONTRACT_CAPTURED` | agent e valores por company/product; zero no escopo default |
| Commission Earning Report | `CONTRACT_CAPTURED` | pay date, payee, statement, chargeback balance, deduction balances e NLD report |
| Commission Payment Portal | `CONTRACT_CAPTURED` | GlobalID e payee; dois payees observados |
| Policy Payment History | `CONTRACT_CAPTURED` | busca autorizada por policy + insured first/last; detalhe com transaction date, type e amount; 33 pagamentos no exemplo ativo, janela de dois anos |
| Policy Commission History | `CONTRACT_CAPTURED` | busca autorizada por policy + insured first/last; detalhe com agent, date, premium, rate, participation e commission; limitado a um ano, exclui pending e não retornou lançamentos para a amostra |

## Foresight Life

Estado: `CONTRACT_CAPTURED`, sem Save/Save As/Copy/Run Reports/Export/iGO.

- 419 casos existentes, 15 por página, com folder, last updated, product,
  export e disponibilidade de iGO por caso.
- Ações de gestão: move, copy, assign, delete, import, composite, save, save as,
  InsMark, run reports e iGO. Elas não pertencem ao coletor read-only.
- Client: jurisdiction, insured/owner, contact, DOB/age/gender, rate class,
  table rating, flat extra e pension underwriting.
- Funding: solve focus, compliance test, MEC avoidance, face/death-benefit
  schedules, premium schedules, 1035 exchange, distributions, loans e target.
- Riders: BSB, BDO, child term, DBPR, GIR, waiver, other insured, premium
  chronic care e accelerated benefits.
- Interest: allocation preferences, illustrated/max/minimum rates, multiple
  strategies, systematic allocation e loan rate.
- Quick View: face, lapse/MEC years, modal premium/mode, statutory premium
  limits e projeção anual com premium, rate, loan, income, accumulated value,
  surrender value e net death benefit.
- Reports: NAIC illustration, supplemental illustrations, NLG story, coverage,
  ABR, tax, future actions, statutory premiums, charges, IRR e input summary.

O artefato oficial e a ação `Run Reports` continuam não verificados porque
geram saída no carrier.

## RapidProtect Solve

Estado: `CONTRACT_CAPTURED`, sem executar quote nem Send to eApp.

Inputs: issue state, first/last name, DOB, gender, tobacco class, solve target,
face/premium, death benefit option, strategy e allocation. A própria página
declara que o resultado é agent-use-only, apenas para quote verbal, e que a
ilustração completa deve ser feita no Foresight.

## iGO e-App

Estado: `BLOCKED_AT_SILENT_SIGN_IN` no gateway.

O portal autenticou até `pipepasstoigo.ipipeline.com`, que prepara um POST de
silent sign-in para `igoforms2.ipipeline.com/CossEnterpriseSuite/SilentSignIn.aspx`.
Após autorização explícita, o acionamento foi testado por submit programático,
clique controlado e clique visual. Em todas as tentativas, o gateway não emitiu
requisição de rede e permaneceu na página de passagem. Portanto, o perfil não
chegou à iPipeline e as listas/seções do iGO continuam não inspecionadas.
Nenhum draft foi criado. O controle temporário usado no teste foi removido.

## Gaps e mudanças obrigatórias no KeeprOne

1. Nunca usar `0` para premium/face/value ausente; usar `null/unknown` e origem.
2. Separar dashboard scope, table scope, time window e role/downline em todo KPI.
3. Modelar owner, insured, beneficiary, payor, agent e payee como papéis.
4. Promover policy detail, values, payment schedule, transactions e riders.
5. Estruturar New Business detail, requirements, communications e tracker.
6. Separar commission statement, payee, gross transaction, deduction,
   chargeback e pending forecast.
7. Tratar Informal Request e PIP Increase como ações com confirmação, não como
   relatórios automáticos.
8. Tratar Placement Report como indisponível e exibir a limitação no produto.
9. Manter RapidProtect como quote preliminar; Foresight é a ilustração oficial.
10. Primeira entrega iGO deve terminar em draft revisável; submit permanece ação
    de alto risco separada.

## Resultado das ações autorizadas

- Policy Payment History: consulta e detalhe concluídos; 33 transações no
  período de dois anos, com date, type e amount. A amostra exibida era do tipo
  premium payment.
- Policy Commission History: consulta e detalhe concluídos; a apólice foi
  reconhecida, mas não houve lançamento no período disponível de um ano.
- iGO: transmissão autorizada, porém bloqueada no silent sign-in antes de
  qualquer requisição para a iPipeline. Listas e seções permanecem não
  inspecionadas.

## Trabalho ainda pendente

- Recuperar uma amostra de Correspondence/PDF somente se houver seleção segura,
  sem mover itens para history.
- Reconciliar os totais observados com raw receipts, banco e UI do KeeprOne.
