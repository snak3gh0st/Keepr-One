# Central de mensagens — as mensagens do K-Bot onde o agente já fala com o cliente

Data: 2026-09-12
Status: desenho aprovado, aguardando revisão antes do plano de implementação

## O problema, em uma frase

A fila de mensagens que a IA escreve mora em `/agent/kbot/agendadas`, uma rota que o
agente não abre; a área onde ele fala com clientes é `/agent/mensagens`. Mensagem
escrita pelo K-Bot e resposta do cliente são a mesma conversa, e hoje estão em duas
casas — o que obriga o agente a saber de qual lado do app está o assunto.

## O que muda

A área de **Mensagens** passa a ser a central: os contatos dele, as conversas que
existem, e a fila do K-Bot esperando *Enviar* ou *Descartar*. `K-Bot AI` segue sendo
o que o próprio cabeçalho dele diz — *"o que fez, o que consumiu, o que vem agora"* —
centro de controle, não caixa de entrada.

## Decisões tomadas

### 1. O lugar — dentro de Mensagens (decisão do dono do produto)

Descartado: pôr a fila em `K-Bot AI` (era a minha proposta). O argumento que a
derrubou: mensagem do K-Bot continua sendo mensagem para cliente, e duas caixas de
entrada para a mesma conversa é trabalho de tradução que o agente não deveria fazer.

### 2. O que a área lista — "todas as mensagens e contatos" (decisão do dono do produto)

Não só as conversas que chegaram. A lista nasce do **book do agente**
(`Client.assignedAgentId`), unida às conversas existentes do Chatwoot.

Números de produção que o desenho tem de encarar: um agente com book tem **17.733
contatos, dos quais 4.184 têm telefone**. Três quartos da base não é alcançável por
WhatsApp, e a tela precisa dizer isso em vez de deixar o agente clicar num contato
que não tem como receber.

### 3. O interruptor por pessoa — padrão desligado (decisão do dono do produto)

Cada contato tem um menu para ligar ou não o K-Bot. **Padrão desligado.**

Registro a recomendação contrária que fiz e que não prevaleceu: com padrão desligado
e 17 mil contatos, a fila nasce vazia, e a decisão aprovada na Fase 1 era o oposto
("o agente abre e encontra mensagens já escritas"). O risco assumido é o agente abrir,
não entender que precisa ligar alguém, e concluir que o K-Bot não faz nada.

### 4. Como o padrão desligado deixa de ser trabalho infinito (decisão delegada a mim)

Duas peças, escolhidas para preservar a regra do dono do produto sem cobrar 17 mil
cliques:

- **Uma ação em massa, no topo da lista:** "Ligar o K-Bot para todos os meus
  clientes", com a contagem de quem tem telefone. Continua sendo ato explícito do
  agente — apenas um, em vez de milhares.
- **A chegada mostra o valor antes da decisão:** com nada ligado, a lista vem
  acompanhada de um exemplo real ("Ana Souza, aniversário em 18/09 — ficaria assim:
  …"). É o espírito da Fase 1 sem furar o padrão desligado: nada existe para enviar,
  mas o agente vê o que existiria.

## Invariantes

Nenhuma é negociável.

- **Os dois "nãos" são distintos.** O *não do agente* ("não quero que o K-Bot cuide
  desta pessoa") é reversível por ele. O *não do cliente* ("não quero receber")
  **sempre vence** — inclusive quando o agente liga depois, e inclusive na ação em
  massa. Um pedido de parada do cliente nunca é desfeito por um clique do agente.
- **Habilitação é campo novo, não inversão do existente.** `KBotContactPreference.optedOut`
  significa hoje *opt-out*, e ausência de linha quer dizer *permitido*. Padrão
  desligado inverte esse sentido. Inverter o campo mudaria em silêncio o significado
  de linhas já gravadas; entra um campo de habilitação cuja **ausência é desligado**,
  e `optedOut` permanece sendo o pedido do cliente.
- **A trava de envio continua única.** Todo envio segue passando por
  `evaluateSendGate` (`lib/kbot-messaging/send-gate.ts`): opt-out, snooze, janela de
  recência compartilhada e quiet hours. O interruptor novo é mais uma condição no
  gate, nunca um caminho paralelo.
- **Contato sem telefone não é oferecido.** A lista mostra o contato e diz por que ele
  não pode receber, em vez de aceitar um clique que vai falhar.

## Arquitetura

```
/agent/mensagens
├── Contatos (book do agente)         Client.assignedAgentId
│   ├── interruptor do K-Bot          KBotContactPreference (campo novo)
│   ├── "sem telefone" quando é o caso
│   └── ação em massa no topo
├── Fila do K-Bot                     ApprovalQueue (já existe)
│   └── Enviar / Descartar            approveScheduledProposals / discardScheduledProposals
└── Conversas                         Chatwoot (já existe)
```

O que é reaproveitado sem alteração: `ApprovalQueue`, as server actions de aprovar e
descartar, o cliente de conversas do Chatwoot, e o gate de envio. O que é novo: a
lista de contatos com o interruptor, a ação em massa, e o campo de habilitação.

`/agent/kbot/agendadas` fica sendo **só a configuração** (Modelos, Envios,
Consentimento), alcançável por um link discreto — a fila sai de lá.

## Riscos assumidos

- **A fila nasce vazia.** Consequência direta da decisão 3, mitigada pela 4. Se a
  telemetria mostrar agentes abrindo e não ligando ninguém, a decisão 3 é o primeiro
  lugar a revisitar.
- **17 mil contatos numa lista** pede paginação e busca desde o primeiro dia; uma
  lista que trava é pior que uma lista ausente.
- **A ação em massa é irreversível na percepção do agente** ("liguei para todos") —
  precisa dizer, antes de confirmar, quantas pessoas passam a poder receber e que
  ninguém que pediu para parar será incluída.

## Fora de escopo

- As duas ofertas da Fase 1 — "edição vira modelo" e "cinco aprovações seguidas
  oferecem o automático".
- Editar o texto antes de enviar (hoje a fila tem Enviar e Descartar).
- Começar conversa a partir de um contato que ainda não escreveu — é o que o
  Alessandro pediu, e merece desenho próprio.
