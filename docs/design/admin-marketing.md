# Marketing administrativo — direção de interface

## Escopo e autoridade

Superfície: `/admin/marketing`, incluindo listagem e detalhe de leads, listagem,
criação e edição de campanhas. Modo **Operate**: encontrar um contato, decidir o
próximo passo e organizar a captação. Esta é uma extensão do administrador
existente da Keepr One; as decisões abaixo pertencem a esse módulo.

A referência visual é a implementação atual de `components/Shell.tsx`,
`components/PageHeader.tsx`, `app/layout.tsx` e `app/globals.css`. O módulo reutiliza
esses componentes por `app/admin/marketing/MarketingShell.tsx`; seus ajustes ficam
em `marketing.module.css` e `campaigns/campaigns.module.css`.

`PRODUCT.md` sustenta clareza operacional, escopo por papel, acessibilidade e uso
real no celular. O texto de Fyntra e a especificação de IBM Plex em `DESIGN.md`
antecedem a identidade Keepr One observada no shell. Esse descompasso preexistente
foi registrado sem atualizar `DESIGN.md` ou `.impeccable/design.json`.

## Herança visual

| Elemento | Herança e aplicação nesta superfície |
| --- | --- |
| Estrutura | Sidebar escura no desktop, cabeçalho móvel e navegação inferior do `Shell`, com Marketing dentro da navegação ADMIN. |
| Fundo | Canvas creme e grade discreta de 32 px fornecidos pelo shell. Os painéis de dados usam paper/panel e divisores finos. |
| Cores | Tokens globais de verde, verde profundo, paper, panel, borda, ink e ink-muted. Os nomes legados `teal` e `border-steel` continuam referenciando os valores reais do CSS. |
| Tipografia | Geist Sans herdada; números tabulares para métricas e tabelas. Geist Mono no endereço de captação. Não introduzir IBM Plex neste módulo por causa da documentação antiga. |
| Cabeçalho | `PageHeader` conserva fundo escuro, verde e textura do produto. A variante local reduz o título a 36 px no desktop e 30 px até 640 px, remove altura mínima, sombra, sinais e ornamento junto ao título. |
| Superfícies | Tabelas, formulários e painéis planos, sem sombras próprias. Bordas e espaço estabelecem agrupamento; esta regra local não redefine a elevação do shell. |

## Composição e comportamento

As abas **Leads** e **Campanhas** permanecem logo abaixo do cabeçalho. Texto,
sublinhado verde e `aria-current` identificam a seção ativa. O cabeçalho compacto
deixa o trabalho visível sem se tornar uma abertura de landing page.

**Leads.** Quatro indicadores contíguos mostram a base completa: todos, novos,
qualificados e convertidos. Cada indicador abre seu recorte; não muda de significado
quando a tabela é filtrada. Abaixo vêm o alerta de retornos pendentes, a exportação,
os filtros e a lista. Busca, etapa e campanha ficam visíveis; responsável, período
e próximo contato ficam em “Mais filtros”. Os filtros de leads e a paginação são
mantidos na URL, e o retorno do detalhe preserva esse contexto.

A lista usa tabela no desktop e cartões de contato até 640 px, mantendo nome,
contato, etapa e próximo passo legíveis. A faixa de quatro indicadores passa a
duas colunas até 800 px. Seleção e ações em lote pertencem à própria listagem.
Estados sem dados e sem correspondências explicam o próximo passo em texto.

**Detalhe do lead.** No desktop, contato e notas ocupam a coluna esquerda e
acompanhamento a direita. Até 800 px, a ordem é **contato → acompanhamento →
histórico de notas**, com intervalos de 24 px entre os painéis. Essa separação vem
do grid; painéis irmãos não somam margem vertical. Dados longos podem quebrar
linha. Etapa, responsável, próximo contato e notas permanecem ações distintas,
com retorno de sucesso ou erro junto ao formulário relevante.

**Campanhas.** A listagem reutiliza `ModuleSummary` com três indicadores de
campanhas, captação e conversões. Busca, status e canal filtram a lista localmente.
Até 800 px, cada linha da tabela assume formato de cartão com rótulos visíveis.
O detalhe organiza **planejamento + link de captação + resultados**: formulário
principal e uma coluna auxiliar no desktop; abaixo de 1100 px, o formulário passa
a ocupar toda a largura, e até 600 px os painéis auxiliares também ficam empilhados.
O endereço rastreado quebra linha, pode ser copiado e tem alternativa de cópia
manual. Resultados levam à lista de leads filtrada pela campanha.

## Controles e acessibilidade

- Botões de ação e campos principais têm altura mínima de 44 px. Ações mantêm
  rótulos explícitos; links auxiliares compactos continuam visualmente secundários.
- Foco de teclado usa contorno sólido verde de 3 px com afastamento de 3 px nas
  superfícies claras. Links e botões no cabeçalho escuro usam contorno paper.
  Campos de campanha não substituem esse contorno por uma sombra pálida.
- Etapas e status incluem texto; cor e ponto são reforços. Campos inválidos têm
  mensagem específica, e feedback de envio/cópia permanece associado à ação.
- O formulário de acompanhamento identifica o horário de Nova York. Inputs de
  leads usam 16 px no celular. Respeitar a preferência por movimento reduzido;
  este módulo não acrescenta animação contínua.
- Cantos dos painéis variam entre 12 e 14 px. Campos e ações reutilizam os raios
  locais existentes, incluindo botões de campanha em cápsula fora do cabeçalho;
  não promover essa variação a um novo sistema global.

## Limites e evidência

Canal, status, datas e orçamento descrevem planejamento. Orçamento não representa
gasto realizado, e conversão registra a decisão da equipe. O módulo não conecta
contas de anúncios nem dispara campanhas ou mensagens. Atalhos de contato abrem
seus destinos correspondentes. Contratos de captação, persistência, permissão e
exportação estão no [guia operacional](../operations/marketing.md).

O handoff foi comparado ao código acima e às capturas locais da listagem de leads,
detalhe do contato e detalhe da campanha, incluindo foco de teclado. A revisão
visual em desktop e celular foi aprovada após corrigir o espaçamento dos painéis
do contato e o foco dos campos de campanha. As capturas de QA são descartáveis;
este documento não depende de sua permanência. Para alterações futuras, verificar
novamente a ordem móvel, a legibilidade do conteúdo longo e os dois tratamentos
de foco contra a implementação corrente.
