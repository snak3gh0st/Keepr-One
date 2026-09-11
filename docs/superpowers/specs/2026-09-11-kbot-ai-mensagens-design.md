# K-Bot AI — mensagens que já chegam prontas

Data: 2026-09-11
Status: desenho aprovado, aguardando revisão antes do plano de implementação

## O problema, em uma frase

Hoje um agente sem `KBotMessageTemplate` cadastrado **não recebe mensagem nenhuma**.
Zero. A tela exige que ele entenda "categoria", "idioma" e "modelo" antes de qualquer
valor existir, e a decisão de negócio por trás disso está escrita no `.env.example`:
"não existe texto padrão da casa".

O pedido do dono do produto foi literal: *"quero extremo UX, deixando o usuário
entender que o app é por ele e não ele tem que entender o app"*. A barreira acima é
exatamente o oposto disso.

## O que muda

O K-Bot passa a escrever. O agente passa a **decidir**, nunca a configurar.

## Decisões tomadas

Cada uma foi escolhida pelo dono do produto entre alternativas apresentadas.

### 1. Até onde a IA escreve — "IA escreve o modelo, agente aprova uma vez"

O modelo escreve o texto; o agente lê antes de qualquer coisa chegar a um cliente.
Nunca existe texto de modelo indo para um cliente sem ter passado pelos olhos do
agente — antes da promoção, mensagem por mensagem; depois da promoção, pelo modelo
que ele aprovou explicitamente.

Alternativas descartadas: IA escrevendo cada mensagem ao vivo para sempre (mantém o
risco de afirmação factual inventada sobre apólice/pagamento); IA só escolhendo tom
entre enums (é o que já existe, e não se parece com IA nenhuma para o agente).

### 2. A chegada — fila de mensagens reais

O agente abre K-Bot AI e encontra **mensagens já escritas para clientes reais**,
esperando "Enviar" ou "Descartar". Configuração é um link discreto no rodapé
("Ajustar o que o K-Bot prepara"). O valor aparece antes de qualquer ajuste.

### 3. A fila vazia — a semana à frente, e os resultados abaixo

Quando não há nada para liberar hoje:

- **Acima:** o que vem nos próximos sete dias, com a mensagem já escrita ("Ana,
  quinta, aniversário — mensagem já escrita"). Ele vê o K-Bot trabalhando mesmo sem
  decisão pendente, e pode adiantar.
- **Abaixo, só quando houver história:** o que já rendeu (mensagens enviadas no mês,
  respostas, apólices que voltaram a ficar em dia). Fica oculto enquanto os números
  forem zero — na estreia, zero é pior que ausência.

### 4. A promoção — emerge do uso, nunca é pedida

Duas ofertas, cada uma disparada por evidência do comportamento do próprio agente:

- **Edição vira modelo.** Quando ele edita o texto antes de enviar, o K-Bot pergunta
  "gostei do seu jeito, escrevo assim daqui pra frente?" com as opções *Sim* e *Só
  desta vez*. Um "sim" grava a edição como `KBotMessageTemplate` da categoria e do
  idioma. É aqui que "aprova uma vez" acontece — sem tela de configuração.
- **Cinco aprovações seguidas sem edição oferecem o automático.** "Você aprovou as 5
  últimas sem mudar nada. Paro de perguntar no aniversário?" A oferta mostra o texto
  exato que passará a sair, e esse texto vira o modelo aprovado.

Se ele edita sempre, a segunda oferta nunca aparece. O K-Bot não insiste.

## Invariantes preservadas

Nenhuma destas é negociável, e todas já existem no código:

- **Trava de envio única.** Todo envio continua passando por `evaluateSendGate`
  (`lib/kbot-messaging/send-gate.ts`). Opt-out, snooze, janela de recência
  compartilhada e quiet hours seguem valendo. Existem hoje exatamente dois
  `transport.send()` de saída e ambos passam pelo gate; isso não muda.
- **Consentimento acima do clique.** Pedido de parada continua gravado no log com as
  palavras usadas, e continua barrando enfileiramento.
- **Automático é escolha explícita.** A confirmação atual de "enviar sozinho" —
  *"vão para o cliente sem passar por você"* — permanece palavra por palavra.
- **Contabilidade de tokens.** Geração continua medida e cobrada como hoje; um
  timeout continua sendo cobrado como tentativa (`ASSUMED_ATTEMPT_TOKENS`).

## O que este desenho muda de proposital, e o risco que assume

**A IA passa a escrever texto livre para `ANNUAL_REVIEW` e `LAPSE_RECOVERY`.** Hoje
só o aniversário tem essa licença (`birthday-generation.ts`), e `generation.ts`
proíbe o modelo de afirmar coisas sobre apólice ou pagamento — a frase factual vem da
tabela fixa `reasonCopy`.

Lapso e revisão anual **são** assuntos de apólice. Estender a escrita livre a eles
troca uma garantia de código por uma garantia humana: o agente lê antes. Essa troca é
deliberada e é o que torna o produto pedido possível, mas precisa de três anteparos:

1. Um validador de voz por categoria, no modelo de `checkBirthdayVoice`, recusando
   número, data, valor, link e qualquer afirmação sobre situação da apólice.
2. Texto recusado cai no modelo do agente, como o aniversário já faz — o pior caso é
   uma mensagem menos variada, nunca uma inventada.
3. Depois da promoção, o que sai é o **modelo aprovado com o nome do cliente**, não
   geração nova. Automático nunca significa "modelo escrevendo sem ninguém ver".

## O que precisa ser construído

Em ordem de dependência, e proposto como entregas separadas.

### Fase 1 — a fila existir sem configuração

- Categorias nascem **ligadas em "eu leio antes"**, não desligadas. Vale para o
  default de quem chega agora. **Não vale para quem já desligou**: um agente que
  tomou a decisão de desativar uma categoria não pode encontrá-la ligada de volta
  depois de um deploy. A migration liga apenas o que nunca foi decidido — linha
  ausente, não linha com `enabled = false`.
- Remover a exigência de `KBotMessageTemplate` para enfileirar: sem modelo, a IA
  escreve. Com modelo, o modelo vence.
- Geração de texto para `ANNUAL_REVIEW` e `LAPSE_RECOVERY`, com validador de voz por
  categoria e queda para o modelo do agente.

### Fase 2 — a tela

- Seção de mensagens dentro de `/agent/ai`, server-rendered ao lado do `AiWorkspace`
  atual, reaproveitando as cinco server actions existentes sem tocá-las.
- `/agent/kbot/agendadas` passa a `redirect('/agent/ai#mensagens')`. Só um link aponta
  para lá (`app/agent/kbot/page.tsx:20`).
- Fila no topo; semana à frente quando a fila estiver vazia; resultados abaixo quando
  houver história; ajustes no rodapé.
- No rodapé, o controle por categoria deixa de ser dois botões aninhados e vira uma
  escada de três posições: *Desligado* / *Eu leio antes* / *Enviar sozinho*. As duas
  booleanas do banco não mudam; só a apresentação.

### Fase 3 — a promoção

- Edição de mensagem oferece virar modelo.
- Contador de aprovações consecutivas sem edição, por agente e categoria; na quinta,
  oferece o automático mostrando o texto que passará a sair.

## Fora de escopo, decidido à parte

- **Skeleton da barra lateral.** A correção certa é tirar `<Shell>` das 42 páginas e
  subir para `app/agent/layout.tsx`; a barata (tirar a lateral do `loading.tsx`) troca
  piscar por sumir. PR próprio, decisão pendente do dono.
- **"Achar alguém para falar"** (gatilho de cliente há muito tempo sem contato) foi
  apresentado e adiado: exige categoria nova no motor.

## Questões abertas

- Quantos dias de antecedência a semana à frente mostra: sete foi o número usado no
  mockup aprovado, mas não foi validado contra volume real de um livro grande.
- Se a oferta de automático deve existir para `LAPSE_RECOVERY`, ou se lapso deve
  sempre esperar o agente por ser conversa financeira.
