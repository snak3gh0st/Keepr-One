# iGo e-App: o que seria preciso para propor pelo app

Estado: **estudo**. Nada foi submetido, nada foi automatizado. Este documento
existe para que a decisão de fazer — ou não fazer — seja tomada com o custo real
à vista.

Revisto em 2026-07-31 depois de mapear o Foresight: o iGo continua sendo
terceiro, mas **provavelmente não precisa do salto SSO próprio** — a ferramenta
de ilustração tem seu próprio lançador de e-App. Ver a seção logo abaixo; o que
muda é o transporte, e o que continua caro é o mapa de campos.

## O que o iGo é, e por que ele não é o Foresight

`/agent/sso/igo-eapp` é um dos cinco saltos SSO do portal. Medido em 2026-07-30
(`scripts/national-life-describe-sso-targets.ts`): salta por
`nlg-prod.auth0.com` e **termina em `federate.ipipeline.com`**.

A diferença que decide tudo:

| | Foresight (ilustração) | iGo (proposta) |
| --- | --- | --- |
| dono | National Life, **mesma origem** do portal | **iPipeline**, terceiro de verdade |
| natureza | leitura — gera um PDF | **escrita** — submete proposta em nome do agente |
| allowlist | já coberta | precisou de `federate.ipipeline.com` |
| erro possível | nenhuma ilustração | **um documento vinculante na conta do agente** |

Tudo que foi construído até hoje na integração National Life é leitura: sondar,
extrair, cotar. O iGo é a primeira coisa que **escreve contra a conta do
agente**, e isso muda a classe de risco, não o tamanho da tarefa.

## Existe um segundo caminho, por dentro do Foresight (2026-07-31)

Mapear os bundles do Foresight para o PDF trouxe três sinais de e-App que este
documento não conhecia quando foi escrito:

| sinal | onde | o que diz |
| --- | --- | --- |
| `WidgetService.asmx/GetEAppStatus` | chamado na **abertura** da `StartPage` | o Foresight acompanha o estado da proposta de cada caso |
| `PageService.asmx/SetupEAppLauncher` | `ForeSight.Controls.EApp.submitEApp` | a ferramenta tem um botão próprio que lança a proposta |
| `/agent/RapidSolve/EAppSsoRedirect` | botão `#continue_to_eapp` do Rapid Solve | a cotação também sabe empurrar para a proposta |

O que isso **não** derruba: a medição de 2026-07-30 continua valendo — o salto
`/agent/sso/igo-eapp` termina em `federate.ipipeline.com`, e o iGo é de fato da
iPipeline. A tabela acima não é terceiro, mas isso não faz o iGo deixar de ser.

O que isso muda: provavelmente **não é preciso construir o salto SSO separado**.
Se o agente lança a proposta de dentro do Foresight — uma ferramenta que a
sessão do portal já alcança, e que o job de PDF já sabe dirigir — o caminho
ilustração → proposta usa transporte que já existe.

⚠️ Cuidado com a palavra `Launcher`. Ela sugere **entrega**, não substituição:
o mais provável é que `SetupEAppLauncher` prepare a sessão e mande o navegador
para a iPipeline mesmo assim, só que sem passar pelo `/agent/sso/igo-eapp`. Se
for isso, o que se economiza é o **transporte**, não o **mapa de campos** — o
item 3 da lista abaixo, que é o trabalho grande, continua inteiro. Nada disso
foi medido: onde `SetupEAppLauncher` cai é indício lido de bundle, não
observação.

### O detalhe que é de risco, não de arquitetura

```js
// ForeSight.Controls.EApp.submitEApp
sendGetRequest("PageService.asmx/SetupEAppLauncher", [$ITCommon.sessionTokenId()])
```

**Só o `sessionTokenId`.** Igual a `IllustrateCase` e a todo o contrato de
relatório: o caso corrente mora na sessão do servidor. Então esta chamada
lança a proposta **do que estiver aberto naquele instante** — é um caminho de
escrita sem alvo explícito no argumento.

Para leitura isso foi conveniência; para escrita é a diferença entre propor o
caso certo e propor o caso que sobrou aberto de um job anterior. Se um dia isto
for automatizado, o alvo não pode vir da sessão: tem que ser afirmado e
reconferido na página antes de chamar. É a mesma fronteira do item 4 abaixo,
agora com um mecanismo concreto para errar.

## Os três bloqueios, em ordem

**1. A sessão Auth0 tem que sobreviver.** ~~Medido em 2026-07-31: o portal
respondia autenticado enquanto o salto SSO caía no muro de login do Auth0, 12 h
após o login.~~ **Resolvido, e a causa era outra:** o keep-alive que cruzava o
`/authorize` a cada 10 min é que matava a sessão em ~7 min. Com
`NATIONAL_LIFE_KEEP_ALIVE_SSO_JUMP` desligado ela vive; o job de PDF cruza uma
vez, faz o que precisa, persiste o contexto e sai. O e-App pode usar o mesmo
desenho. Fica a ressalva de que a federação iPipeline é um salto **a mais**, e
esse nunca foi atravessado. Ver `docs/operations/national-life-portal-contract.md`.

**2. A allowlist precisou crescer.** `NATIONAL_LIFE_PORTAL_ORIGINS` agora inclui
`federate.ipipeline.com`. Isso permite **medir** o salto; não autoriza submeter
nada. E provavelmente não é suficiente: `federate` é o ponto de federação, e o
app real do iGo tende a viver em outro host do mesmo fornecedor. A sonda reporta
`blockedOrigins` justamente para que a próxima origem apareça como dado em vez
de virar chute — expandir de novo é decisão consciente, uma origem por vez.

**3. Escrever exige portões que a leitura não exigiu.** Nada disso existe hoje.

## O que o app precisaria ter

Em ordem de dependência, não de esforço:

1. **Sessão viva de ponta a ponta** — portal + Auth0 + federação iPipeline.
   Hoje só o portal se mantém. É o pré-requisito de tudo.
2. **Sonda do iGo** — já dá para rodar sem código novo:
   `tsx scripts/national-life-probe-foresight-session.ts /agent/sso/igo-eapp`.
   Diz, num único minuto, se o portal está vivo, onde o salto cai, e qual origem
   foi bloqueada. **Só faz sentido depois de um login fresco.**
3. **Mapa do contrato** — quais campos o iGo exige, quais são obrigatórios por
   estado, o que é rascunho e o que é submissão final. É o mesmo trabalho que o
   Rapid Solve deu, provavelmente maior: proposta tem dezenas de campos e
   validação por jurisdição.
4. **Rascunho reversível antes de qualquer submissão.** A fronteira que importa
   não é técnica: é entre "preencheu" e "submeteu". O app deve poder montar a
   proposta inteira e parar.
5. **Confirmação humana explícita no ato de submeter**, com o que será enviado
   à vista. Um cron não submete proposta. Isso não é preferência de UX — é o que
   separa erro de automação de erro de pessoa, e a assinatura é do agente.
6. **Trilha de auditoria**: quem submeteu, quando, com qual payload, e o que o
   iGo respondeu. Hoje `rawPayload` já guarda os dois lados de uma cotação; a
   proposta precisa do mesmo, com retenção pensada — o payload tem dados
   pessoais de saúde, não só um prêmio.
7. **Idempotência**. Um retry de worker que reenvia uma proposta cria duas.
   `Illustration` já resolveu isso com `provider_externalId` no id do job; a
   proposta precisa de garantia equivalente, e mais forte.

## O que é decisão sua, não minha

- **Automatizar submissão, ou parar no rascunho?** Um app que monta a proposta e
  entrega pronta para o agente revisar e enviar no iGo captura quase todo o
  ganho com uma fração do risco. Recomendo começar por aí.
- **Termos do fornecedor.** O iPipeline é terceiro; dirigir a interface dele por
  automação pode esbarrar em contrato — a mesma família de questão que o
  "verbal quote only" do Rapid Solve trouxe. Isso se lê, não se mede.
- **Dados de saúde.** Proposta carrega informação clínica. Onde ela é gravada,
  por quanto tempo e quem lê é decisão de produto e de compliance.
- **Expandir a allowlist de novo** quando a sonda apontar a próxima origem.

## Próximo passo concreto

Mudou de ordem por causa do achado acima. O mais barato agora **não** é sondar o
salto SSO: é ler estaticamente o que já está no navegador.

**1. Ler `ForeSight.Controls.EApp` inteiro** — a classe que contém `submitEApp`.
GET de asset estático, mesma técnica que produziu o contrato do PDF sem submeter
nada (`scripts/national-life-describe-foresight-services.ts`). O que se procura é
o que acontece **depois** do `SetupEAppLauncher` retornar: se o código abre uma
URL, ela diz para onde o e-App vai — iPipeline ou casa — sem que nada seja
chamado. Isso responde "economiza uma integração inteira?" com leitura.

**2. Só então, e só com decisão sua:** chamar `SetupEAppLauncher` uma vez com um
caso de teste corrente. Isso é **escrita** — o nome sugere que prepara uma
proposta do lado de lá, e uma proposta preparada pode ficar registrada na conta
do agente. Não fazer isso "para ver".

**3. A sonda do salto SSO** (`scripts/national-life-probe-foresight-session.ts
/agent/sso/igo-eapp`) continua válida, mas passa a ser confirmação, não
descoberta: se o passo 1 mostrar que o Foresight leva à mesma origem que o salto,
a sonda serve para confirmar que são o mesmo destino — e aí o salto separado
pode ser descartado como caminho.
