---
name: Fyntra
description: Sistema interno de gestão para agentes de seguro de vida — hierarquia, comissão e apólices, sem cara de CRM de marketing.
colors:
  ledger-teal: "oklch(0.42 0.09 200)"
  ledger-teal-deep: "oklch(0.32 0.08 200)"
  ledger-teal-pale: "oklch(0.93 0.02 200)"
  paper-steel: "oklch(0.99 0.004 200)"
  panel-steel: "oklch(0.965 0.006 200)"
  border-steel: "oklch(0.88 0.008 200)"
  ink: "oklch(0.18 0.012 200)"
  ink-muted: "oklch(0.48 0.01 200)"
  ledger-gold: "oklch(0.62 0.15 70)"
  ledger-gold-pale: "oklch(0.93 0.04 70)"
  success: "oklch(0.46 0.11 155)"
  success-pale: "oklch(0.94 0.03 155)"
  danger: "oklch(0.52 0.17 25)"
  danger-pale: "oklch(0.94 0.04 25)"
typography:
  display:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: "clamp(1.5rem, 2vw, 1.875rem)"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.01em"
  title:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.005em"
  body:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
  label:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.03em"
  numeric:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "0.9375rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "-0.01em"
rounded:
  sm: "6px"
  md: "8px"
  lg: "12px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "40px"
components:
  button-primary:
    backgroundColor: "{colors.ledger-teal}"
    textColor: "{colors.paper-steel}"
    rounded: "{rounded.sm}"
    padding: "10px 18px"
  button-primary-hover:
    backgroundColor: "{colors.ledger-teal-deep}"
    textColor: "{colors.paper-steel}"
    rounded: "{rounded.sm}"
    padding: "10px 18px"
  button-secondary:
    backgroundColor: "{colors.paper-steel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "10px 18px"
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.paper-steel}"
    rounded: "{rounded.sm}"
    padding: "10px 18px"
  status-pill-success:
    backgroundColor: "{colors.success-pale}"
    textColor: "{colors.success}"
    rounded: "{rounded.pill}"
    padding: "3px 10px"
  status-pill-warning:
    backgroundColor: "{colors.ledger-gold-pale}"
    textColor: "{colors.ledger-gold}"
    rounded: "{rounded.pill}"
    padding: "3px 10px"
  status-pill-danger:
    backgroundColor: "{colors.danger-pale}"
    textColor: "{colors.danger}"
    rounded: "{rounded.pill}"
    padding: "3px 10px"
  input:
    backgroundColor: "{colors.paper-steel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "9px 12px"
---

# Design System: Fyntra

## 1. Overview

**Creative North Star: "The Ledger Room"**

Fyntra é a sala dos livros-razão de uma corretora séria: aço-teal fosco,
números alinhados, luz branca e fria. Não é um CRM de marketing tentando
parecer divertido — é a ferramenta que um admin abre pra conferir se a
comissão bateu certo, e que um agente abre no celular entre uma reunião e
outra pra saber quanto vai receber. A confiança vem da clareza dos números
e da hierarquia visual, nunca de efeito decorativo.

Rejeita explicitamente o padrão CRM white-label (GoHighLevel/SparkLeads):
dashboard escuro raso, cards idênticos, azul/roxo de SaaS genérico, ícones
fofos. Fyntra é mais parente de um sistema bancário interno do que de uma
ferramenta de geração de lead.

**Key Characteristics:**
- Fundo quase-branco com leve frieza (não branco puro genérico de SaaS, não creme quente de landing page de IA)
- Um teal-aço escuro como cor de ação primária — raro, nunca decorativo
- Números sempre em fonte monoespaçada, alinhados à direita nas tabelas
- Zero sombra pesada, zero glassmorphism, zero gradiente
- Status (apólice, import) sempre com texto/pill, nunca só cor

## 2. Colors

Paleta restrita: neutros com leve frieza + um teal como ação primária + um
dourado como segunda cor com uso funcional (destaque de valor monetário e
aviso), mais três cores semânticas de status.

### Primary
- **Ledger Teal** (oklch(0.42 0.09 200) / ~#2b5f68): botão primário, links, ícone ativo na navegação, foco de input. Usado com moderação — nunca mais que um elemento de ação por tela.
- **Ledger Teal Deep** (oklch(0.32 0.08 200)): hover/active do primário.
- **Ledger Teal Pale** (oklch(0.93 0.02 200)): fundo de linha selecionada em tabela, fundo de item ativo na navegação.

### Secondary
- **Ledger Gold** (oklch(0.62 0.15 70) / ~#b8863a): destaque de valor monetário importante (total de comissão, número de apólice em destaque) e pill de status "pendente". Texto sobre este fundo é sempre branco (`{colors.paper-steel}`) — nunca escuro, por ser um tom saturado de luminância média.
- **Ledger Gold Pale** (oklch(0.93 0.04 70)): fundo do pill "pendente".

### Neutral
- **Paper Steel** (oklch(0.99 0.004 200) / ~#fcfdfd): fundo da página. Quase branco puro com frieza mínima e deliberada — não é o branco genérico do Tailwind, mas também não vira cinza perceptível.
- **Panel Steel** (oklch(0.965 0.006 200)): fundo de painel/tabela/sidebar, um degrau abaixo do fundo da página.
- **Border Steel** (oklch(0.88 0.008 200)): toda borda de tabela, input, card.
- **Ink** (oklch(0.18 0.012 200) / ~#1c2225): texto de corpo e títulos. Contraste ~15:1 contra Paper Steel.
- **Ink Muted** (oklch(0.48 0.01 200)): texto secundário, labels, metadados de linha de tabela. Contraste ~4.8:1 contra Paper Steel — nunca mais claro que isso.

### Semantic status
- **Success** (oklch(0.46 0.11 155)): apólice em vigor (INFORCE), import concluído sem erro.
- **Danger** (oklch(0.52 0.17 25)): apólice cancelada/lapsada, erro de linha de import, ação destrutiva (remover, rejeitar hierarquia cíclica).

### Named Rules
**The One Action Rule.** Ledger Teal aparece no máximo uma vez como botão preenchido por tela — todo o resto é botão secundário (contorno) ou link. Se duas ações competem, uma delas é secundária.

**The No Color-Only Status Rule.** Nenhum status (apólice, import, papel do usuário) é comunicado só por cor de fundo — sempre acompanhado do texto do status por extenso dentro do pill.

## 3. Typography

**Display/Body Font:** IBM Plex Sans (com fallback `system-ui, sans-serif`)
**Numeric Font:** IBM Plex Mono (com fallback `ui-monospace, monospace`)

**Character:** Uma família só, séria e desenhada para sistemas/infraestrutura (não Inter/Geist genérico de produto de IA) — o peso faz a hierarquia, não o enfeite. Números financeiros sempre em monoespaçada: reforça precisão e alinha colunas de tabela perfeitamente.

### Hierarchy
- **Display** (600, `clamp(1.5rem, 2vw, 1.875rem)`, 1.15): título de página (ex: "Meus Clientes", "Hierarquia de Agentes"). Nunca maior que isso — é um produto, não uma landing page.
- **Title** (600, 1.125rem, 1.3): cabeçalho de seção/card, nome de coluna em destaque.
- **Body** (400, 0.9375rem, 1.55): texto corrido, células de tabela não-numéricas, labels de formulário. Máximo ~70ch em blocos de texto livre (mensagens de erro, descrições).
- **Label** (600, 0.75rem, tracking 0.03em, uppercase permitido só aqui): cabeçalho de coluna de tabela, texto dentro de pill de status.
- **Numeric** (500, IBM Plex Mono, 0.9375rem): todo valor monetário, percentual, número de apólice, NPN — sempre alinhado à direita em tabela, `font-variant-numeric: tabular-nums`.

### Named Rules
**The Mono Money Rule.** Todo número que representa dinheiro, percentual ou identificador (apólice, NPN) usa IBM Plex Mono. Texto descritivo nunca usa mono.

## 4. Elevation

Sistema majoritariamente plano. Profundidade vem de camadas tonais (Paper Steel → Panel Steel → Border Steel), não de sombra. Sombra aparece só em elementos que literalmente flutuam sobre o conteúdo (dropdown, modal, toast) — nunca em card ou botão em repouso.

### Shadow Vocabulary
- **Overlay** (`box-shadow: 0 8px 24px oklch(0.18 0.012 200 / 0.12)`): dropdown de menu, modal, toast — o único uso de sombra no sistema.

### Named Rules
**The Flat-At-Rest Rule.** Nenhum card, tabela ou botão em estado de repouso tem `box-shadow`. Sombra é exclusiva de elementos sobrepostos (z-index acima do conteúdo normal).

## 5. Components

### Buttons
- **Shape:** cantos levemente arredondados (6px) — nunca pill, exceto em status/badge.
- **Primary:** fundo Ledger Teal, texto Paper Steel, padding 10px 18px, peso 600. Hover escurece para Ledger Teal Deep (sem sombra, sem scale).
- **Secondary:** fundo Paper Steel, borda 1px Border Steel, texto Ink. Hover: borda vira Ledger Teal.
- **Danger:** fundo Danger, texto Paper Steel — reservado a ações destrutivas confirmadas (remover agente, rejeitar hierarquia cíclica).

### Status Pills
- **Style:** fundo pálido da cor semântica + texto na cor semântica saturada, cantos totalmente arredondados (pill), padding 3px 10px, fonte Label (12px, 600, tracking 0.03em).
- **Estados:** Success (apólice em vigor, import ok), Warning/Gold (pendente), Danger (cancelada/erro). Sempre com o texto do status por extenso — nunca só a cor.

### Tables (componente de assinatura do produto)
- **Header:** fundo Panel Steel, texto Label (uppercase, tracking), borda inferior 1px Border Steel.
- **Rows:** sem zebra-striping — divisor de 1px Border Steel entre linhas. Hover de linha: fundo Ledger Teal Pale.
- **Numeric columns:** alinhadas à direita, fonte Numeric (IBM Plex Mono), `tabular-nums`.
- **Row actions:** aparecem só no hover da linha (ícone ghost), não ocupam espaço permanente.

### Inputs / Fields
- **Style:** fundo Paper Steel, borda 1px Border Steel, cantos 6px, padding 9px 12px.
- **Focus:** borda muda para Ledger Teal + anel de foco de 2px em Ledger Teal Pale (`box-shadow: 0 0 0 3px oklch(0.93 0.02 200)`).
- **Erro:** borda Danger + texto de erro abaixo do campo em Danger, fonte Body — nunca só a borda vermelha sem texto.

### Navigation
- **Style:** barra lateral fixa no desktop (colapsa para barra inferior fixa no mobile — o uso em campo no celular é tão real quanto o desktop). Item ativo: fundo Ledger Teal Pale, texto Ink, ícone Ledger Teal. Item inativo: texto Ink Muted. Tipografia Label (13px, 600) nos itens.
- **Escopo por papel:** admin, agente e cliente veem apenas os itens do seu papel — nenhuma navegação cruzada visível.

## 6. Do's and Don'ts

### Do:
- **Do** usar Ledger Teal em no máximo um botão preenchido por tela (The One Action Rule).
- **Do** exibir todo status (apólice, import, papel) com texto por extenso dentro do pill, nunca só cor de fundo.
- **Do** usar IBM Plex Mono para todo valor monetário, percentual e identificador numérico, alinhado à direita em tabela.
- **Do** manter o sistema plano em repouso — camadas tonais fazem o trabalho de profundidade que sombra faria.
- **Do** testar todo layout de tabela/formulário em largura de celular real — agentes usam isso em campo, não só no escritório.

### Don't:
- **Don't** usar dashboard escuro raso, cards idênticos ou azul/roxo genérico de SaaS — é exatamente a cara de CRM white-label (SparkLeads/GoHighLevel) que este produto rejeita.
- **Don't** usar `box-shadow` com blur ≥16px em card ou botão em repouso — reservado só a overlay (dropdown/modal/toast).
- **Don't** usar gradiente em texto, glassmorphism decorativo ou `border-left`/`border-right` colorido como "acento" de card.
- **Don't** inserir imagens no meio de títulos, frases ou parágrafos. Quando uma imagem for necessária, ela ocupa um bloco próprio e não interrompe a leitura.
- **Don't** arredondar cards, seções ou inputs acima de 12px — este sistema usa 6-8px, nunca 24-40px.
- **Don't** comunicar aprovado/pendente/cancelado só pela cor do pill — sempre com o texto do status visível.
