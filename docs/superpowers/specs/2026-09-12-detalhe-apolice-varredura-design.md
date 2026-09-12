# Varredura do detalhe das apólices — o book inteiro, uma vez

Data: 2026-09-12
Status: desenho aprovado, aguardando revisão antes do plano de implementação

## O problema, em uma frase

Cobertura, benefício por morte, calendário de pagamento e limites fiscais só existem
na **página de detalhe** de cada apólice na National Life, capturada uma por vez sob
demanda: em produção são **2 de 10.043 apólices**.

A Camada 1 (PR #217) já fez a tela mostrar o que a grade do book entrega para as
9.909 apólices casadas — status, produto, emissão, prêmio anual, prazos de nível e
conversão. Esta spec trata do que a grade **não** tem.

## O que muda

O K-Bot passa a visitar a página de detalhe de todas as apólices do agente, uma vez,
e depois só revisita o que mudar.

## Decisões tomadas

### 1. O orçamento — sem limite, uma vez (decisão do dono do produto)

Uma varredura única que vai até o fim, mesmo levando horas, e depois mantém apenas o
que muda. Alternativas descartadas: 10 ou 30 minutos por sync (fecham o book em
semanas), e captura só sob demanda (nunca fecha).

### 2. Onde estão os ids — colhidos enquanto a grade é paginada (decisão técnica)

A página de detalhe é `policy-details?id=<32 hex>`, um id opaco. Medido: as linhas
cruas que guardamos da grade de inforce **não trazem o link** (0 de 200 linhas). As
alternativas eram:

- **Buscar um a um** com o `locateCurrentPolicyDetailPath` de hoje: uma busca no
  portal por apólice, 10 mil buscas.
- **Colher as âncoras enquanto a grade é paginada**: ~100 páginas de 100 linhas
  contra 10 mil visitas, e produz um mapa durável `número → id` que serve também para
  a manutenção.

Escolhida a segunda. Vira uma captura extra por página no estágio `INFORCE_CLIENTS`.

### 3. Não é etapa do sync diário — é run próprio (decisão técnica)

A varredura dura horas. Como etapa do sync, seguraria as outras treze fontes atrás
dela. Fica um tipo de run separado, com cursor durável por apólice e recibo por lote —
a mesma máquina de retomada que o run de sync usa.

### 4. O que o agente pede passa na frente (decisão técnica)

Comando na hora — ilustração, cotação, detalhe de uma apólice que ele abriu —
**interrompe** a varredura, roda, e ela retoma do cursor. O que ele pede sempre vence
o que o robô decidiu fazer sozinho.

### 5. Ritmo e freio (decisão técnica)

- Pausa curta entre apólices. A seguradora levou 8,4 s para responder uma grade em
  medição real; 10 mil visitas sem pausa é o tipo de volume que acaba em bloqueio.
- N falhas consecutivas **pausam** a varredura e reportam, em vez de insistir por
  horas contra um portal que já disse não.

### 6. Depois da varredura — recaptura por mudança (decisão técnica)

Revisita quando a linha da grade mudar (status, prêmio) ou depois de X dias. A grade
diária já nos diz o que mudou, de graça: varrer tudo de novo seria pagar caro por uma
informação que já temos.

## Invariantes

- **A sessão vai expirar no meio.** Horas de varredura garantem isso. O caminho de
  `AUTH_REQUIRED` já existente leva ao login pelo cofre e a varredura retoma do
  cursor — nada de recomeçar do zero.
- **O worker do Chrome vai ser despejado.** O watchdog de progresso e a reabertura
  pelo cursor durável (PR #215) são o que torna a varredura longa possível; sem eles
  ela morreria em silêncio na primeira hora.
- **Nenhum valor capturado é recalculado por nós.** O que a página de detalhe informa
  é gravado como a seguradora informou, com `observedAt`. É a mesma linha que separa
  um resumo nosso de uma ilustração regulada.
- **Lote parcial não vira snapshot completo.** Um estágio só fecha quando os recibos
  reconciliam, como no sync.

## Riscos assumidos, declarados

- **A aba da seguradora fica ocupada por horas.** Mitigado pela decisão 4, não
  eliminado: se o agente quiser navegar o portal na mão durante a varredura, vai
  disputar a aba.
- **10 mil visitas é volume que pode disparar defesa do portal.** Mitigado pela
  decisão 5. Se acontecer, a varredura pausa e reporta — o freio existe para que o
  pior caso seja "parou e avisou", não "a conta foi bloqueada".
- **Campos que o agente vai pedir e ainda não capturamos:** valor em conta e
  beneficiários. A varredura passa por todas as páginas uma vez; se esses campos
  forem desejados, é aqui que eles devem entrar, não numa segunda passagem.

## Fora de escopo

- O "Resumo da apólice" como peça de apresentação para o cliente — feature própria,
  com a distinção entre resumo e ilustração regulada já discutida.
- Varredura para agências inteiras (hierarquia). Esta spec é o book de um agente.
