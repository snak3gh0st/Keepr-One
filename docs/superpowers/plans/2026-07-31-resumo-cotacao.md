# Resumo da cotação — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uma página que apresenta uma cotação com os números reais que a seguradora devolveu, sem depender de sessão de carrier.

**Architecture:** Três camadas, cada uma testável sozinha. Um módulo puro traduz códigos do carrier para termo de setor; o leitor de payload que já existe ganha os campos que faltam; a página compõe os dois e não faz cálculo nenhum.

**Tech Stack:** Next.js App Router (server components), Prisma, Vitest, Tailwind.

## Global Constraints

Valem para todas as tarefas.

- A peça se chama **"Resumo da cotação"**. Nunca "Ilustração" nem "illustration" no título, no `<PageHeader>` ou em texto visível — nos EUA *illustration* é documento regulado (NAIC Model Reg 582).
- **Sem logo, marca ou identidade visual da National Life.** A atribuição é textual.
- Vocabulário do carrier em **inglês padrão do setor**. O cromo da tela segue em português, como o resto do app.
- **Código desconhecido renderiza o próprio código**, nunca um chute.
- **Nada calculado por nós.** Nenhuma projeção, estimativa ou valor derivado. Campo ausente é `—`.
- **Nenhuma dependência de sessão de carrier.** Nada nesta feature pode chamar Steel, adapter ou job.
- Toda query escopada por `agentId` dentro do `where`, não conferida depois.
- `productName` guarda `"956"` (o código, não um nome). **Não inventar nome de produto.**

---

### Task 1: Módulo de vocabulário do carrier

**Files:**
- Create: `lib/national-life/rapid-solve-labels.ts`
- Test: `lib/national-life/rapid-solve-labels.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `carrierLabel(field: CarrierLabelField, code: string | null | undefined): string | null` e `type CarrierLabelField = 'solveType' | 'rateClass' | 'deathBenefitOption' | 'strategy'`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { carrierLabel } from './rapid-solve-labels'

describe('carrierLabel', () => {
  it('expands the solve types the carrier actually sends', () => {
    expect(carrierLabel('solveType', 'Min_DB_Max_Cash_Value')).toBe(
      'Minimum death benefit, maximum cash value',
    )
    expect(carrierLabel('solveType', 'Based_on_Target_Premium')).toBe(
      'Premium-based, death benefit focus',
    )
    expect(carrierLabel('solveType', 'Specify_Amount')).toBe('Specified face amount')
  })

  it('expands rate class, death benefit option and strategy', () => {
    expect(carrierLabel('rateClass', 'Standard_NT')).toBe('Standard Non-Tobacco')
    expect(carrierLabel('deathBenefitOption', 'A_Level')).toBe('Option A — Level')
    expect(carrierLabel('strategy', 'SP500PointToPointCapFocus')).toBe(
      'S&P 500 Point-to-Point, Cap Focus',
    )
  })

  // A carrier that adds a solve type must not be mistranslated into a
  // plausible-sounding guess. The agent has to be able to repeat the code to
  // whoever can read it.
  it('gives back the raw code when it does not know one', () => {
    expect(carrierLabel('solveType', 'Some_New_Solve')).toBe('Some_New_Solve')
  })

  it('has nothing to say about a missing code', () => {
    expect(carrierLabel('rateClass', null)).toBeNull()
    expect(carrierLabel('rateClass', undefined)).toBeNull()
    expect(carrierLabel('rateClass', '   ')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/national-life/rapid-solve-labels.test.ts`
Expected: FAIL — `Failed to resolve import "./rapid-solve-labels"`.

- [ ] **Step 3: Write minimal implementation**

```ts
/// The carrier's own vocabulary, expanded into the industry term.
///
/// English on purpose. These are regulated product terms, and translating them
/// into Portuguese is how you end up misinforming someone about a financial
/// product — "Standard Non-Tobacco" is the rate class, not a description of
/// one. The screen around them stays in Portuguese, like the rest of the app.
///
/// Codes come from `lib/national-life/rapid-solve.ts`, which reads them off the
/// carrier's own bundle.
const LABELS = {
  solveType: {
    Specify_Amount: 'Specified face amount',
    Based_on_Target_Premium: 'Premium-based, death benefit focus',
    Min_DB_Max_Cash_Value: 'Minimum death benefit, maximum cash value',
  },
  rateClass: {
    Standard_NT: 'Standard Non-Tobacco',
    Standard_Tobacco: 'Standard Tobacco',
  },
  deathBenefitOption: {
    A_Level: 'Option A — Level',
    B_Increasing: 'Option B — Increasing',
  },
  strategy: {
    SP500PointToPointCapFocus: 'S&P 500 Point-to-Point, Cap Focus',
    SP500PointToPointParFocus: 'S&P 500 Point-to-Point, Par Focus',
    SP500PointToPointOnePercentFloor: 'S&P 500 Point-to-Point, 1% Floor',
  },
} as const satisfies Record<string, Record<string, string>>

export type CarrierLabelField = keyof typeof LABELS

/// An unmapped code comes back as itself. A carrier that introduces a new value
/// must surface as that value, never as the nearest thing we happen to know.
export function carrierLabel(
  field: CarrierLabelField,
  code: string | null | undefined,
): string | null {
  if (typeof code !== 'string' || code.trim() === '') {
    return null
  }
  const known = LABELS[field] as Record<string, string | undefined>
  return known[code] ?? code
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/national-life/rapid-solve-labels.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/national-life/rapid-solve-labels.ts lib/national-life/rapid-solve-labels.test.ts
git commit -m "expand the carrier's codes into the industry term"
```

---

### Task 2: `QuoteFacts` com o que a página precisa

**Files:**
- Modify: `lib/national-life/quote-summary.ts` (o `type QuoteFacts` e o `return` de `summarizeQuotePayload`)
- Test: `lib/national-life/quote-summary.test.ts`

**Interfaces:**
- Consumes: nada da Task 1.
- Produces: `summarizeQuotePayload(payload: unknown): QuoteFacts`, agora com os campos `ok: boolean | null`, `solveType`, `deathBenefitOption`, `strategy`, `premiumMode`, `productCode` (todos `string | null`), `allocation`, `faceAmount`, `monthlyPremium`, `annualPremium`, `lapseYear`, `issueAge` (todos `number | null`), além dos já existentes `issueState`, `gender`, `rateClass`.

- [ ] **Step 1: Write the failing test**

Acrescente ao arquivo de teste existente (crie o `describe` se o arquivo ainda não existir, importando `summarizeQuotePayload` de `./quote-summary`):

```ts
// Shape copied from a real row in production, 2026-07-31.
const realPayload = {
  request: {
    Amount: 300,
    Gender: 'Male',
    IssueAge: 38,
    LastName: 'Teste',
    Strategy: 'SP500PointToPointCapFocus',
    FirstName: 'Paulo',
    RateClass: 'Standard_NT',
    SolveType: 'Min_DB_Max_Cash_Value',
    Allocation: 100,
    IssueState: 'FL',
    DateOfBirth: '06/02/1988',
    PremiumMode: 'Monthly',
    ProductCode: '956',
    DeathBenefitOption: 'A_Level',
  },
  response: {
    ok: true,
    lapseYear: null,
    faceAmount: 215473,
    annualPremium: 3600,
    monthlyPremium: 300,
  },
}

describe('summarizeQuotePayload — campos do resumo', () => {
  it('reads back everything the summary screen shows', () => {
    const facts = summarizeQuotePayload(realPayload)

    expect(facts.solveType).toBe('Min_DB_Max_Cash_Value')
    expect(facts.deathBenefitOption).toBe('A_Level')
    expect(facts.productCode).toBe('956')
    expect(facts.premiumMode).toBe('Monthly')
    expect(facts.allocation).toBe(100)
    expect(facts.faceAmount).toBe(215473)
    expect(facts.monthlyPremium).toBe(300)
    expect(facts.annualPremium).toBe(3600)
    expect(facts.ok).toBe(true)
  })

  // `lapseYear: 0` from the carrier means "does not lapse"; the adapter already
  // converts it to null. Null has to stay null here, because a screen that
  // prints 0 reads as "lapses in year zero".
  it('keeps "does not lapse" distinct from a year', () => {
    expect(summarizeQuotePayload(realPayload).lapseYear).toBeNull()
    expect(
      summarizeQuotePayload({ ...realPayload, response: { ...realPayload.response, lapseYear: 12 } })
        .lapseYear,
    ).toBe(12)
  })

  // A refusal is a real answer. It must not read as a quote of zero.
  it('reports a refusal as a refusal', () => {
    const facts = summarizeQuotePayload({
      request: realPayload.request,
      response: { ok: false },
    })
    expect(facts.ok).toBe(false)
    expect(facts.faceAmount).toBeNull()
  })

  // Rows written before a field existed must open, not crash.
  it('survives a payload it has never seen', () => {
    const facts = summarizeQuotePayload({ nothing: 'familiar' })
    expect(facts.solveType).toBeNull()
    expect(facts.faceAmount).toBeNull()
    expect(facts.ok).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/national-life/quote-summary.test.ts`
Expected: FAIL — `facts.solveType` é `undefined`, não `'Min_DB_Max_Cash_Value'`.

- [ ] **Step 3: Write minimal implementation**

Em `lib/national-life/quote-summary.ts`, substitua o `type QuoteFacts` e o `return` de `summarizeQuotePayload`. Os helpers `record`, `text` e `number` já existem no arquivo e não mudam.

```ts
type QuoteFacts = {
  // Sempre opcionais: linhas gravadas antes de um campo existir, ou por um
  // formato futuro do carrier, têm que renderizar "—" e não derrubar a tela.
  ok: boolean | null
  issueAge: number | null
  issueState: string | null
  gender: string | null
  rateClass: string | null
  strategy: string | null
  solveType: string | null
  deathBenefitOption: string | null
  premiumMode: string | null
  productCode: string | null
  allocation: number | null
  faceAmount: number | null
  monthlyPremium: number | null
  annualPremium: number | null
  lapseYear: number | null
}

function boolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

export function summarizeQuotePayload(payload: unknown): QuoteFacts {
  const root = record(payload)
  const request = record(root.request)
  const response = record(root.response)

  return {
    ok: boolean(response.ok),
    issueAge: number(request.IssueAge),
    issueState: text(request.IssueState),
    gender: text(request.Gender),
    rateClass: text(request.RateClass),
    strategy: text(request.Strategy),
    solveType: text(request.SolveType),
    deathBenefitOption: text(request.DeathBenefitOption),
    premiumMode: text(request.PremiumMode),
    productCode: text(request.ProductCode),
    allocation: number(request.Allocation),
    faceAmount: number(response.faceAmount),
    monthlyPremium: number(response.monthlyPremium),
    annualPremium: number(response.annualPremium),
    lapseYear: number(response.lapseYear),
  }
}
```

Exporte o tipo para a página consumir: troque `type QuoteFacts` por `export type QuoteFacts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/national-life/quote-summary.test.ts && npx tsc --noEmit`
Expected: PASS. O `tsc` também tem que passar — `app/agent/illustrations/page.tsx` já consome esse retorno.

- [ ] **Step 5: Commit**

```bash
git add lib/national-life/quote-summary.ts lib/national-life/quote-summary.test.ts
git commit -m "read back the rest of what the carrier answered"
```

---

### Task 3: A página do resumo

**Files:**
- Create: `app/agent/illustrations/[id]/page.tsx`
- Modify: `app/agent/illustrations/page.tsx` (a célula do nome do segurado vira link)

**Interfaces:**
- Consumes: `carrierLabel` (Task 1) e `summarizeQuotePayload` (Task 2).
- Produces: a rota `/agent/illustrations/[id]`.

- [ ] **Step 1: Write the page**

```tsx
export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentAgent } from '@/lib/agent-context'
import { summarizeQuotePayload } from '@/lib/national-life/quote-summary'
import { carrierLabel } from '@/lib/national-life/rapid-solve-labels'
import { IllustrationPdfButton } from '../IllustrationPdfButton'
import { Shell } from '@/components/Shell'
import { PageHeader } from '@/components/PageHeader'

const currency = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value)

const day = (value: Date) =>
  new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'UTC' }).format(value)

/// Nothing here is computed. Every value either came from the carrier or is
/// absent, and absent renders as an em dash rather than as a zero.
function Fact({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="border-t border-white/10 py-3">
      <dt className="text-xs uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd className="mt-1 text-sm text-ink">{value ?? '—'}</dd>
    </div>
  )
}

export default async function QuoteSummaryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const agent = await getCurrentAgent()
  const user = await prisma.user.findUnique({ where: { id: agent.userId } })

  // Scoped in the query, not checked after it: a quote names an insured and a
  // premium, and someone else's id must be indistinguishable from a missing one.
  const illustration = await prisma.illustration.findFirst({
    where: { id, agentId: agent.id },
    select: {
      id: true,
      createdAt: true,
      insuredName: true,
      insuredDateOfBirth: true,
      productName: true,
      documentFetchedAt: true,
      rawPayload: true,
    },
  })
  if (!illustration) notFound()

  const facts = summarizeQuotePayload(illustration.rawPayload)

  return (
    <Shell role="AGENT" userName={user?.name ?? ''}>
      <PageHeader
        title="Resumo da cotação"
        eyebrow="Carteira"
        description="Os números que a seguradora devolveu, do jeito que ela devolveu."
      >
        <Link
          href="/agent/illustrations"
          className="inline-flex items-center border border-white/15 px-4 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-white/[0.06]"
        >
          Voltar
        </Link>
      </PageHeader>

      {facts.ok === false && (
        <p className="mb-6 border border-gold/30 px-4 py-3 text-sm text-gold">
          A seguradora não cotou este pedido. Não há capital nem prêmio para mostrar.
        </p>
      )}

      <div className="grid gap-8 md:grid-cols-2">
        <section>
          <h2 className="text-sm font-semibold text-paper">Segurado</h2>
          <dl>
            <Fact label="Nome" value={illustration.insuredName} />
            <Fact
              label="Nascimento"
              value={illustration.insuredDateOfBirth ? day(illustration.insuredDateOfBirth) : null}
            />
            {/* ANB, not current age: the two differ for half the year, and an
                agent who confuses them misprices the conversation. */}
            <Fact
              label="Issue age (ANB)"
              value={facts.issueAge !== null ? String(facts.issueAge) : null}
            />
            <Fact label="Sexo" value={facts.gender} />
            <Fact label="Estado de emissão" value={facts.issueState} />
            <Fact label="Rate class" value={carrierLabel('rateClass', facts.rateClass)} />
          </dl>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-paper">O que foi pedido</h2>
          <dl>
            <Fact label="Solve type" value={carrierLabel('solveType', facts.solveType)} />
            <Fact
              label="Death benefit option"
              value={carrierLabel('deathBenefitOption', facts.deathBenefitOption)}
            />
            <Fact label="Strategy" value={carrierLabel('strategy', facts.strategy)} />
            <Fact
              label="Allocation"
              value={facts.allocation !== null ? `${facts.allocation}%` : null}
            />
            <Fact label="Premium mode" value={facts.premiumMode} />
            {/* The carrier stores a code here, not a name. Showing the code is
                the honest thing; inventing a product name is not. */}
            <Fact
              label="Product code"
              value={facts.productCode ?? illustration.productName}
            />
          </dl>
        </section>

        <section className="md:col-span-2">
          <h2 className="text-sm font-semibold text-paper">O que a seguradora respondeu</h2>
          <dl className="grid gap-x-8 sm:grid-cols-2 lg:grid-cols-4">
            <Fact
              label="Capital segurado"
              value={facts.faceAmount !== null ? currency(facts.faceAmount) : null}
            />
            <Fact
              label="Prêmio mensal"
              value={facts.monthlyPremium !== null ? currency(facts.monthlyPremium) : null}
            />
            <Fact
              label="Prêmio anual"
              value={facts.annualPremium !== null ? currency(facts.annualPremium) : null}
            />
            {/* null is "does not lapse", not year zero. */}
            <Fact
              label="Lapse"
              value={facts.lapseYear === null ? 'Não lapsa' : `Ano ${facts.lapseYear}`}
            />
          </dl>
        </section>
      </div>

      <section className="mt-10 border-t border-white/10 pt-6 text-sm text-ink-muted">
        <p>
          Números fornecidos por National Life (Rapid Solve) em {day(illustration.createdAt)}.
          Servem para cotação verbal. O documento oficial é a ilustração em PDF da seguradora.
        </p>
        <div className="mt-3">
          {illustration.documentFetchedAt ? (
            <a
              href={`/api/illustrations/${illustration.id}/document`}
              target="_blank"
              rel="noreferrer"
              className="text-teal hover:text-teal-deep"
            >
              Abrir PDF da seguradora
            </a>
          ) : (
            <IllustrationPdfButton illustrationId={illustration.id} />
          )}
        </div>
      </section>
    </Shell>
  )
}
```

- [ ] **Step 2: Link the list row to it**

Em `app/agent/illustrations/page.tsx`, a célula que hoje mostra `illustration.insuredName` como texto passa a ser link. Localize a `<Td>` do nome do segurado e troque o conteúdo por:

```tsx
<Link
  href={`/agent/illustrations/${illustration.id}`}
  className="text-teal hover:text-teal-deep"
>
  {illustration.insuredName ?? '—'}
</Link>
```

`Link` já está importado nesse arquivo.

- [ ] **Step 3: Run the whole suite and the typechecker**

Run: `npx tsc --noEmit && npx vitest run && npx eslint app/agent/illustrations lib/national-life/rapid-solve-labels.ts lib/national-life/quote-summary.ts`
Expected: `tsc` sem saída; suíte inteira verde; eslint sem saída.

- [ ] **Step 4: Check it against a real row**

Não existe teste de render para páginas server-side neste repo, então a conferência é manual e vale ser feita: `npm run dev`, abrir `/agent/illustrations`, clicar num nome, e confirmar quatro coisas —

1. o título diz **"Resumo da cotação"**, não "Ilustração";
2. **Lapse** mostra *Não lapsa* e não *Ano 0*;
3. o bloco de procedência aparece com a data e sem nenhuma marca da seguradora;
4. `Product code` mostra `956`.

- [ ] **Step 5: Commit**

```bash
git add app/agent/illustrations
git commit -m "show the quote the carrier answered, without asking it again"
```

---

## Self-Review

**Cobertura da spec.** Rota (Task 3), `QuoteFacts` estendido (Task 2), vocabulário em inglês (Task 1), bloco de procedência (Task 3), link do PDF e botão de fila (Task 3), `lapseYear` como "não lapsa" (Tasks 2 e 3), ANB rotulado (Task 3), recusa que não vira zero (Tasks 2 e 3), `notFound` para cotação de outro agente (Task 3), payload desconhecido que não derruba (Task 2). Sem lacuna.

**Placeholders.** Nenhum "TBD", nenhum "similar à Task N", nenhum passo sem o código.

**Consistência de tipos.** `carrierLabel(field, code)` da Task 1 é chamada com exatamente esses quatro `field` na Task 3. Os campos de `QuoteFacts` da Task 2 são os mesmos lidos na Task 3. `summarizeQuotePayload` mantém a assinatura que `app/agent/illustrations/page.tsx` já usa.

**Tokens conferidos, não assumidos.** `--color-gold` existe em `app/globals.css:48`, e `text-ink`, `text-paper`, `text-ink-muted`, `text-teal`, `text-teal-deep` são as do resto do portal. Nenhum token novo é introduzido.

**`lib/national-life/quote-summary.test.ts` já existe** — a Task 2 acrescenta um `describe` a ele, não cria arquivo.
