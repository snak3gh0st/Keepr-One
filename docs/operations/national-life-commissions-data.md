# Comissões: o que os 5.408 registros realmente são

Medido no `lifeos` em 2026-07-31, antes de propor qualquer modelagem. Existe
para que a decisão de modelar — e **como** modelar — seja tomada sabendo o que
o dado é, e não o que 5.408 linhas sugerem que ele seja.

Nenhum nome de segurado ou de agente aparece neste documento. Os campos são
nomeados; os valores das pessoas ficam no banco.

## O achado que muda a prioridade: não é histórico, é um mês

`COMMISSION_DETAIL_NLD_COMMISSION_EARNING` tem 5.408 linhas e exatamente
**quatro** valores distintos de `PaymentDate`:

| PaymentDate | linhas | `GrossCommEarned` somado |
| --- | --- | --- |
| 07/07/2026 | 994 | US$ 2.893,49 |
| 07/14/2026 | 1.012 | US$ 3.493,52 |
| 07/21/2026 | 2.018 | US$ 12.459,93 |
| 07/28/2026 | 1.384 | US$ 4.944,25 |
| | **5.408** | **US$ 23.791,19** |

São quatro pagamentos semanais de **um único mês**. "Total por período" tem
quatro períodos. Não dá para fazer série histórica, tendência, nem comparação
ano contra ano com o que está no banco hoje.

Isso não torna o trabalho inútil — torna-o **menor do que parecia**, e muda a
pergunta. A pergunta boa deixa de ser "como modelar o histórico" e passa a ser
**"o portal entrega mais de um mês?"**. Se entregar, a extração precisa variar
a data antes da modelagem valer a pena; se não entregar, a modelagem serve para
acumular dali para a frente, o que é um ganho de prazo, não imediato.

O grid é dirigido por data, como já registrado em `COMMISSIONS_OVERVIEW` no
contrato do portal. Descobrir o alcance custa uma sonda de leitura.

## A grade de classificação, que é boa

Três campos discriminantes, todos preenchidos, com contagens fechando em 5.408:

| `CompensationType` | `TransactionType` | `WritingAgtLevel` | linhas |
| --- | --- | --- | --- |
| Renewal Compensation | Standard | Override | 3.587 |
| First year Compensation | Standard | Override | 901 |
| Renewal Compensation | Excess | Override | 515 |
| Renewal Compensation | Standard | Personal | 203 |
| First year Compensation | Excess | Override | 153 |
| Renewal Compensation | Excess | Personal | 36 |
| First year Compensation | Standard | Personal | 10 |
| First year Compensation | Excess | Personal | 3 |

Isso mapeia limpo no que os modelos já pedem: `CompensationType` é o
`CommissionType` (primeiro ano vs. renovação), `WritingAgtLevel` separa
produção própria de override — que é a base de downline — e `TransactionType`
distingue padrão de excedente.

Os demais campos úteis por linha: `PolicyNumber`, `NBPolicyNumber`, `Product`,
`ProductCo`, `ProductType`, `PremiumAmt`, `CommRate`, `ParticipationPercentage`,
`GrossCommEarned`, `PaymentDate`, `ProcessDate`, `PremiumEffDate`,
`PolicyIssueDate`, `BillingFrequency`, `PremiumTransaction`, `IncomeClass`,
`Agency`/`AgencyName`, `PayeeId`/`PayeeName`,
`WritingAgtNumber`/`WritingAgtName`/`WritingAgentAgency`, `InsuredName`.

`WritingAgtNumber` + `WritingAgtName` são o que torna downline modelável: cada
linha diz **quem escreveu** e **quem recebe** (`PayeeId`/`PayeeName`),
separadamente.

## O bloqueio real: mais da metade não casa com nenhuma apólice nossa

`CommissionTransaction` e `CommissionRecord` exigem `policyId → Policy`. Medido:

| `WritingAgtLevel` | linhas | casam com `NationalLifeInforcePolicy` | % |
| --- | --- | --- | --- |
| Override | 5.156 | 2.268 | 44,0 |
| Personal | 252 | 61 | 24,2 |

Por apólice distinta: **2.148 de 4.719**.

Não é bug de chave. Os dois lados usam o mesmo formato de nove dígitos, e a
`Policy` espelha a `NationalLifeInforcePolicy` linha a linha (9.614 cada), com
4.622 números de nove dígitos, 4.943 no formato `LS…` de sete dígitos e 49
terminados em `X`.

E **não está explicado**. A hipótese natural — "override é sobre apólice de
terceiro, por isso não está no meu livro" — foi testada e **falhou**: as
pessoais casam *pior* (24%) que as overrides (44%). O que sobra é que o
relatório inforce e o de comissão cobrem populações diferentes, e por qual
critério não se sabe. Candidatos não medidos: apólice encerrada que ainda paga
renovação, filtro de agência no relatório inforce, ou recorte de data.

Consequência direta: **exigir `policyId` descarta mais da metade do dinheiro.**

## A armadilha de nome

`COMMISSION_DETAIL_CHARGEBACK` **não é detalhe de estorno.** São 8 linhas em
grão de *pagamento*, não de apólice: `GrossPay`, `CommissionDollars`,
`CommissionsHeld`, `StartingChargebackBalance`, `EndingChargebackBalance`,
`PayCompany`, `ProcessDate`, e um `DetailsLink` para
`…/chargeback/debt?id=<32-hex>` que nunca foi aberto.

São os oito pagamentos do período com seus saldos. Serve de **conferência**: a
soma do detalhe por `PaymentDate` deve bater com o `CommissionDollars` daqui.
Não serve de fonte de estornos — esses estão atrás do `DetailsLink`.

## Como o dinheiro chega à tela hoje

`app/agent/commissions/page.tsx` lê `NationalLifeReportRow` cru, mapeia por
`toCarrierCommissionRecords`, e resolve os números que existem localmente só
para virar link. `app/agent/policies/[id]/page.tsx` faz o equivalente por
apólice. Funciona, e é por isso que isto não é urgente: **nada está quebrado,
está apenas não-modelado** — sem total por período, sem agregação por agente,
sem downline, e sem nada que uma query consiga somar.

## O que é decisão sua

O bloqueio de modelagem já registrado no contrato do portal reaparece aqui com
número: `policyId` obrigatório custa 56% das linhas.

1. **Tabela nativa do carrier** (`NationalLifeCommissionDetail`), chaveada por
   `PolicyNumber` como texto, com FK opcional para `Policy` quando existir.
   Guarda tudo, agrega tudo, e não força um vínculo que o carrier não dá.
   **É o que eu recomendo** — é o mesmo padrão de `NationalLifeInforcePolicy`,
   que já provou funcionar, e não gasta decisão de domínio antes da hora.
2. **Relaxar `policyId` para opcional** em `CommissionTransaction`. Menos
   tabelas, mas mexe em modelo compartilhado com o resto do produto por causa
   de uma particularidade de um carrier.
3. **Resolver o casamento primeiro** — descobrir por que 56% não casa e, se for
   recorte do relatório inforce, ampliar a extração até casar. Mais correto e
   mais caro; e pode simplesmente não ter solução do lado do carrier.

E antes de qualquer uma: **medir se o portal entrega mais de um mês.** Se
entregar, extrair primeiro e modelar depois evita modelar contra quatro
semanas e descobrir a forma errada.
