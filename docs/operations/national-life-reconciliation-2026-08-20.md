# National Life — reconciliação da varredura autenticada

Data: 2026-08-20

## Identificação da sessão

| Campo | Valor |
|---|---|
| Agente | registrar somente identificador mínimo necessário |
| Início/fim | pendente |
| Versão KeeproneConnect | pendente |
| Ambiente KeeprOne | pendente |
| Run ID | pendente |
| Resultado geral | não iniciado |

## Sessão autenticada de 2026-08-21

Varredura read-only iniciada e documentada em
`docs/operations/national-life-live-sweep-2026-08-21.md`.

- Portal principal, New Business, in-force, policy/client detail, servicing,
  reports, commissions e Foresight foram observados.
- Nenhuma ação de criação, upload, mensagem, save, report, submit, move ou delete
  foi executada.
- Policy Payment History foi consultado com autorização: 33 transações em dois
  anos, com date, type e amount.
- Policy Commission History foi consultado com autorização: a apólice foi
  localizada, mas o detalhe não trouxe lançamentos na janela de um ano.
- O acesso ao iGO foi autorizado, mas o silent sign-in não emitiu requisição de
  rede para a iPipeline. Nenhum draft foi criado e as telas do iGO não foram
  inspecionadas.
- A reconciliação com raw receipts/banco/KeeprOne ainda não foi executada; os
  totais desta sessão não devem ser publicados como validados.

## Cadeia obrigatória de prova

Para cada fonte:

`total no portal → recebido bruto → escrito normalizado → rejeitado → chaves únicas → promovido ao domínio → visível no KeeprOne`

Nenhum zero é aceito como valor de negócio quando o portal não forneceu o campo. Nesse caso registrar `unknown/null`, ausência da fonte e motivo.

## Reconciliação banco e UI em 2026-08-21

Fonte consultada em modo read-only: banco `lifeos` por túnel SSH ativo. O último
run concluído é de 2026-08-19, com 26/26 estágios, 116 recibos, 116 páginas raw,
zero estágio truncado e zero rejeição. Isso prova a entrega daquele run, mas não
prova atualidade em relação ao portal medido em 2026-08-21.

| Fonte | Portal 21/08 | Raw 19/08 | Escrito no run | Estado atual no KeeprOne | Conclusão |
|---|---:|---:|---:|---:|---|
| New Business | 720 | 870 | 722, com 148 duplicados | 719 New Business + 101 Recently Closed | snapshot antigo e deduplicação; não comparar 870 com 719 como se fossem o mesmo denominador |
| All Clients | 10.896 | 10.952 | 9.862, com 1.090 duplicados | 9.789 policies; 7.454 marcadas Active | raw histórico fecha, mas UI mistura downline/status e não corresponde ao resumo pessoal de 394 |
| Client Intelligence | 2.829 em 2 meses | 2.739 | 2.739 | 2.739 | diferença de +90 eventos causada pela janela posterior do portal |
| Policy Payment History | 33 transações na amostra | 229 registros de estrutura da página | 229 | 229 report rows genéricas | incorreto: esses 229 são heading/text/link/form, não pagamentos |
| Policy Commission History | zero na amostra/um ano | 229 registros de estrutura da página | 229 | 229 report rows genéricas | incorreto: esses 229 não são lançamentos de comissão |
| Placement Report | indisponível | 227 registros de estrutura da página | 227 | 227 report rows genéricas | incorreto: indisponibilidade virou contagem de conteúdo da página |
| PIP Contribution Increase | formulário de ação | 227 registros de estrutura da página | 227 | 227 report rows genéricas | incorreto: formulário não é relatório nem fila de 227 oportunidades |
| Payable commissions | US$ 15.906 no portal atual | 4 linhas resumo | 4 | soma histórica LSW life US$ 5.979,11 e annuity -US$ 5,68 | pay date/escopo diferente; não reconciliado com o total atual |

### Falha de produto confirmada

A aba `Relatórios` da UI carrega 4.555 `NationalLifeReportRow` no escopo
canônico. Grande parte desses registros são estrutura genérica da página
(`Title`, `Text`, `Href`, `FormIndex`, `TableIndex`) transformada em linha de
negócio. Portanto, o contador de relatórios e qualquer KPI derivado dessa
coleção não são confiáveis.

O detalhe de comissão com `GrossCommEarned` existe em um escopo legado
(`keepr-one-production-v1`, captura de 2026-07-30), com 5.408 linhas, mas não
está no escopo canônico exibido pela página atual. O trabalho local para coletar
o detalhe no conector novo passou nos testes, porém isso ainda não é prova de
deploy nem de uma nova captura autenticada.

### Validação de código

- Núcleo National Life: 5 arquivos de teste, 95 testes aprovados.
- KeeproneConnect: 17 arquivos de teste, 168 testes aprovados.
- Esses testes validam contratos e transformações; não substituem uma nova
  captura, reconciliação no banco e conferência visual da UI.

## Correção local de 2026-08-21

Critério de produto confirmado: a KeeprOne é a área operacional diária; a
National Life permanece como fonte/espelho auditável.

- Fontes `READ_PAGE` agora persistem apenas em `NationalLifeRawGridPage` até
  existir parser específico. `PAGE_META`, `PAGE_TEXT`, links e forms não viram
  mais `NationalLifeReportRow`.
- A UI aceita somente chaves de relatório operacional estruturadas, protegendo
  imediatamente contra as 4.555 linhas antigas contaminadas.
- O denominador automático foi corrigido de 15/30 para 12/30. Dashboard,
  Premium Report e Commission Overview permanecem capturados, mas não
  estruturados.
- `Policy.premium` passou a aceitar `null`; prêmio ausente da National não vira
  mais zero. A migração converte os placeholders zero já existentes para null.
- A UI passa a separar fontes estruturadas de páginas raw e deixa explícito que
  All Clients e o resumo pessoal da National usam denominadores diferentes.
- O coletor KeeproneConnect 0.1.18 inclui detalhe de comissão com
  `CommissionStatementId` e `GrossCommEarned` no escopo canônico.

Validação local completa: 162 arquivos/1.341 testes do app, 17 arquivos/168
testes da extensão, ambos os typechecks e ambos os builds aprovados. A prova de
deploy, migração aplicada, extensão recarregada e nova captura permanece aberta.

## Evidência por fonte

| Fonte | Data/filtros | Total portal | Bruto | Normalizado | Rejeitado | Chaves únicas | Promovido | Visível | Estado | Evidência/observação |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|---|
| preencher durante a varredura | | | | | | | | | `NOT_VISITED` | |

## Amostras mínimas de detalhe

| Amostra | Identificador mascarado | Campos/abas esperados | Resultado |
|---|---|---|---|
| Apólice life ativa | mascarado na evidência | owner/insured, face amount, death benefit, premium, cash/surrender/loan values, strategy | contrato e detalhe observados |
| Apólice com risco/lapse | pendente | status, grace/lapse dates, premium due, action required | não iniciado |
| Annuity | pendente | contract value, contributions, allocations, withdrawals | não iniciado |
| New Business pendente | pendente | status, underwriting, requirements, messages, documents | não iniciado |
| Caso recentemente fechado | pendente | disposition, close date, reason | não iniciado |
| Comissão paga | mascarado na evidência | pay date, policy, writing agent/payee, gross, net, type | contrato observado no drill-down; busca por apólice sem lançamento na janela de um ano |
| Comissão pendente | pendente | expected/payable amount, status, policy, reason | não iniciado |
| Correspondência | pendente | metadata, category, policy/case association, document retrieval | não iniciado |

## Illustration/Foresight — somente leitura

| Item | Evidência necessária | Resultado |
|---|---|---|
| Dados de entrada | insured, state, product, underwriting, solve, benefits, riders, allocations | observado em caso existente, sem edição |
| Identificadores | case, illustration, product/version e contact IDs | case/lista observados; IDs completos não copiados |
| Saídas | face amount, premium, values, guarantees, lapse/MEC e reports | Quick View e catálogo de reports observados |
| Artefato oficial | PDF/arquivo, data, versão e origem carrier | não iniciado |
| Ações | criar, salvar, copiar, executar, reportar e baixar, com risco | mapeadas; nenhuma executada |

## Application/iGO — somente leitura

| Item | Evidência necessária | Resultado |
|---|---|---|
| Papéis | applicant, insured, owner, beneficiary, payor, agent | bloqueado antes da aplicação |
| Seções | suitability, replacement, funding, medical, underwriting, signatures, payment | bloqueado antes da aplicação |
| Identificadores | carrier case, iGO case/draft, policy e party IDs | nenhum draft criado |
| Estados | draft, validation, outstanding requirements, submitted, carrier received | bloqueado no silent sign-in |
| Documentos | tipos, requisitos, upload constraints e receipts | bloqueado antes da aplicação |
| Ações | preparar draft, salvar, anexar, mensagem e submeter, com risco | transmissão autorizada; gateway não emitiu POST; nenhuma ação iGO executada |

## Critérios para encerrar a sessão

- A sessão permanece autenticada e nenhuma ação de escrita foi executada.
- Cada superfície visitada tem campos, filtros, identificadores e transporte registrados.
- Totais do portal foram capturados antes de paginação/export.
- Divergências estão explicadas; não foram transformadas em zero nem ocultadas.
- Dados pessoais completos não foram copiados para a documentação.
- Próximas implementações ficam separadas por fonte e por ação.
