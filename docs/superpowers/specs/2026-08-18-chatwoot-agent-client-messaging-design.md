# Conversa do agente com os clientes dele — Chatwoot embutido

Data: 2026-08-18
Estado: desenho, aguardando revisão. Nada implementado.

## 1. O que se quer, e por que agora

O agente de seguro de vida conversa com os clientes dele no WhatsApp, fora do
Keepr One. Isso deixa a conversa sem o contexto que o produto tem — e deixa o
produto sem saber o que aconteceu na conversa.

O sync fechou hoje com dado que só vale se virar conversa:

| gatilho | volume medido | conversa que ele pede |
| --- | --- | --- |
| `Pending Lapse` | **79** | falar antes de cair — dinheiro recuperável |
| `Lapsed` | **1.735** | resgate |
| aniversário | **9.614** com data de nascimento | relacionamento |

## 2. Decisões

### D1 — Canal: WhatsApp, com os dois caminhos, QR primeiro

O agente escolhe, em linguagem de resultado, nunca técnica:

- **"Seu número continua no seu celular"** → QR (WhatsApp Web não-oficial)
- **"Conexão certificada pela Meta, mas o número sai do app"** → Cloud API oficial

O QR sai primeiro. Não por ser mais fácil de construir — o Chatwoot já abstrai
canal, então o segundo custa pouco — mas porque **é o único que nasce com dado**.

Medido: só **838 dos 9.768** registros do livro têm telefone. Com Cloud API a
caixa nasce vazia e depende de enriquecer contato antes. Com QR, o WhatsApp do
agente já traz as conversas e os contatos dele. O canal resolve o problema que
eu ia ter que resolver antes dele.

**O risco do QR é real e cai sobre o agente, não sobre o Keepr One.** Conectar
por WhatsApp Web não-oficial viola o Termo de Uso, e a Meta bane número por isso.
Para um agente de vida, aquele número é a carteira de contatos inteira. A tela de
ativação diz isso em português claro antes do QR aparecer. Quem assume o risco
precisa saber que está assumindo.

### D2 — Interface: a do Chatwoot, embutida

O agente entra pelo Keepr One, sem segundo login, e vê o dashboard do Chatwoot.
Não construímos caixa de entrada.

Escrever thread, anexo, busca, não-lido, presença e atribuição é mês de trabalho
para reproduzir o que já existe pronto — e passa a ser nosso bug quando quebrar.
O custo aceito é estético: visualmente é outro app dentro do seu.

O contexto de carteira entra por **Dashboard App**, recurso nativo: um iframe
nosso na lateral da conversa, recebendo contato e conversa por `postMessage`,
mostrando apólice, status e alerta de lapso daquele cliente.

### D3 — Isolamento: uma conta Chatwoot por agente

Agentes são independentes e não podem ver cliente um do outro.

O Chatwoot permite restringir agente por inbox dentro de uma conta, mas isso é
**configuração** — e configuração errada vaza carteira de cliente entre
concorrentes. Conta por agente torna o vazamento estruturalmente impossível em
vez de proceduralmente improvável.

Custo: mais objetos para operar. Mitigado porque a Platform API cria conta,
usuário e vínculo por chamada, no onboarding.

### D4 — Provisionamento invisível

O agente vê um botão "Conectar meu WhatsApp". Atrás dele:

1. cria conta e usuário no Chatwoot (Platform API)
2. cria a instância do provedor de QR e liga na inbox da conta
3. devolve o QR na tela do Keepr One
4. ao escanear, a conversa começa a fluir

Nenhuma menção a Chatwoot, Meta, API ou instância na interface. O agente é
não-técnico e exigência técnica no fluxo dele é defeito, não instrução.

## 3. Arquitetura

Três peças, duas delas de prateleira:

```
Keepr One  ──SSO──▶  Chatwoot (UI, conversas, contatos, webhooks)
    │                     ▲
    │                     │ inbox tipo API
    │              Provedor de QR (sessão WhatsApp Web por agente)
    │
    └──Dashboard App──▶  painel de apólice dentro da conversa
```

- **Chatwoot** é o produto de conversa: UI, armazenamento, anexos, atribuição, e
  a abstração de canal que faz QR e Cloud API chegarem como a mesma conversa.
- **Provedor de QR** mantém a sessão WhatsApp Web de cada agente e faz a ponte
  para a inbox.
- **Keepr One** provisiona, faz SSO e serve o painel de contexto.

O vínculo entre os dois mundos é `Client.id` ↔ contato do Chatwoot. O painel
consulta por telefone normalizado e cai para busca por nome quando não houver.

## 4. Realidade de capacidade — restrição, não rodapé

Servidor hoje: 4 vCPU, **5 GB de RAM livre**, 50 GB de disco, 11 containers.

Chatwoot é Rails + Sidekiq, com Postgres e Redis próprios; o provedor de QR
mantém **uma sessão WhatsApp Web viva por agente**, e sessão viva custa memória
continuamente, não por pico.

**Isso comporta um piloto de poucos agentes. Não comporta a frota.** Antes de
abrir para 100 agentes, o provedor de QR precisa sair para máquina própria, e
provavelmente o Chatwoot também. Dimensionar isso é trabalho separado, e é
melhor descobrir agora do que quando o primeiro agente reclamar de lentidão.

## 5. Riscos

1. **Banimento do número do agente** (D1). O maior, e o único cujo dano é do
   usuário. Mitigação é informação, não técnica: aviso explícito antes do QR.
2. **Vazamento entre agentes.** Endereçado estruturalmente por D3.
3. **Queda de sessão do QR.** WhatsApp Web derruba; o agente precisa reescanear.
   O produto tem que detectar e pedir de novo com clareza, não falhar em
   silêncio — o mesmo erro que fez o login do carrier parecer quebrado hoje.
4. **Licença.** Chatwoot é AGPL. Rodar sem modificar, ao lado do produto, é
   tranquilo; modificar e oferecer como serviço cria obrigação de abrir a
   modificação. Não modificar o Chatwoot.

## 6. Fora de escopo

- Disparo automático em cima de `Pending Lapse` e aniversário. O canal primeiro,
  a automação depois — e automação de mensagem para cliente final em seguro tem
  peso regulatório que não é decisão de engenharia.
- Enriquecimento de contato (Clay/Lusha). D1 tornou desnecessário para começar.
- Cloud API oficial. Entra depois do QR provar demanda, sem reescrita.
- Campanha em massa. Isso é Listmonk/Resend, não Chatwoot.

## 7. Testes

- provisionamento é idempotente: reconectar não cria segunda conta
- agente A não enxerga conversa de agente B, testado por chamada direta à API
- painel de contexto resolve cliente por telefone e cai para nome sem quebrar
- painel não vaza apólice de outro agente quando o telefone bate por acaso
- queda de sessão do QR aparece como estado explícito, não como silêncio

---

## 8. Multicanal: e-mail, Instagram e os outros

Verificado no código-fonte do Chatwoot (`app/models/channel/`), não em
documentação: **12 tipos de canal nativos.**

`whatsapp` · `email` · `instagram` · `facebook_page` · `telegram` · `sms` ·
`twilio_sms` · `line` · `tiktok` · `twitter_profile` · `web_widget` · `api`

Para o agente que usa Gmail, o caso é o melhor possível: `channel_email` tem
campo `provider` com valores `google` e `microsoft`, e o repositório traz
serviços de renovação de token OAuth (`app/services/google/`,
`app/services/microsoft/`, `base_refresh_oauth_token_service.rb`). É **"Entrar
com Google" nativo**, com refresh — não senha de aplicativo. Outlook idem, e
IMAP/SMTP genérico para o resto.

**Isto é a decisão D2 se pagando.** Canal novo é configuração, não código: todos
chegam como a mesma conversa, na mesma UI, com o mesmo painel de contexto ao
lado. Com interface própria, cada canal seria um projeto.

### D5 — E-mail entra por encaminhamento, não por inbox inteira

`channel_email` tem dois modos, e a diferença é de privacidade, não de esforço:

- **OAuth/IMAP**: o Chatwoot puxa a caixa do agente inteira. Completo, e traz
  junto o e-mail pessoal dele — banco, família, tudo. Para um agente de seguro
  de vida isso é sensível, e passa a viver na nossa infra.
- **Encaminhamento**: o Chatwoot provisiona um endereço (`forward_to_email`, que
  é `not null`, sempre existe) e o agente cria um filtro no Gmail mandando para
  lá o que for de cliente.

O padrão é **encaminhamento**, e o OAuth fica como opção para quem pedir
explicitamente. O agente que usa um e-mail só de trabalho vai querer OAuth; o
que usa o pessoal, não — e ele não vai perceber a diferença sozinho. O default
tem que ser o que não invade.

### D6 — Resolver o cliente por telefone **ou** e-mail

O §3 dizia "telefone, caindo para nome". Com multicanal isso fica errado: o mesmo
cliente chega por WhatsApp com telefone e por e-mail com endereço, e vira dois
contatos no Chatwoot.

A regra passa a ser: **telefone normalizado ou e-mail**, e só então nome. Isso
melhora a cobertura em vez de piorar — os **840** registros com e-mail e os
**838** com telefone se somam em vez de competir, e o Chatwoot ainda oferece
merge de contato quando os dois se confirmarem a mesma pessoa.

O teste do §7 que verifica "não vaza apólice de outro agente quando o telefone
bate por acaso" vale igual para e-mail, e ganha um caso: dois contatos distintos
que resolvem para o mesmo `Client`.
