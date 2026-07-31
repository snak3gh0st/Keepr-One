# iGo e-App: o que seria preciso para propor pelo app

Estado: **estudo**. Nada foi submetido, nada foi automatizado. Este documento
existe para que a decisão de fazer — ou não fazer — seja tomada com o custo real
à vista.

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

## Os três bloqueios, em ordem

**1. A sessão Auth0 tem que sobreviver.** Medido em 2026-07-31: o portal
respondia autenticado enquanto o salto SSO caía no muro de login do Auth0, 12 h
após o login. O iGo depende da mesma sessão a jusante — e ainda por cima de uma
federação adicional para o iPipeline. Sem isso resolvido, sondar o iGo mede tela
de login e conclui errado, como já aconteceu duas vezes com o Foresight. Ver
`docs/operations/national-life-portal-contract.md`.

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

Depois do próximo login do carrier, com a sessão fresca:

```
docker exec keeprone-national-life-national-life-runtime-1 \
  npx tsx scripts/national-life-probe-foresight-session.ts /agent/sso/igo-eapp
```

Ler `foresight.landedOn`, `hops` e `blockedOrigins`. Isso transforma "termina em
federate.ipipeline.com" — uma observação de uma tentativa que falhou — em um mapa
de onde o iGo realmente começa.
