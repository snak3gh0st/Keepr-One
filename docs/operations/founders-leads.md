# Captação de leads Founders

`/founders` recebe somente nome, e-mail e telefone dos Estados Unidos. O CTA
é **QUERO SER FOUNDER**. Um envio persistido redireciona para
`/founders/obrigado`, que anuncia a liberação futura do acesso com 30 dias grátis.

Os contatos entram no módulo administrativo de [Marketing](marketing.md), em
`/admin/marketing`. O modelo Prisma é `MarketingLead`, mapeado para a tabela física
original `FounderLead`, separado de `User`, `Agent` e `FounderEnrollment`. A
inscrição não cria uma conta e não inicia um trial.

E-mails são normalizados em minúsculas e únicos. Reenvios retornam sucesso sem
sobrescrever o contato, sua campanha/UTMs do primeiro cadastro ou o acompanhamento
feito pela equipe. Telefones são validados como US usando
`libphonenumber-js/max` e salvos em E.164 (`+1…`).

O programa padrão de captação é `founders-program` (slug `founders`). Links podem
usar `marketing_campaign` com o slug de outra campanha e os parâmetros
`utm_source`, `utm_medium`, `utm_campaign`, `utm_content` e `utm_term`. A campanha
e os metadados são capturados por campos ocultos; o usuário continua preenchendo
somente os três campos de contato. Campanha inexistente ou ausente usa o programa
padrão. Ver regras de primeiro cadastro e atribuição em [marketing.md](marketing.md).

## Configuração e publicação

O histórico inclui `20260910090000_add_founder_leads` e, para a integração com
Marketing, `20260911010000_add_marketing_workspace`. A segunda migration preserva
a tabela original e atribui todos os registros históricos ao Programa Founders.
Ela precisa estar aplicada antes de servir o novo código que usa as colunas de
Marketing. Na entrega atual, essa integração foi aplicada e validada somente no
banco local; ainda não houve publicação em produção.

No fluxo normal de deploy no ambiente de destino:

```sh
pnpm install --frozen-lockfile
pnpm exec prisma generate
pnpm exec prisma migrate deploy
```

O convite padrão do grupo é
`https://chat.whatsapp.com/J6zgR1GL9VaFVq77OzNcCi?s=cl&p=i&mlu=4`.
Na página de agradecimento, o botão abre esse convite e há redirecionamento
automático para o mesmo endereço após 30 segundos.

Para substituir o convite, definir `FOUNDERS_WHATSAPP_GROUP_URL` com outro convite
HTTPS de `chat.whatsapp.com`. A configuração é lida no servidor em tempo de
execução. A ausência da variável usa o convite padrão; um valor explicitamente
vazio ou inválido desabilita o botão e o redirecionamento, com a mensagem de que
o link será disponibilizado em breve.

As configurações `FOUNDERS_ACCESS_CODE(S)` pertencem ao onboarding anterior e não
controlam a nova captação. O antigo mecanismo de criação de contas e os acessos
Founder existentes permanecem separados. Nenhum e-mail ou WhatsApp é enviado
automaticamente por este formulário; a comunicação da liberação é uma etapa posterior.

## Direção desta superfície

Modo: Persuade. O objetivo é cadastrar o contato e apresentar o próximo passo.
As duas páginas compartilham `founders.module.css`, limitado a essas superfícies:
fundo verde quase preto, ação verde claro, tipografia Outfit já instalada no app,
marca Keepr One e geometria orbital com suporte a movimento reduzido. Os estilos
operacionais do restante do app, definidos em `DESIGN.md`, não são alterados.

O refinamento com `gpt-taste` mantém a composição e os três campos. Acrescenta
iluminação ambiental discreta, foco e hover nos controles e entrada com GSAP.
`FoundersMotion` limita efeitos de scroll à geometria decorativa no desktop,
respeita `prefers-reduced-motion` e limpa as animações na troca de rota. O
formulário permanece no fluxo normal, e o conteúdo é visível antes do JavaScript.

O agradecimento exibe `FounderDashboardPreview`, uma representação ilustrativa
do dashboard atual de `/agent`: carteira, prioridades Pending Lapse/Lapsed/Canceled,
menu com Agenda e K-Bot AI, resumo operacional e o desenho compartilhado do K-Bot.
A prévia usa dados fictícios explicitamente identificados, não consulta APIs nem
mostra contatos reais. A ilustração orbital permanece somente na página de cadastro.

## Verificação

```sh
pnpm exec vitest run lib/founder-lead-validation.test.ts app/founders/lead-actions.test.ts lib/founder-community-config.test.ts app/founders/actions.test.ts
pnpm exec tsc --noEmit
```

No navegador, verificar campos vazios, número não US, envio válido, persistência
do contato em `/admin/marketing`, atribuição da campanha e navegação ao agradecimento.
Reenviar o mesmo e-mail com outra campanha deve preservar o primeiro cadastro.
Confirmar o destino do botão do WhatsApp
e o redirecionamento automático após 30 segundos. Dados pessoais não vão na URL.
