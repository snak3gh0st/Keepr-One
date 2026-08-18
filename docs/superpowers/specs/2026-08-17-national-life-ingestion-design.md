# National Life → carteira do Keepr One: desenho da ingestão

Data: 2026-08-17
Estado: desenho aprovado em premissa, aguardando revisão. Nada implementado.

## 1. O problema, com o que foi medido

O sync do National Life fechou hoje: 26 de 26 fontes, run `COMPLETED`, 18.878
linhas gravadas. Nenhuma dessas linhas chega na carteira do agente.

A investigação derrubou a premissa que o `national-life-como-area-de-informacao.md`
§4 registrava ("o dado é uma ilha, `Policy` não é escrita"). O que é verdade,
medido em produção:

| fato | valor |
| --- | --- |
| `Policy` com `sourceProvider = NATIONAL_LIFE` | 9.614 |
| dessas, com `faceAmount > 0` | **0** |
| dessas, com `premium > 0` | 2.148 (22%) |
| `sourceUpdatedAt` mais recente | **2026-07-30** |
| quem escreve `sourceProvider` no repo | **só `lib/csv/import-service.ts`** |

Ou seja: `Policy` está populada, mas por um **import manual de CSV feito em 30 de
julho** — não pelo sync. O sync nunca escreveu em `Client`/`Policy`, e a carteira
está 18 dias parada, com capital segurado zerado em todas as 9.614 apólices e
prêmio cobrindo 22% do livro.

`faceAmount` valer `0.000…` em 100% das linhas é pior que estar vazio: é um
número errado que qualquer tela pode somar e exibir como se fosse verdade.

### Os dois conjuntos disjuntos

`NationalLifeInforcePolicy` guarda dois recortes que nunca foram reconciliados:

| `deploymentScope` | apólices | data nasc. | prêmio | e-mail | endereço |
| --- | --- | --- | --- | --- | --- |
| `LOCAL_CONNECTOR` (export oficial) | 9.768 | **0** | 9.768 | 840 | 9.768 |
| `keepr-one-production-v1` (grid antigo) | 9.614 | **9.614** | **0** | 0 | 0 |

São complementares e nenhum basta sozinho. O export oficial tem 33 colunas,
verificadas uma a uma: **não traz data de nascimento, não traz capital segurado,
não traz cash value.** O grid antigo traz data de nascimento e nada de prêmio.

### Capital segurado só existe na página de detalhe

Nenhuma das 33 colunas do export tem face amount. Ele existe em
`policy-details?id=<32-hex>` (verificado ao vivo: `Total Face Amount`,
`Net Death Benefit`, e `Accumulated Cash Value` na aba `VALUES`). Isso significa
**uma requisição de página por apólice — 9.834 delas**.

E a restrição que decide o desenho: **a sessão do carrier morre em ~20 minutos.**
A ~1,5s por página cabem ~800 apólices por sessão. O livro inteiro numa passada é
impossível.

## 2. Decisões

### D1 — `Policy.faceAmount` passa a ser nullable

O schema exige `faceAmount`, e foi por isso que o import gravou `0` em todas as
linhas. Tornar nullable não é abrir mão do dado: é a condição para que ele possa
ficar **certo**, em vez de ficar mentindo `0`. Enquanto o backfill não alcança uma
apólice, a resposta honesta é "não sei ainda", que a UI mostra como `—`.

O projeto já aprendeu essa lição uma vez, e está escrita no próprio schema, em
`Illustration`:

> *"Requiring a case made the table impossible to write to — it stayed empty from
> the day it was created."*

`Illustration.faceAmount` é nullable pelo mesmo motivo. `Policy.faceAmount` é o
mesmo bug de classe, ainda não corrigido.

### D2 — Backfill de capital segurado é incremental e priorizado

Cada run normal do sync gasta o tempo de sessão que sobra buscando o detalhe das
apólices que ainda não têm `faceAmount`, na ordem: `Active` → `Pending Lapse` →
`Issued` → `Lapsed` → `Not Active`. Face amount praticamente não muda depois da
emissão, então é **busca única por apólice**, não a cada sync. O livro fecha em
~10 runs normais, sem run especial e sem pedir nada ao agente.

As alternativas foram descartadas por regra do próprio produto:

- **Backfill dedicado de uma vez** fecharia em horas, mas exigiria o agente
  relogando várias vezes durante a execução (re-auth silencioso de SSO já foi
  medido e não funciona). Exigência técnica no fluxo do agente é defeito.
- **Só as 7.519 ativas** contradiz a decisão de espelhar o livro inteiro.

Não construir o modo dedicado agora. YAGNI.

### D3 — Espelhar o livro inteiro, preservando o status do carrier

Todas as 9.834 apólices viram `Policy`, inclusive `Lapsed` (1.735) e `Not Active`
(512). Consequência aceita: a tela de Apólices precisa de filtro por status.

O enum `PolicyStatus` (`PENDING, APPROVED, INFORCE, LAPSED, CANCELLED`) não tem
`Pending Lapse` — que é justamente onde mora dinheiro recuperável. Mapear para
`INFORCE` apagaria o sinal. Então guardamos os dois: o enum mapeado **e** o status
cru do carrier.

| status do carrier | `PolicyStatus` | apólices |
| --- | --- | --- |
| Active | `INFORCE` | 7.519 |
| Issued | `APPROVED` | 110 |
| Pending Lapse | `INFORCE` | 79 |
| Lapsed | `LAPSED` | 1.735 |
| Not Active | `CANCELLED` | 512 |

### D4 — Precedência por campo entre os dois recortes

Não existe recorte vencedor; existe campo vencedor. A regra é **valor não-nulo mais
recente vence, com desempate por origem**:

| campo | fonte | por quê |
| --- | --- | --- |
| prêmio, endereço, e-mail, telefone, status, produto | `LOCAL_CONNECTOR` | export oficial, mais rico e mais recente |
| data de nascimento | `keepr-one-production-v1` | é a única origem que tem |
| capital segurado | `READ_POLICY_DETAIL` | não existe em nenhum dos dois |

### D5 — Vínculo pelas colunas que já existem, não por `ExternalReference`

`Policy` já tem `sourceProvider`/`sourceExternalId` com
`@@unique([sourceProvider, sourceExternalId])`, e as 9.614 linhas atuais já usam
`sourceExternalId = policyNumber`. A chave de upsert é
`('NATIONAL_LIFE', policyNumber)` — o sync **corrige as linhas existentes no
lugar**, sem duplicar e sem migração de dados.

`ExternalReference` fica de fora: seria redundante para apólice, e seu
`@@unique([provider, externalId])` é **global, não por agente** — usá-la para
cliente exigiria inventar um id sintético de portador. Não inventar identidade que
o carrier não deu.

### D6 — Identidade de cliente

`Client` não tem colunas de origem. O casamento é por
`(assignedAgentId, nome normalizado, dateOfBirth)`, nunca entre agentes.

Isso não é cosmético: **16 nomes no livro aparecem com datas de nascimento
diferentes** — casar só por nome fundiria pessoas distintas, e o agente veria a
apólice de um cliente na ficha de outro. A data de nascimento entra na chave
justamente por isso.

Para as apólices sem data de nascimento após a fusão dos recortes (~2%), casar por
nome dentro do agente e **marcar como baixa confiança**, sem nunca fundir com um
`Client` que já tenha data de nascimento divergente.

### D7 — Descartar as linhas de rodapé do export

Duas linhas chegam hoje com `policyStatus` valendo `Exported On: 08/17/2026` e
`Exported By: Novaes, Beatriz Moraes`: são o rodapé do XLSX sendo lido como dado.
Hoje é inofensivo porque ninguém lê a tabela; na ingestão viraria um `Client`
fantasma chamado "Exported By". O parser passa a exigir `Policy #` não-vazio.

## 3. Arquitetura

Um serviço novo, `lib/national-life/portfolio-ingest.ts`, com uma entrada:

```
ingestNationalLifePortfolio({ agentId }) → IngestReport
```

Roda ao final de um sync bem-sucedido, lendo o que já está em
`NationalLifeInforcePolicy` — **não** toca no portal. Isso o torna testável sem
browser e re-executável sem custo de rede.

Fluxo, por apólice:

1. **Reconciliar** os dois recortes numa visão única por `policyNumber` (D4),
   descartando rodapé (D7).
2. **Resolver o cliente**: achar ou criar `Client` por (D6).
3. **Upsert da apólice** em `('NATIONAL_LIFE', policyNumber)` (D5), com status
   mapeado e cru (D3), `faceAmount` intocado se ainda não conhecido (D1).
4. **Enfileirar** quem não tem `faceAmount` para o backfill (D2).

O backfill de detalhe é um estágio separado do connector
(`READ_POLICY_DETAIL`), que já tem o allowlist de path escrito e testado
(`policyDetailNavigatePath` / `isSafePolicyDetailPath`). O que falta nele:
resolvedor `policyNumber → id hex` e parser por produto (IUL vs Term).

### O que o serviço devolve

`IngestReport` traz `clientesCriados`, `clientesAtualizados`, `apolicesCriadas`,
`apolicesAtualizadas`, `semFaceAmount`, `baixaConfianca[]` e `descartadas[]`.
É isso que dá substrato para o UX do sync dizer *"2.180 clientes entraram na sua
carteira"* — frase hoje impossível.

## 4. Erros e reexecução

- **Idempotente por construção.** Rodar duas vezes seguidas não cria nada novo:
  as chaves de D5 e D6 são determinísticas.
- **Uma apólice ruim não derruba o lote.** Cada apólice é uma transação; falhas
  entram em `descartadas[]` com motivo e o lote segue.
- **Nunca apagar.** Uma apólice que sumiu do export não é deletada — o carrier
  pode ter mudado um filtro. Some do export ≠ deixou de existir.
- **Baixa confiança nunca funde.** Na dúvida entre dois `Client`, cria-se um novo
  e registra-se em `baixaConfianca[]`, porque fundir pessoas erradas é irreversível
  e visível para o agente; duplicar é reversível.

## 5. Testes

TDD, com os casos vindos dos dados reais medidos:

- reconciliação: prêmio do export + data de nascimento do grid na mesma apólice
- os 16 nomes com datas de nascimento divergentes viram clientes distintos
- rodapé do XLSX é descartado
- `Pending Lapse` vira `INFORCE` preservando o status cru
- reexecutar não duplica cliente nem apólice
- apólice sem `faceAmount` sai com `null`, nunca `0`
- apólice que sumiu do export continua existindo

## 6. Fora de escopo

- Parser de `policy-details` e resolvedor de id (é o projeto 3, `READ_POLICY_DETAIL`)
- UX do sync (projeto 2)
- Application/iGo (projeto 4, e trava numa decisão de produto sobre escrever no
  carrier)
- `Prospect`/`InsuranceCase`: a ingestão não os cria. `InsuranceCase.prospectId`
  é obrigatório, e inventar um prospect por apólice em vigor seria fabricar
  história comercial que não aconteceu.

## 7. Risco conhecido

O maior é D6. Fundir dois clientes distintos é irreversível e o agente vê. O
desenho erra deliberadamente para o lado de duplicar, e a lista `baixaConfianca[]`
existe para que a duplicação seja visível e corrigível em vez de silenciosa.
