# Consolidação da área AI

Tudo que é AI passa a viver sob `/agent/ai`. A central de mensagens, a tela de
próxima ação e a fila de agendadas deixam de ser endereços independentes e
viram filhos do hub que hoje o agente já conhece como "K-Bot AI".

Isto é mudança de endereço, não de produto. Nenhuma tela é redesenhada,
nenhuma funcionalidade nasce ou morre nesta etapa.

## Por que agora

O agente encontra "K-Bot AI" no menu, abre, e a tela fala de contatos,
créditos e ações com AI — mas a conversa acontece em outro endereço, que ela
só alcança voltando ao menu. O hub já aponta para `/agent/kbot` em cinco
lugares e abre conversas em `/agent/mensagens?conversation=…`: a relação
existe no código e não existe na barra de endereço.

## O que torna isso mais que um rename

Três amarras foram medidas antes do desenho.

**Notificação é dado, não link.** `lib/kbot-followup/worker.ts:241` grava
`href: '/agent/kbot'` na tabela `Notification`. Existem linhas escritas
apontando para lá, e agentes ainda vão abri-las.

**O Stripe guarda a URL.** `app/api/billing/followup-addon/checkout/route.ts:54`
define `success_url` e `cancel_url` como `/agent/kbot`. Sessões de Checkout já
criadas carregam esse endereço e não podem ser reescritas.

**O gate de módulos casa por caminho.** `lib/platform-modules.ts:166` mapeia
`/agent/mensagens` para o módulo `MESSAGES`. Se a rota anda e o mapa não, o
módulo deixa de barrar o que barrava.

A conclusão que orienta o resto: mover **e** manter os caminhos antigos
resolvendo, porque parte deles vive fora do nosso alcance.

## Endereços

| Hoje | Depois |
|---|---|
| `/agent/ai` | `/agent/ai` (inalterado) |
| `/agent/mensagens` | `/agent/ai/mensagens` |
| `/agent/kbot` | `/agent/ai/acoes` |
| `/agent/kbot/agendadas` | `/agent/ai/agendadas` |

As pastas `app/agent/mensagens/` e `app/agent/kbot/` movem-se para dentro de
`app/agent/ai/`. Os arquivos de API em `app/api/` não se movem: nenhuma URL de
API muda.

## Redirects

Os três caminhos antigos redirecionam com **308 permanente**, preservando a
query string. `?conversation=`, `?view=activities` e `?checkout=complete` são
carregados por links que já existem no mundo e precisam chegar ao destino.

Os redirects vão em `redirects()` do `next.config.ts`, não no `proxy.ts`.
Redirects do config rodam **antes** do middleware: a URL velha vira nova e só
então enfrenta autenticação e gate de módulo. Pôr isso no `proxy.ts` inverteria
a ordem e faria o gate decidir sobre um caminho que está de saída.

São permanentes, sem prazo de desligamento. Notificação gravada é registro
histórico e sessão do Stripe não se reescreve — um redirect custa nada e cobre
os dois para sempre.

## Gate de módulos

`/agent/mensagens` sai de `MODULE_ROUTES`; entra `/agent/ai/mensagens` →
`MESSAGES`. `/agent/ai` continua fora da lista, como hoje.

`getPlatformModuleForPath` usa `.find()`: **o primeiro match vence, não o
prefixo mais longo**. Se alguém inserir `/agent/ai` na lista acima de
`/agent/ai/mensagens`, o pai engole o filho e o gate de `MESSAGES` some sem
erro nem aviso. Um teste fixa essa ordem para que a quebra apareça como teste
vermelho, e não como acesso indevido em produção.

`/agent/ai/acoes` e `/agent/ai/agendadas` seguem sem módulo, como `/agent/kbot`
está hoje. Esta etapa não muda quem pode ver o quê.

## Hub e menu lateral

O hub passa a conter uma parte gated. Quando o módulo `MESSAGES` está
desligado, `/agent/ai` não mostra a seção da central nem oferece caminho para
ela — mostrar uma porta que o gate vai fechar é pior que não mostrar porta.

No menu lateral, "Mensagens" **permanece como entrada própria**, apontando para
`/agent/ai/mensagens` e mantendo `module: "MESSAGES"`. A central é uso diário;
consolidar o endereço não justifica custar um clique a mais todos os dias. A
consolidação acontece na URL e no hub, não na remoção do atalho.

A navegação não ganha nível aninhado: o componente hoje não tem, e introduzir
hierarquia no menu é outro trabalho.

## Links internos

Os 26 pontos que apontam para `/agent/kbot` e os 16 para `/agent/mensagens`
passam a apontar para os endereços novos, incluindo:

- `success_url`/`cancel_url` em `followup-addon/checkout/route.ts`;
- o `href` das notificações criadas **daqui para frente**, em `worker.ts`;
- `lib/kbot-followup/service.ts:139`, que devolve o href da conversa;
- `components/CarrierSyncBadge.tsx`, `components/Shell.tsx`,
  `components/onboarding/`, e o próprio `AiWorkspace.tsx`.

As linhas de `Notification` **já gravadas** ficam intocadas. Reescrevê-las
seria alterar histórico para obter o que o redirect já entrega, e ainda assim
não alcançaria as sessões que o Stripe já criou.

## Testes

- Um teste por caminho antigo provando o 308 e a query string preservada.
- Um teste de gate: `/agent/ai/mensagens` exige `MESSAGES`; `/agent/ai` não exige.
- Um teste de ordem em `MODULE_ROUTES`, para o `.find()` não ser quebrado depois.
- Um teste de navegação no padrão de `page.navigation.test.ts`, que já existe e
  já cobre a ideia de "esta tela leva à central".
- Um teste do hub com `MESSAGES` desligado, provando que não há porta para a
  central.
- Os testes atuais de `Shell`, `mensagens` e `kbot` acompanham os caminhos novos.

## Fora de escopo

Redesenhar o hub, fundir as três telas numa só, mexer no conteúdo da central,
introduzir menu aninhado, ou alterar quem pode ver o quê.
