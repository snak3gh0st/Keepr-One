# Fyntra — Brand Guidelines

> Identidade da marca. Para os tokens visuais completos (paleta OKLCH, tipografia,
> espaçamento, raios), a fonte da verdade é [`DESIGN.md`](../DESIGN.md). Este
> documento cobre o que o DESIGN.md não cobre: essência, voz e uso da marca.

## Essência

**Fyntra — Finance, Intelligence and Traction.** O sistema operacional de uma
organização de distribuição de seguro de vida. Não é um CRM de marketing: é uma
ferramenta de operação séria, orientada a números confiáveis, para agentes que
trabalham do lead ao annual review.

Uma frase: **a operação começa com números confiáveis.**

## Voz

Precisa, sóbria, direta. Fala como um operador experiente, não como um vendedor.

- **Confiável, não hypado.** "Cobertura recomendada: $1.145.000" — não "Descubra seu poder financeiro!".
- **Direta, não prolixa.** Rótulos curtos, uma ideia por linha, o número em destaque.
- **Honesta sobre limites.** Quando um dado vem da seguradora ou de import, dizemos ("nenhum valor é inventado aqui").
- **Português operacional.** Termos de mercado em inglês quando são o padrão do setor (case, underwriting, chargeback, in-force).

Evitar: exclamações, superlativos de marketing, jargão vazio, emoji em contexto de dado.

## Cores da marca

Papéis (valores canônicos em `DESIGN.md`):

| Papel | Token | Uso |
|-------|-------|-----|
| Primária | `teal` (ledger-teal) | Marca, ações, links, ênfase estrutural |
| Acento | `gold` (ledger-gold) | Destaque pontual — o traço do meio do logo, KPIs de destaque, alertas de atenção |
| Tinta | `ink` / `ink-muted` | Texto |
| Superfícies | `paper` / `panel` / `canvas` / `rail` | Fundo do claro ao escuro |
| Estado | `success` / `danger` | Apenas semântica de estado, nunca decorativo |

Regra: **teal carrega a marca, gold pontua.** Ouro nunca em bloco grande — é acento.

## Logo

O mark é um **"F" geométrico com o traço do meio em ouro** — amarra teal + gold
num só glifo. Componente único: [`components/Logo.tsx`](../components/Logo.tsx).

- `<Logo />` — mark + wordmark "Fyntra".
- `variant="onLight"` (padrão): tile claro (`paper`), glifo teal. Sobre fundos claros e sobre o rail escuro.
- `variant="onTeal"`: tile teal, glifo claro. Sobre fundos claros quando se quer o bloco de marca cheio.
- O traço do meio é **sempre** ouro, nas duas variantes.

**Faça:** usar o componente (nunca redesenhar o "F" à mão), manter o quadrado com
raio, dar respiro ao redor. **Não faça:** recolorir o glifo fora dos dois
variants, esticar, aplicar sombra pesada, usar ouro no glifo inteiro.

## Tipografia

IBM Plex Sans para interface, IBM Plex Mono para números (tabular). Detalhes e
escala em `DESIGN.md`. Números de dinheiro sempre em mono, tabular-nums.

## Acessibilidade

Contraste AA é piso, não teto. Pares delicados já resolvidos no design system
(ex.: `gold-ink` para texto sobre `gold-pale`). Todo novo par texto/fundo passa
por 4.5:1 (texto normal) antes de entrar.
