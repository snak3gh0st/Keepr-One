# Cotação FlexLife via Foresight — desenho

Data: 2026-08-05  
Estado: aprovado para especificação; transporte atual ainda é Rapid Solve

## Objetivo

A cotação que o agente faz no Keepr One é **FlexLife**, não “Rapid Solve”.
Rapid Solve é (hoje) só o transporte HTTP legado que a tela de illustration usa
para obter números; o nome do produto e o caminho alvo de produto são FlexLife
no Foresight.

## Decisão de produto

| Conceito | Nome certo | Detalhe técnico atual |
|---|---|---|
| Produto cotado | **FlexLife** | Carrier code `956` no POST Rapid Solve |
| Ferramenta de cotação (alvo) | **Foresight** (produto FlexLife) | Ainda não automatizado na extensão |
| Transporte temporário | endpoint Rapid Solve | `/agent/RapidSolve/GetQuote` via Steel |
| Ilustração oficial | PDF Foresight | Já existe leitura/PDF sob demanda |

Term e outros produtos **não** entram neste fluxo de cotação.

## Fluxo do agente (alvo)

```text
Paga Keepr → conta agente
    → instala KeeproneConnect (Store ou unpacked no piloto)
    → pareia device
    → login NLG no Chrome dele
    → sync de book (READ_GRID)
    → cotação FlexLife (Foresight)
    → resumo + PDF
    → (humano) e-App
```

Enquanto a Store não aprova: extensão **unpacked** com ID estável
(`.keys/manifest-key.txt`), ou fallback Steel remoto.

## Extensão é a única maneira?

Não. Hierarquia:

1. **KeeproneConnect (preferido)** — sessão e token Foresight na memória do
   Chrome do agente; zero frota; alinhado a “um humano por credencial”.
2. **Steel remoto (fallback)** — já existe; login no viewer; caro/frágil no SSO
   Foresight; usado se o agente não puder instalar a extensão.
3. **CSV / import manual** — book sem cotação ao vivo.
4. **Feed IMO/BGA** — conversa comercial, não engenharia.
5. **API oficial NLG** — não existe.
6. **Cofre de senha no servidor** — descartado (viola a regra de credencial).

Frota multi-browser server-side permanece arquivada; não é o path de cotação.

## Capabilities (Connect) — cotação

Complementam as de leitura já desenhadas:

| Capability | Parâmetros | Efeito no carrier | Fase |
|---|---|---|---|
| `READ_GRID` | `navigatePath` | nenhum | Feito |
| `FORESIGHT_INVENTORY` | — | nenhum | 2 |
| `FORESIGHT_CASE_DETAIL` | `caseKey` | seleção de caso | 2 |
| `FORESIGHT_REPORT` | `caseKey` | gera PDF | 2 |
| `FLEXLIFE_QUOTE` | inputs de cotação (estado, DOB, solve, etc.) | cria/atualiza caso FlexLife conforme o portal | 2b |

`FLEXLIFE_QUOTE` **não** reutiliza o nome Rapid Solve. Se o experimento
confirmar que o quick quote do portal cria o caso Foresight, a capability
encapsula esse efeito; se a criação for só via New Case no Foresight, a
capability dirige esse fluxo. Os dois experimentos da Fase 0 do Connect
continuam pré-requisito.

## UI (já nesta entrega)

Telas de illustration/cotação falam **FlexLife**. O job interno pode continuar
`GET_RAPID_SOLVE_QUOTE` até o transporte Foresight existir —
`Illustration.productName` grava `FlexLife` quando o código é o da FlexLife.

## Fora de escopo desta spec

- Submissão e-App.
- Cotação Term.
- Aposentadoria total do endpoint Rapid Solve no worker (só depois de
  `FLEXLIFE_QUOTE` em produção).
- Listagem pública na Chrome Web Store (piloto = unpacked / trusted testers).

## Critérios de aceite

- Agente nunca vê “Rapid Solve” como nome do produto ou da cotação nas telas.
- Código `956` mapeia para label FlexLife; outros códigos não são relabelados.
- Design deixa explícito: extensão preferida, Steel fallback, sem cofre de senha.
- Plano de implementação de `FLEXLIFE_QUOTE` só após os experimentos Fase 0.
