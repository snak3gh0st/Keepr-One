# Auditoria de dados National Life

Data da revisão: 2026-09-02, 21:25 ET
Ambiente auditado: `root@88.99.124.74` (`keeprOneserver`)
Aplicação ativa: imagem/commit `ef2981edbdd2cd4d1c705d1ecb6cf4ad7ebd2bd5`
Banco: conexão `DATABASE_URL` do próprio container da aplicação, em modo somente leitura

Status geral: **NEEDS REVISION — os números atuais não podem ser certificados como
iguais à National Life**.

A captura bruta mais recente das 14 fontes operacionais terminou completa e sem
perda de páginas. O bloqueio está depois da captura: parte das fontes ainda é apenas
evidência raw, o portfolio normalizado está desatualizado, não há detalhe de capital
segurado nem ledger de produção PC, e a leitura permissiva de comissão em produção
inclui um histórico sem identificação de statement.

## Regra de confiança

Um valor pode ser identificado como dado da National Life somente quando conserva:

1. a superfície de origem no portal;
2. a identidade do registro da seguradora;
3. o instante da captura;
4. o valor bruto recebido;
5. o valor normalizado usado pela interface;
6. uma regra explícita de deduplicação;
7. uma divergência bloqueante, em vez de substituição silenciosa por zero.

Valores informados pelo agente, valores estimados e valores internos da Keepr One
devem permanecer separados dos valores confirmados pela seguradora.

## Resumo do snapshot de produção

| Área | Evidência encontrada | Veredito |
| --- | --- | --- |
| Último sync prioritário | 14/14 estágios; 20.324/20.324 registros raw; zero truncamentos e zero rejeições de normalização | captura completa para o plano executado |
| Portfolio National | 9.915 apólices; 7.570 `INFORCE`; 7.033 clientes ativos distintos | grão único, mas snapshot normalizado não coincide com o export atual |
| Capital segurado | 0/7.570 apólices em vigor com `NATIONAL_LIFE_POLICY_DETAIL`; tabela de detalhes vazia | **bloqueado**; não apresentar `$0` como total |
| AAP/prêmio registrado | export atual: 7.496 valores positivos em 7.507 apólices em vigor, total `$13,002,799.36`; portfolio: 7.491 em 7.570, total direto `$12,991,221.27` | **diferença de `$11,578.09`**, além de 42 apólices ausentes, 40 status e 194 premiums divergentes |
| Target Premium por apólice | 0/9.795 linhas do In-force e 0/804 casos atuais trazem CTP/Target Premium | **bloqueado** |
| Produção PC | 0 eventos no ledger `PromotionCredit` | indisponível; nunca substituir por comissão ou premium |
| Comissão atual com evidência completa | 7.119 transações únicas, `$39,633.95`: `$7,885.83` direct e `$31,748.12` override | válido para agosto/setembro capturados, não para histórico completo |
| Comissão mostrada pelo mapper permissivo implantado | 12.527 transações, `$63,425.14`, incluindo `$23,791.19` de julho sem `CommissionStatementId` | **não certificada** |
| Premium Report da agência | 232 registros raw, incluindo três linhas da tabela com cabeçalhos `YTD`, `Life`, `Annuities`, `Target`, `Annualized`, `Annualized PIP` e `Single` | capturado, mas ainda não normalizado para KPI |
| Quem fez a application | 705/705 linhas atuais de New Business têm writing agent name, writing agent number e agency | fonte disponível; coluna imutável da Application ainda não existe em produção |
| Ilustrações | 17 PDFs: 14 FlexLife e 3 LSW Term | 3/3 Term reconciliados; IUL ainda incompleto |

## Integridade do último sync

O último run `LOCAL_CONNECTOR` terminou em `2026-09-02T16:39:20.257Z`.
Todas as contagens abaixo reconciliaram `expected = received = rawPageRecords`:

| Fonte | Recebidos | Normalizados | Duplicados no lote | Armazenamento |
| --- | ---: | ---: | ---: | --- |
| In-force clients | 10.985 | 9.795 | 1.190 | raw + normalizado |
| Commission earning detail | 7.119 | 7.119 | 0 | raw + normalizado |
| New Business | 850 | 705 | 145 | raw + normalizado |
| Recently Closed | 112 | 99 | 13 | raw + normalizado |
| Correspondence | 47 | 47 | 0 | raw + normalizado |
| Paid Commissions | 10 | 10 | 0 | raw + normalizado |
| Commission Payment Portal | 2 | 2 | 0 | raw + normalizado |
| Payable Gross Commissions | 4 | 4 | 0 | raw + normalizado |
| Agent Dashboard | 256 | 0 | 0 | `RAW_PAGE_ONLY` |
| Commissions Overview | 245 | 0 | 0 | `RAW_PAGE_ONLY` |
| Commission Policy History | 229 | 0 | 0 | `RAW_PAGE_ONLY` |
| Pending Gross Commissions | 233 | 0 | 0 | `RAW_PAGE_ONLY` |
| Premium Report Agency | 232 | 0 | 0 | `RAW_PAGE_ONLY` |
| PIP Pending | 0 | 0 | 0 | raw + normalizado |

Os cinco estágios com zero linhas normalizadas não perderam registros. Seu contrato
atual declara `RAW_PAGE_ONLY`: a página foi guardada fielmente, mas seus campos ainda
não podem alimentar cards ou somas. “Stage completed” prova aquisição, não prova que
o KPI foi interpretado.

Há 104 runs canônicos no histórico: 23 completos e 81 falhos. O run mais recente
está completo e não possui falha não resolvida. Existe uma falha antiga de
`INFORCE_CLIENTS/PORTAL_REQUEST_FAILED`; ela não pertence ao snapshot completo mais
recente.

## Portfolio, clientes, capital e premium

### Apólices e clientes ativos

- 9.915 números de apólice National são únicos no modelo `Policy`.
- 7.570 estão mapeados como `INFORCE`, incluindo 52 `Pending Lapse` preservados no
  status bruto.
- Essas apólices pertencem a 7.033 clientes distintos.
- O export canônico atual contém 7.507 linhas mapeadas como em vigor, não 7.570.

O export atual possui 9.795 apólices de 382 writing-agent numbers, porém nenhuma
linha casa com o NPN do agente que fez o upload — mesmo removendo pontuação e zeros à
esquerda. Isso caracteriza um livro de agência, enquanto o promotor atual aceita
somente `row.agentNumber === uploader.npn`. Consequência: o snapshot de 2 de setembro
foi capturado, mas não atualizou o portfolio. Comparando por policy number, sem usar
esse gate, há:

- 9.753 correspondências;
- 42 apólices atuais ainda ausentes do `Policy`;
- 40 status divergentes;
- 194 AAPs divergentes;
- zero divergência de product name.

A correção deve mapear cada writing-agent number a um agente autorizado da agência
ou a uma fila explícita de não vinculados. Não é seguro simplesmente remover o gate
de ownership e atribuir 382 produtores ao uploader.

### Capital segurado

`NationalLifePolicyDetailSnapshot` possui zero linhas. Por isso, nenhuma das 7.570
apólices em vigor tem `faceAmountSource=NATIONAL_LIFE_POLICY_DETAIL` e o Total
Protection auditado está indisponível. A interface deve mostrar cobertura `0/7.570`
ou “aguardando detalhes”, nunca `$0` como se a National tivesse confirmado ausência
de proteção.

### Premium/AAP

O In-force grava `AnticipatedAnnualPremium` em `Policy.premium`; esse valor já é
anual. No snapshot normalizado, 2.094 apólices em vigor ainda dizem `Monthly` e duas
dizem `Quarterly`, resíduo de registros anteriores. Multiplicar novamente essas
frequências produz o total incorreto de `$32,387,716.07`.

O código local foi corrigido para:

- somar AAP diretamente com aritmética decimal;
- limpar `premiumMode` durante o próximo ingest National;
- bloquear clientes ativos, proteção e AAP quando o conjunto de policy numbers ou
  a data do portfolio normalizado não reconciliar com o In-force canônico;
- excluir null/zero sem transformá-los em valor confirmado.

Mesmo com a fórmula corrigida, o total normalizado atual de `$12,991,221.27` ainda
não é certificável contra os `$13,002,799.36` do export atual enquanto o gate de
ownership impedir o reingest.

## Comissões

A fonte financeira correta é `COMMISSIONS_EARNING_REPORT/GrossCommEarned`.

No escopo `LOCAL_CONNECTOR` existem 21.138 linhas armazenadas. A identidade estável
da transação, que deliberadamente exclui o `CommissionStatementId` rotativo, reduz
essas linhas a 7.119 transações reais e identifica 14.019 cópias de re-sync. Todas as
7.119 linhas do snapshot canônico mais recente possuem:

- Gross Commission válido;
- nível `Personal` ou `Override`;
- `CommissionStatementId`;
- policy number;
- payment date;
- dono autenticado da captura;
- identidade estável.

O subtotal canônico certificado é:

| Período | Gross commission |
| --- | ---: |
| 2026-08 | `$35,601.56` |
| 2026-09 | `$4,032.39` |
| Total | `$39,633.95` |

Por classificação explícita do carrier, esse mesmo subtotal se divide em:

| Demonstração | Campo National | Valor auditado |
| --- | --- | ---: |
| Direta do agente produtor | `WritingAgtLevel = Personal` | `$7,885.83` |
| Agência sobre a produção do agente | `WritingAgtLevel = Override` | `$31,748.12` |
| Total |  | `$39,633.95` |

A verificação somente leitura de 2 de setembro encontrou 434 números distintos de
agente produtor e 4 `PayeeId` distintos nas 7.119 transações canônicas. Nenhuma
dessas linhas está sem `WritingAgtNumber`, `WritingAgtName`, `PayeeId`,
`PayeeName` ou agência. Portanto, a abertura por agente é suportada pelo dado
atual sem aproximação.

A tela local de comissões agora abre essa demonstração por
`WritingAgtNumber`/`WritingAgtName`, preserva `PayeeId`/`PayeeName` para mostrar
quem recebeu e exibe `WritingAgentAgency` quando informado. O KeeprOne não chama
uma linha de "minha" somente por semelhança de nome: `Personal` e `Override`
continuam sendo as classificações oficiais da National, e o número do agente é a
chave do demonstrativo. Linhas sem `WritingAgtNumber` ficam fora do subtotal
auditado.

O histórico legado de julho tem 5.408 linhas e `$23,791.19`, mas nenhuma possui
`CommissionStatementId`. O mapper permissivo atualmente implantado soma esse lote e
chega a `$63,425.14`. O gate estrito local bloqueia o total geral em vez de chamar
essas linhas de comissão paga auditada. Para liberar julho, é necessário recapturar
o statement oficial ou mantê-lo explicitamente como histórico não certificado.

Das 5.230 policy numbers distintas nas comissões canônicas, 2.521 existem no livro
atual e 2.709 estão fora dele. Isso é compatível com renewals de apólices que já não
estão no In-force; não é motivo para descartar dinheiro real.

## Premium Report, dashboard da National e produção PC

O Premium Report atual foi preservado como página estruturada. A tabela capturada
possui os cabeçalhos `YTD`, `Life`, `Annuities`, `Total`, `Target`, `Excess`,
`Annualized`, `Annualized PIP` e `Single`. Sua linha de premium contém os valores
`$50,734.97`, `$40,012.81`, `$10,722.16`, `$1,200.00`, `$1,200.00`, `$0.00` e
`$0.00`.

O snapshot de página achata cabeçalhos com `colspan`, portanto a posição exata de
cada componente ainda precisa de um parser e fixture próprios antes de exibir
`$50,734.97` como “produção principal”. O mesmo vale para os 256 registros raw do
Agent Dashboard. Até esse mapper existir, o KPI principal deve permanecer
“não auditado”, não inferido do AAP ou da comissão.

O ledger `PromotionCredit` está vazio. Como nenhuma linha individual do In-force ou
New Business trouxe CTP/Target Premium, não existe base para calcular
`PC = min(Target Premium, AAP) × qualification weight`. Comissão nunca pode ser
usada como fallback de PC.

## Applications e writing agent

O New Business atual contém 705 registros normalizados. Todos os 705 preservam
writing-agent name, writing-agent number e agency. Portanto a National já fornece
“quem escreveu o caso”. Isso é diferente de “quem criou a Application na KeeprOne”.

A migration local adiciona `Application.createdByUserId`, mas a coluna ainda não
existe no banco de produção. O deploy precisa aplicar a migration e o fluxo deve
mostrar separadamente:

- criador imutável da Application na KeeprOne;
- writing agent confirmado pela National;
- agência confirmada pela National.

## Ilustrações e Quick Review

Existem 17 PDFs Foresight:

- 14 FlexLife/IUL: 12 têm resultado estruturado; dois PDFs não têm carrier result;
- 3 LSW Term: os três têm premium reconciliado com o PDF oficial;
- zero das 14 IUL possui Quick Review/tabela anual persistida em produção.

Nos resultados estruturados existentes, face amount e premium mensal armazenados
batem com o carrier result. A diferença mensal × 12 versus anual permanece dentro da
tolerância de seis centavos usada pelo próprio contrato Foresight.

O histórico de comandos tem 55 solicitações: 16 completas, 38 falhas e uma em
`AUTH_REQUIRED`. As maiores classes de falha são solve readback timeout (9), client
readback timeout (7), premium write mismatch (5), report selection mismatch (3) e
schema mismatch (3). Há também um Term funding timeout, um Term navigation timeout e
um Term readback mismatch. Esse histórico confirma que o fluxo Term precisa manter
os read-backs estritos; repetir ou aceitar automaticamente seria inseguro.

O código local já lê o Quick Review IUL antes de pedir o PDF e persiste resumo,
evidência bruta e as linhas anuais devolvidas pelo Foresight. O arquivo
`quickview.csv` de referência confirma 83 linhas anuais (anos 1 a 83, idades 38 a
120) e os dez campos do resumo. A interface, porém, só recebe o resultado ao final
do comando.
Uma aprovação humana real antes do PDF exige separar o protocolo em
`PREPARE/REVIEW` e `GENERATE_PDF`.

Quick Review/tabela anual de Term continua sem fixture real da National; não é seguro
reutilizar os ids e cabeçalhos de IUL.

## Matriz dos números

| Número | Fonte oficial | Gate obrigatório | Estado |
| --- | --- | --- | --- |
| Face Amount | policy detail Coverage / `Total Face Amount` | valor positivo, policy number, observedAt e source exatos | código pronto; dados 0% |
| AAP | In-force `AnticipatedAnnualPremium` | usar como anual, raw preservado, ownership resolvido | fórmula local corrigida; reingest bloqueado |
| Target Premium | policy detail CTP ou campo explícito Target Premium | nunca inferir de modal premium/comissão | sem dados por apólice |
| Produção PC | ledger append-only confirmado | Target + AAP + peso, com correction/reversal | ledger vazio |
| Comissão paga | earning detail `GrossCommEarned` | statement, policy, date, level, owner e identidade | agosto/setembro válidos; julho não certificado |
| Premium IUL | ledger Foresight + Quick Review | modal e annual dentro da tolerância do contrato | resultados atuais conferem; Quick Review não implantado |
| Target Premium IUL | Foresight Quick View | positivo, source rows e observedAt | implementado localmente |
| Tabela anual IUL | Foresight Quick View | cabeçalhos, ano/idade, até 121 linhas | implementado localmente |
| Premium Term | PDF oficial | face, prazo, mensal e anual reconciliados | 3/3 atuais conferem |
| Quick Review Term | superfície Term real | fixture e parser próprios | **bloqueador aberto** |

## Mudanças locais ainda não implantadas

- login automático sem ativar a aba da National;
- equivalência de formatação monetária no read-back Term;
- Face Amount nos cards de apólice/ilustração;
- cinco estratégias IUL, incluindo Maximum Cash Value;
- Quick Review IUL com Target Premium e tabela anual;
- dashboard HOJE com clientes ativos, cobertura, AAP e fonte de comissão separada;
- gate estrito para comissão e deduplicação por identidade estável;
- `Application.createdByUserId` com migration;
- correção descoberta por esta auditoria: AAP não é anualizado uma segunda vez.

Produção continua na imagem `ef2981e`; não houve commit, push, migration, deploy,
reingest ou alteração de dados durante esta auditoria.

## Checklist antes de chamar os números de auditados

1. Definir o contrato de ownership do livro de agência e mapear os 382 producer
   numbers sem transferir políticas entre tenants por aproximação.
2. Reexecutar o ingest do snapshot de 2 de setembro e exigir zero: missing policy,
   status mismatch e AAP mismatch.
3. Executar policy detail para todas as 7.507 apólices atuais em vigor e exigir
   cobertura de Face Amount declarada na interface.
4. Finalizar e testar o mapper com `colspan` do Premium Report/Agent Dashboard antes
   de promover qualquer valor raw a KPI principal.
5. Obter Target Premium/CTP por apólice e popular o ledger PC com fórmula e
   attribution imutáveis.
6. Recapturar julho com statement id ou rotular esse histórico como não certificado.
7. Fazer smoke real de IUL e Term com a extensão publicada, comparando formulário,
   Quick Review, read-back e PDF da mesma execução.
8. Aplicar a migration de application creator e verificar criador KeeprOne versus
   writing agent National.
9. Publicar data/hora e cobertura de cada KPI; qualquer rejeição deve bloquear o
   subtotal afetado.

## Lapsed e cancelled: recuperação sem falso positivo

O modelo atual contém 1.755 `LAPSED` e 515 `CANCELLED`. No export canônico atual são
1.694 lapsed e 513 cancelled; 939 dessas linhas possuem `termConversionDate` e
`levelPeriodEndDate`.

Essas datas ajudam a triagem, mas não provam elegibilidade. O fluxo correto é:

1. classificar `REINSTATEMENT`, `TERM_CONVERSION`, `NEW_COVERAGE` ou `NEEDS_REVIEW`
   com motivo e fonte;
2. verificar status/data, produto, conversion date, level-period end e requisitos de
   reinstatement;
3. verificar telefone/e-mail, consentimento, opt-out/STOP e limite de frequência;
4. gerar a primeira mensagem como rascunho para aprovação do agente;
5. registrar envio, resposta, opt-out, recuperação e inelegibilidade de forma
   imutável;
6. interromper imediatamente após opt-out ou quando a elegibilidade não puder ser
   provada.

O sistema ainda não possui ledger completo de consentimento/opt-out nem prova de
reinstatement. Portanto, nenhum envio automático foi ativado.

## Reprodutibilidade

O script `scripts/audit-national-life-production.cjs` executa somente consultas e
emite agregados sem PII. Ele deve rodar dentro do container da aplicação para usar o
mesmo Prisma Client e a mesma conexão do release auditado.
