# Sincronização com a seguradora — desenho

Data: 2026-08-03
Estado: aprovado para plano de implementação

## Problema

O agente pede um PDF e a tela diz "Pedido enviado". Se a sessão do carrier
estiver caída, o pedido morre e **nada mais é dito** — foi exatamente assim que
o operador leu a integração como quebrada em 2026-07-31, com um job que falhou
20 segundos depois do clique.

O conserto de julho fez a linha contar o que houve. Falta o resto: um lugar que
responda *"minha conta está em dia com a seguradora?"*, e um caminho de volta
que não seja o agente descobrir sozinho que precisa reconectar.

## O princípio que decide o resto

**O agente nunca deve pensar na sessão da seguradora.** Isso é problema nosso.
A interface fala da intenção dele — *"quero o PDF"* — e do estado — *"está a
caminho"*, *"precisa de você"*. Nunca de Auth0, nunca de sessão expirada, nunca
de código de erro.

Toda decisão abaixo decorre disso.

## O que já é verdade, medido

Números que o desenho usa e que não são suposição:

- **A sessão do portal é praticamente imortal.** O cron de keep-alive renova a
  cada 10 min e funcionou o dia todo em 2026-07-31. Puxar apólices e comissões
  quase nunca bloqueia.
- **Só a perna do Foresight morre** — medida viva às 22:33 e no muro do Auth0
  às 23:12, ~41 min depois do login. É dela que dependem ilustração e PDF.
- **Reconectar costuma ser um clique.** Em 2026-07-31 22:31 o login completou
  **sem pedir senha**, porque o portal estava vivo. O desenho otimiza para esse
  caso e apenas tolera o caso do código de SMS.
- **Abrir uma ilustração completa leva minutos.** `Fabio Filho IUL` levou muito
  mais que os segundos de um quick quote.

## O selo

### Onde

`components/Shell.tsx:226-229` já tem um indicador na barra superior — ponto
colorido mais texto, `hidden sm:flex`, dizendo **"Operação conectada"**. Ele é
**fixo no código**: verde sempre, sem ler estado nenhum.

O selo real toma esse lugar. Ganha-se o slot, o tratamento visual e a posição
já pensada; perde-se uma afirmação decorativa que hoje não é verificada.

Muda para o grupo à direita da barra (`flex shrink-0 items-center gap-2`), que
é visível em todas as larguras — o indicador atual some abaixo de `sm`, e um
estado que pede ação do agente não pode ser invisível no celular. O `PRODUCT.md`
é explícito: desktop e mobile são igualmente reais.

### Os três estados

| estado | texto | clicável | quando |
| --- | --- | --- | --- |
| em dia | **Em dia** | não | nada na fila |
| trabalhando | **2 a caminho** | não | há pedidos na fila avançando |
| bloqueado | **Precisa de você** | **sim** | há pedidos parados esperando login |

**Por que selo e não botão.** Um "Sincronizar" permanente convida a apertar, e
apertar algo que quase sempre não faz nada ensina que o botão não significa
nada — aí, no dia em que significar, ele é ignorado. Um selo que só vira ação
quando há ação ensina o contrário.

**"Em dia" fica visível.** Silêncio total faz o agente duvidar de que a
integração existe. Decisão de produto, tomada.

**"Precisa de você"** diz o que ele tem que fazer, em vez de nomear o sistema.
Preferido a "Conectar" e a "Reconectar" pelo mesmo motivo do princípio acima.

### O que acontece ao clicar

Abre a modal de login que já existe (`NationalLifeBrowserModal`), **onde o
agente está**. Não navega para Integrações. Ao conectar, a fila drena e o selo
passa a "N a caminho".

## A fila mora onde o trabalho está

**Não haverá central de sincronização.** A linha da ilustração já diz o que
houve com aquele pedido (`illustration-pdf-status.ts`, entregue em julho). Uma
tela separada listando pendências é mais um lugar para visitar e esquecer.

Selo global para *"tem algo comigo?"*; linha honesta para *"o que houve com
este aqui"*. Dois lugares, nenhum a mais.

## Estacionar em vez de falhar

Quando o carrier recusa por sessão (`FORESIGHT_SSO_EXPIRED`), o job vai de
`RUNNING` para **`ACTION_REQUIRED`**, não para `FAILED`.

Isso **não muda a máquina de estados**: `RUNNING → ACTION_REQUIRED → QUEUED` já
é permitido, e `ACTION_REQUIRED` significa literalmente "um humano precisa
agir". Dois efeitos vêm de graça: `ACTION_REQUIRED` já está em
`ACTIVE_JOB_STATES`, então pedir de novo devolve `duplicate: true` em vez de
criar job repetido; e o worker só reclama `QUEUED`, então **nada fica batendo no
carrier enquanto espera** — o que importa muito, porque atravessar o SSO é
suspeito de ser o que queima a sessão.

Na mesma transação em que a conexão vira `CONNECTED`, os jobs daquele agente
parados nesse estado voltam para `QUEUED`. Mesma transação de propósito: ou a
sessão vale e a fila anda, ou nada mudou.

Se o primeiro job drenado falhar de novo por sessão, ele estaciona sozinho — e
os seguintes também, cada um por conta. Não precisa de lógica nova, e cinco
pendências não viram cinco travessias em cascata.

## Dizer quanto demora

Na linha, enquanto o pedido avança:

> PDF a caminho — costuma levar de 2 a 5 minutos.

Sem isso, três minutos de silêncio se leem como quebrado, que foi como o
"Pedido enviado" mudo foi lido em julho. A faixa vem da medição de abrir uma
ilustração completa, não de estimativa.

## Fora de escopo, de propósito

- **Barra de progresso.** Não sabemos a porcentagem; fingir é mentir.
- **Polling em toda tela.** Caro e barulhento; o selo basta.
- **Notificação ou e-mail.** Escopo novo, e o agente está no app quando pede.
- **Mostrar "a sessão expira em X".** É a nossa contabilidade vazando para a
  tela dele, e ele não pode fazer nada com esse número.
- **Sync de entrada manual.** Puxar já roda sozinho. Transformar em botão seria
  regressão vestida de funcionalidade.

## Erros

- Sem integração configurada: o selo não aparece. Nem todo agente conecta.
- Falha ao ler o estado: o selo não aparece. Um selo que não sabe o que diz é
  pior que nenhum — foi assim que `illustrationSsoReachable` mentiu por horas
  em julho, congelado no último valor conhecido.
- Falha ao drenar: os jobs continuam parados e o selo volta a "Precisa de você".
  Nada é perdido; nada é dito duas vezes.

## Testes

Puros e baratos, no padrão da casa:

- O estado do selo derivado das contagens: nada → "Em dia"; ativos → "N a
  caminho"; parados → "Precisa de você"; parados **e** ativos → "Precisa de
  você" ganha, porque é o único estado que pede ação.
- `FORESIGHT_SSO_EXPIRED` estaciona; outros erros continuam falhando.
- Conectar drena só os jobs do agente certo, e é atômico com o connect.
- A frase do tempo esperado aparece só enquanto o pedido avança.
