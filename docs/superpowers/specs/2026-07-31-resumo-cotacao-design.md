# Resumo da cotação — desenho

Data: 2026-07-31
Estado: aprovado para plano de implementação

## Problema

Hoje uma cotação vira duas coisas na tela: uma linha de tabela com capital e
prêmio, e um botão que pede o PDF à seguradora. A linha é pouco para conversar
com um cliente, e o PDF depende de uma sessão de carrier que morre ~80 min
depois do login humano — medido em 2026-07-31, com job real falhando às 15:38
com `FORESIGHT_SSO_EXPIRED`.

O resultado prático é que o agente fica sem nada apresentável na maior parte do
dia, por um motivo que não tem relação com a qualidade do dado: **os números já
estão no banco.**

## O que já temos, medido

`Illustration.rawPayload` de uma cotação real em produção:

```jsonc
request:  { IssueAge: 38, Gender: "Male", IssueState: "FL",
            RateClass: "Standard_NT", SolveType: "Min_DB_Max_Cash_Value",
            Strategy: "SP500PointToPointCapFocus", Allocation: 100,
            DeathBenefitOption: "A_Level", ProductCode: "956",
            PremiumMode: "Monthly", Amount: 300,
            FirstName, LastName, DateOfBirth }
response: { ok: true, faceAmount: 215473, annualPremium: 3600,
            monthlyPremium: 300, lapseYear: null }
```

Catorze campos de entrada e quatro números de saída, **todos vindos da
seguradora**. Suficiente para uma peça de conversa completa, sem tocar no
carrier.

O que **não** temos: projeção ano a ano (valor de resgate e benefício por ano).
Isso só existe dentro do PDF do Foresight. `IllustrationScenario` existe vazio e
é o lugar dessa tabela se um dia ela vier — este desenho não a preenche.

## Objetivo

Uma página que apresenta a cotação com os números reais da seguradora, **sem
depender de sessão de carrier**, boa o bastante para o agente conduzir a
conversa e compartilhar tela.

## Fora de escopo, de propósito

- **Logo ou identidade visual da National Life.** Vestir a marca faz a peça
  parecer emitida pela seguradora, que é justamente o que a regra de compliance
  existe para impedir, e material de venda com a marca do carrier normalmente
  exige revisão de publicidade da própria seguradora. A peça é do Keepr One e
  diz de onde vieram os números.
- **A palavra "ilustração" como nome da peça.** Nos EUA *illustration* é
  documento regulado (NAIC Model Reg 582). A peça se chama **Resumo da
  cotação**.
- **Projeções, valores estimados, crescimento.** Nada calculado por nós.
- **PDF gerado por nós.** O documento oficial continua sendo o do carrier.
- Qualquer dependência de sessão viva. Esta camada funciona com o carrier
  inteiramente fora do ar — é o ponto dela.

## Desenho

### Rota

`app/agent/illustrations/[id]/page.tsx`. Hoje existem só a lista e o `new`.
Escopada por `agentId` na própria query, como o resto do portal — uma cotação
nomeia um segurado e um prêmio, e quem pode ler é quem pediu.

Não encontrada ou de outro agente: `notFound()`. Indistinguíveis de propósito.

### Origem do dado

`lib/national-life/quote-summary.ts` já lê esse payload e já serve a lista.
**Estende-se o `QuoteFacts` existente** em vez de criar um segundo leitor — dois
leitores do mesmo JSON divergem, e o que diverge aqui é dinheiro.

Campos a acrescentar, todos opcionais como os atuais: `solveType`,
`deathBenefitOption`, `allocation`, `premiumMode`, `productCode`, `faceAmount`,
`monthlyPremium`, `lapseYear`, `dateOfBirth`, `insuredName`.

Ausente renderiza `—`. Nunca um número inventado, nunca um crash: linhas
gravadas antes de um campo existir têm que abrir.

### Vocabulário — o trabalho de verdade

O carrier fala em código: `Min_DB_Max_Cash_Value`, `Standard_NT`, `A_Level`,
`SP500PointToPointCapFocus`. Módulo puro e testado
`lib/national-life/rapid-solve-labels.ts` traduz para o **termo padrão do setor,
em inglês** — *Minimum Death Benefit / Maximum Cash Value*, *Standard
Non-Tobacco*, *Level Death Benefit*, *S&P 500 Point-to-Point, Cap Focus*.

Inglês por decisão explícita: traduzir terminologia de produto regulado para
português é onde se desinforma sobre um produto financeiro. O cromo da tela
segue em português, como o resto do app.

**Código desconhecido mostra o código cru.** Um `SolveType` novo que o carrier
introduza aparece como `SolveType_Novo`, nunca mapeado a um chute — o agente
precisa poder repetir para quem sabe ler.

### Blocos da página

| bloco | conteúdo |
| --- | --- |
| Segurado | nome, nascimento, idade ANB, sexo, estado de emissão, classe de risco |
| O que foi pedido | tipo de solve, valor e periodicidade, opção de benefício, estratégia, alocação |
| O que a seguradora respondeu | capital segurado, prêmio mensal, prêmio anual, ano de lapso |
| Procedência | data da cotação, condição do carrier, e onde está o PDF oficial |

`lapseYear: null` significa **"não lapsa"**, não ano zero — já tratado em
`lib/national-life/rapid-solve.ts` e a tela tem que dizer isso por extenso.

`IssueAge` é **ANB** (idade no aniversário mais próximo), não idade corrente. A
tela rotula como tal: os dois números divergem metade do ano, e um agente que
confunde desprecifica a conversa.

### Procedência, que é o que atende compliance

Bloco fixo, sempre visível: de onde vieram os números e quando, **a condição do
carrier copiada palavra por palavra da lista** (`app/agent/illustrations/page.tsx`,
que já a carrega e cujo comentário diz que ela viaja junto com o número), e o
ponteiro para o documento oficial.

⚠️ **Corrigido duas vezes durante a execução.**

**Primeiro:** esta spec escreveu uma condição própria e mais curta — "servem
para cotação verbal" — que **perdia** *"não pode ser exibido a ele"* e *"os
valores não são garantidos"*. Era a falha mais séria do desenho: esta página
mostra mais números, maiores e sozinhos, e é justamente a que alguém teria
vontade de virar para o cliente.

**Depois, por decisão do dono do produto:** a condição passou a dizer também o
que a peça **não é**. Texto vigente, idêntico nas duas telas:

> Cotação, não proposta. Os valores são demonstrativos (illustration) — não são
> garantidos e dependem de aprovação de proposta completa na emissão. Uso
> interno do corretor: pode servir para uma cotação verbal ao cliente, mas não
> pode ser exibido a ele.

Duas mudanças que valem explicar. **"Cotação, não proposta"** separa
explicitamente cotação de *application* — são coisas diferentes, e a confusão
entre elas é a que custa caro. E **"demonstrativos (illustration)"** usa o termo
do setor de propósito: é o que a seguradora chama de illustration, e o agente
precisa reconhecer a palavra. Isso não contradiz a regra de não batizar a página
de "Ilustração" — o título segue **Resumo da cotação**; a palavra aparece como
glosa do que os valores são, não como nome do documento.

**Regra que fica:** a condição vive em **uma constante só**
(`lib/national-life/quote-disclaimer.ts`), lida pelas duas telas, com teste que
falha se um dos três pontos — cotação-não-proposta, valores não garantidos, não
exibir ao cliente — for perdido numa reescrita futura. Duas telas enunciando a
mesma condição regulada com palavras diferentes é pior que qualquer uma das duas
sozinha, e copiar à mão foi o que já falhou uma vez aqui.

Quando a ilustração já tem PDF gravado, o bloco linka para
`/api/illustrations/[id]/document`. Quando não tem, oferece o botão que
enfileira — reaproveitando `IllustrationPdfButton` e o estado de fila já
existente.

### Impressão

Compartilhar tela e imprimir são os dois usos reais. Sem CSS de impressão
próprio nesta fase: a página é uma coluna, e o que quebra impressão é layout
decorativo, que não existe aqui.

## Erros

- Cotação inexistente ou de outro agente → `notFound()`.
- `rawPayload` ausente ou de formato desconhecido → a página abre com o que a
  `Illustration` tem em colunas (`faceAmount`, `premium`, `insuredName`) e os
  blocos derivados mostram `—`. Uma cotação antiga não pode virar tela de erro.
- Recusa da seguradora (`ok: false`) → a página diz que não houve cotação, em
  vez de exibir zeros como se fossem números.

## Testes

Puro e barato, no padrão da casa:

- `rapid-solve-labels`: cada código conhecido; código desconhecido devolve o
  próprio código; `null`/vazio não quebra.
- `quote-summary` estendido: payload real completo; payload sem `response`;
  payload de recusa; payload de formato antigo.
- `lapseYear: null` lê como "não lapsa" e `0` nunca aparece como ano.
- A página: cotação com PDF mostra o link; sem PDF mostra o botão; de outro
  agente dá `notFound`.

## O que isso não resolve

A sessão do carrier continua morrendo ~80 min depois do login, e o PDF oficial
continua dependendo dela. Este desenho **reduz a frequência com que isso dói** —
de "toda vez que quero ver números" para "quando o cliente pede o documento" —
e não substitui o trabalho de sessão viva, que segue registrado em
`docs/operations/national-life-portal-contract.md`.
