# Sincronização com a seguradora — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O agente vê num só lugar se a conta está em dia com a seguradora, e o que estava parado esperando login sai sozinho quando ele conecta.

**Architecture:** Três camadas independentes. Uma função pura traduz contagens de fila em estado de selo; o worker estaciona em vez de falhar e a conexão drena a fila na mesma transação; a barra superior ganha o selo, substituindo um indicador hoje fixo no código.

**Tech Stack:** Next.js App Router, Prisma, Vitest, Tailwind.

## Global Constraints

- **O agente nunca lê sobre a sessão da seguradora.** Nada de "Auth0", "sessão expirada" ou código de erro em texto visível. A tela fala da intenção dele e do estado do pedido.
- Três textos de selo, exatos: **`Em dia`**, **`N a caminho`**, **`Precisa de você`**.
- Só **`Precisa de você`** é clicável. Os outros dois são estado, não ação.
- A frase de tempo é exatamente: **`PDF a caminho — costuma levar de 2 a 5 minutos.`**
- Sem barra de progresso, sem polling contínuo, sem notificação, e sem mostrar prazo de expiração de sessão.
- Selo ausente é melhor que selo errado: sem integração configurada, ou falha ao ler o estado, **não renderiza nada**.
- Toda query escopada por `agentId` dentro do `where`.

---

### Task 1: O estado do selo, como função pura

**Files:**
- Create: `lib/national-life/carrier-sync-state.ts`
- Test: `lib/national-life/carrier-sync-state.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `type CarrierSyncState = { kind: 'IN_SYNC' } | { kind: 'WORKING'; count: number } | { kind: 'NEEDS_YOU'; count: number }`, a função `carrierSyncState(input: { working: number; blocked: number }): CarrierSyncState`, e `carrierSyncLabel(state: CarrierSyncState): string`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { carrierSyncLabel, carrierSyncState } from './carrier-sync-state'

describe('carrierSyncState', () => {
  it('is quiet when there is nothing in flight', () => {
    expect(carrierSyncState({ working: 0, blocked: 0 })).toEqual({ kind: 'IN_SYNC' })
  })

  it('counts what is on its way', () => {
    expect(carrierSyncState({ working: 2, blocked: 0 })).toEqual({ kind: 'WORKING', count: 2 })
  })

  it('counts what is waiting on the agent', () => {
    expect(carrierSyncState({ working: 0, blocked: 3 })).toEqual({ kind: 'NEEDS_YOU', count: 3 })
  })

  // Blocked wins: it is the only state that asks the agent for something, and
  // a badge that says "a caminho" while something waits on a login is the
  // silence this whole feature exists to remove.
  it('lets the state that asks for something win', () => {
    expect(carrierSyncState({ working: 5, blocked: 1 })).toEqual({ kind: 'NEEDS_YOU', count: 1 })
  })
})

describe('carrierSyncLabel', () => {
  it('uses the three agreed sentences', () => {
    expect(carrierSyncLabel({ kind: 'IN_SYNC' })).toBe('Em dia')
    expect(carrierSyncLabel({ kind: 'WORKING', count: 2 })).toBe('2 a caminho')
    expect(carrierSyncLabel({ kind: 'NEEDS_YOU', count: 3 })).toBe('Precisa de você')
  })

  // The count is in the working label and deliberately not in the blocked one:
  // "Precisa de você" is a call to act, and a number in it invites reading it
  // as progress rather than as a request.
  it('keeps the count out of the call to act', () => {
    expect(carrierSyncLabel({ kind: 'NEEDS_YOU', count: 9 })).not.toContain('9')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/national-life/carrier-sync-state.test.ts`
Expected: FAIL — `Failed to resolve import "./carrier-sync-state"`.

- [ ] **Step 3: Write minimal implementation**

```ts
/// What the top bar says about the carrier, derived from the queue alone.
///
/// Nothing here knows about sessions, identity providers or expiry. The agent's
/// question is "is my account up to date?", and the honest answer comes from
/// counting what is moving and what is stuck — not from inspecting a cookie.
export type CarrierSyncState =
  | { kind: 'IN_SYNC' }
  | { kind: 'WORKING'; count: number }
  | { kind: 'NEEDS_YOU'; count: number }

/// Blocked beats working. It is the only state that asks the agent for
/// anything, and hiding it behind a cheerier count is how a queue goes silent.
export function carrierSyncState(input: {
  working: number
  blocked: number
}): CarrierSyncState {
  if (input.blocked > 0) return { kind: 'NEEDS_YOU', count: input.blocked }
  if (input.working > 0) return { kind: 'WORKING', count: input.working }
  return { kind: 'IN_SYNC' }
}

export function carrierSyncLabel(state: CarrierSyncState): string {
  switch (state.kind) {
    case 'WORKING':
      return `${state.count} a caminho`
    // No count: this is a call to act, and a number in it reads as progress.
    case 'NEEDS_YOU':
      return 'Precisa de você'
    default:
      return 'Em dia'
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/national-life/carrier-sync-state.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/national-life/carrier-sync-state.ts lib/national-life/carrier-sync-state.test.ts
git commit -m "say what the carrier badge says, from the queue alone"
```

---

### Task 2: Estacionar em vez de falhar, e drenar ao conectar

**Files:**
- Modify: `workers/national-life/run-job.ts` (o `catch` que decide o destino de um job que falhou)
- Modify: `workers/national-life/runtime.ts` (a transação de `complete`)
- Modify: `lib/national-life/illustration-pdf-status.ts` (o texto de `ACTION_REQUIRED`)
- Test: `workers/national-life/run-job.test.ts`, `lib/national-life/illustration-pdf-status.test.ts`

**Interfaces:**
- Consumes: nada da Task 1.
- Produces: jobs em `ACTION_REQUIRED` quando o carrier recusa por sessão, e o método `sessionStore.releaseBlockedJobs(agentId: string, now: Date): Promise<void>` chamado dentro da transação de conexão.

- [ ] **Step 1: Write the failing test**

Em `workers/national-life/run-job.test.ts`, acrescente:

```ts
// A dead carrier session is not a failed request — it is a request waiting for
// a human to connect. Failing it throws away work the agent asked for and
// makes them ask again; parking keeps it and lets the next login carry it out.
it('parks a request the carrier refused for want of a session', async () => {
  const test = createDeps({
    job: buildJob({
      operation: 'GENERATE_ILLUSTRATION_PDF',
      caseId: null,
      input: { illustrationId: 'illustration-1' },
    }),
    renderForesightReport: () => {
      const error = new Error('carrier asked for a new login') as Error & { code?: string }
      error.code = 'FORESIGHT_SSO_EXPIRED'
      throw error
    },
  })

  await runNationalLifeJob('job-1', test.deps)

  expect(test.deps.jobStore.transitions.at(-1)).toMatchObject({
    to: 'ACTION_REQUIRED',
    safeErrorCode: 'FORESIGHT_SSO_EXPIRED',
  })
})

// Everything else still fails. Parking is for the one cause a login fixes.
it('still fails a request the carrier refused on its merits', async () => {
  const test = createDeps({
    job: buildJob({
      operation: 'GENERATE_ILLUSTRATION_PDF',
      caseId: null,
      input: { illustrationId: 'illustration-1' },
    }),
    renderForesightReport: () => {
      const error = new Error('report failed') as Error & { code?: string }
      error.code = 'FORESIGHT_REPORT_FAILED'
      throw error
    },
  })

  await runNationalLifeJob('job-1', test.deps)

  expect(test.deps.jobStore.transitions.at(-1)?.to).not.toBe('ACTION_REQUIRED')
})
```

E em `lib/national-life/illustration-pdf-status.test.ts`:

```ts
// ACTION_REQUIRED means a human has to connect. Reporting it as "gerando" is
// the silence that made the integration read as broken on 2026-07-31.
it('tells the agent when a render is waiting on them', () => {
  const status = latestPdfStatusByIllustration([
    job({ state: 'ACTION_REQUIRED', safeErrorCode: 'FORESIGHT_SSO_EXPIRED' }),
  ])
  expect(status.get('ill-1')).toEqual({ state: 'BLOCKED', safeErrorCode: 'FORESIGHT_SSO_EXPIRED' })
  expect(illustrationPdfMessage(status.get('ill-1')!)).toBe(
    'Aguardando você conectar na seguradora.',
  )
})

it('says how long a render in flight usually takes', () => {
  expect(illustrationPdfMessage({ state: 'WORKING' })).toBe(
    'PDF a caminho — costuma levar de 2 a 5 minutos.',
  )
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run workers/national-life/run-job.test.ts lib/national-life/illustration-pdf-status.test.ts`
Expected: FAIL — o job transiciona para `FAILED`, e `ACTION_REQUIRED` hoje é classificado como `WORKING`.

- [ ] **Step 3: Write the implementation**

Em `lib/national-life/illustration-pdf-status.ts`, tire `ACTION_REQUIRED` de `WORKING_STATES` e acrescente o estado bloqueado:

```ts
export type IllustrationPdfStatus =
  | { state: 'WORKING' }
  | { state: 'BLOCKED'; safeErrorCode: string | null }
  | { state: 'FAILED'; safeErrorCode: string | null }

/// `ACTION_REQUIRED` sai daqui: ele significa que um humano precisa agir, e
/// dizer "gerando" sobre um pedido parado é a mesma mudez que fez a integração
/// ser lida como quebrada.
const WORKING_STATES: ReadonlySet<string> = new Set([
  'QUEUED',
  'RUNNING',
  'WAITING_FOR_MFA',
  'WAITING_FOR_REVIEW',
  'RETRYABLE',
  'CREDENTIALS_EXPIRED',
  'MANUAL_REVIEW',
])
```

No laço de `latestPdfStatusByIllustration`, antes do teste de `WORKING_STATES`:

```ts
    if (job.state === 'ACTION_REQUIRED') {
      byIllustration.set(illustrationId, {
        state: 'BLOCKED',
        safeErrorCode: job.safeErrorCode,
      })
    } else if (WORKING_STATES.has(job.state)) {
```

E em `illustrationPdfMessage`:

```ts
  if (state.state === 'WORKING') {
    // The number comes from measuring a full illustration opening in the
    // carrier's tool: minutes, not seconds. Without it, silence reads as broken.
    return 'PDF a caminho — costuma levar de 2 a 5 minutos.'
  }
  if (state.state === 'BLOCKED') {
    return 'Aguardando você conectar na seguradora.'
  }
```

Em `workers/national-life/run-job.ts`, no tratamento de falha, antes de decidir `FAILED`:

```ts
// A dead carrier session is the one refusal a login fixes, so the request
// waits for one instead of being thrown away. The worker only claims QUEUED,
// so nothing here keeps knocking on the carrier while it waits — which
// matters, because crossing the identity provider is what burns the session.
if (getErrorCode(error) === 'FORESIGHT_SSO_EXPIRED') {
  await deps.jobStore.transitionJob({
    jobId: job.id,
    from: 'RUNNING',
    to: 'ACTION_REQUIRED',
    safeErrorCode: 'FORESIGHT_SSO_EXPIRED',
  })
  return
}
```

Em `workers/national-life/runtime.ts`, dentro da mesma `prisma.$transaction` de `complete`, logo após o `upsert` da sessão:

```ts
        // Same transaction as the connect on purpose: either the session is
        // good and the queue moves, or nothing changed. A window where the
        // session connected and the queue stayed parked is a queue nobody
        // drains.
        await transaction.browserAutomationJob.updateMany({
          where: {
            agentId: input.agentId,
            provider: NATIONAL_LIFE_PROVIDER,
            state: 'ACTION_REQUIRED',
            safeErrorCode: 'FORESIGHT_SSO_EXPIRED',
          },
          data: { state: 'QUEUED', availableAt: input.now, safeErrorCode: null },
        })
```

- [ ] **Step 4: Run the tests and the typechecker**

Run: `npx tsc --noEmit && npx vitest run`
Expected: `tsc` sem saída, suíte inteira verde.

- [ ] **Step 5: Commit**

```bash
git add workers/national-life/run-job.ts workers/national-life/run-job.test.ts workers/national-life/runtime.ts lib/national-life/illustration-pdf-status.ts lib/national-life/illustration-pdf-status.test.ts
git commit -m "park what a login would fix, and drain it when one happens"
```

---

### Task 3: O selo na barra superior

**Files:**
- Create: `app/api/agent/carrier-sync/route.ts`
- Create: `components/CarrierSyncBadge.tsx`
- Modify: `components/Shell.tsx` (as duas ocorrências de `shell-connection`, linhas ~441 e ~458)
- Test: `components/CarrierSyncBadge.test.tsx`

**Interfaces:**
- Consumes: `carrierSyncState` e `carrierSyncLabel` da Task 1; os jobs em `ACTION_REQUIRED` da Task 2.
- Produces: `<CarrierSyncBadge />`, componente cliente sem props, montado pelo `Shell` quando `role === 'AGENT'`.

- [ ] **Step 1: Write the API route**

```ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentAgent } from '@/lib/agent-context'
import { NATIONAL_LIFE_PROVIDER } from '@/lib/national-life/constants'
import { isNationalLifeConfigured } from '@/lib/national-life/env'
import { carrierSyncState } from '@/lib/national-life/carrier-sync-state'

/// What the top bar asks once, on mount. Deliberately not a poll: the badge is
/// a reassurance, not a live monitor, and a request per agent per few seconds
/// buys nothing an agent would notice.
export async function GET() {
  if (!isNationalLifeConfigured()) {
    // No integration, no badge. Not every agent connects one.
    return NextResponse.json({ state: null })
  }
  try {
    const agent = await getCurrentAgent()
    const [working, blocked] = await Promise.all([
      prisma.browserAutomationJob.count({
        where: {
          agentId: agent.id,
          provider: NATIONAL_LIFE_PROVIDER,
          state: { in: ['QUEUED', 'RUNNING', 'RETRYABLE'] },
        },
      }),
      prisma.browserAutomationJob.count({
        where: {
          agentId: agent.id,
          provider: NATIONAL_LIFE_PROVIDER,
          state: 'ACTION_REQUIRED',
        },
      }),
    ])
    return NextResponse.json({ state: carrierSyncState({ working, blocked }) })
  } catch {
    // A badge that does not know what it is saying is worse than no badge —
    // that is how the illustration reachability flag lied for hours.
    return NextResponse.json({ state: null })
  }
}
```

- [ ] **Step 2: Write the failing component test**

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { CarrierSyncBadge } from './CarrierSyncBadge'

function answerWith(state: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ state }) })),
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('CarrierSyncBadge', () => {
  it('is quiet when the account is up to date', async () => {
    answerWith({ kind: 'IN_SYNC' })
    render(<CarrierSyncBadge />)
    expect(await screen.findByText('Em dia')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('counts what is on its way, without offering an action', async () => {
    answerWith({ kind: 'WORKING', count: 2 })
    render(<CarrierSyncBadge />)
    expect(await screen.findByText('2 a caminho')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  // The only clickable state, because it is the only one that asks anything.
  it('offers the action only when something waits on the agent', async () => {
    answerWith({ kind: 'NEEDS_YOU', count: 1 })
    render(<CarrierSyncBadge />)
    expect(await screen.findByRole('button', { name: 'Precisa de você' })).toBeTruthy()
  })

  // A badge that cannot read its state renders nothing rather than guessing.
  it('renders nothing when the state is unknown', async () => {
    answerWith(null)
    const { container } = render(<CarrierSyncBadge />)
    await waitFor(() => expect(container.textContent).toBe(''))
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run components/CarrierSyncBadge.test.tsx`
Expected: FAIL — `Failed to resolve import "./CarrierSyncBadge"`.

- [ ] **Step 4: Write the component**

```tsx
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  carrierSyncLabel,
  type CarrierSyncState,
} from '@/lib/national-life/carrier-sync-state'

/// What the top bar says about the carrier.
///
/// Replaces a dot and the words "Operação conectada" that were hardcoded green
/// and read no state at all. A badge rather than a button: a permanent "Sync"
/// invites pressing, and pressing something that usually does nothing teaches
/// that it means nothing — so only the state that asks for something is
/// clickable.
export function CarrierSyncBadge() {
  const [state, setState] = useState<CarrierSyncState | null>(null)

  useEffect(() => {
    let alive = true
    fetch('/api/agent/carrier-sync')
      .then((response) => (response.ok ? response.json() : { state: null }))
      .then((body) => alive && setState(body.state ?? null))
      .catch(() => alive && setState(null))
    return () => {
      alive = false
    }
  }, [])

  if (!state) return null

  const label = carrierSyncLabel(state)
  const dot =
    state.kind === 'NEEDS_YOU'
      ? 'bg-gold'
      : state.kind === 'WORKING'
        ? 'bg-teal'
        : 'bg-success'

  if (state.kind === 'NEEDS_YOU') {
    return (
      <Link
        href="/agent/integrations/national-life"
        role="button"
        className="inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-gold"
      >
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        {label}
      </Link>
    )
  }

  return (
    <span className="shell-connection inline-flex shrink-0 items-center gap-1.5 text-xs">
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  )
}
```

- [ ] **Step 5: Mount it in the Shell**

Em `components/Shell.tsx`, importe o componente e substitua **as duas** ocorrências do bloco abaixo — elas estão em ramos diferentes do mesmo cabeçalho (com e sem título de rank), ambas hoje fixas:

```tsx
<span className="shell-connection hidden shrink-0 items-center gap-1.5 text-xs sm:flex">
  <span className="shell-connection-dot h-1.5 w-1.5 rounded-full bg-success shadow-[0_0_0_4px_oklch(0.46_0.11_155/0.1)]" />
  Operação conectada
</span>
```

por:

```tsx
{role === 'AGENT' && <CarrierSyncBadge />}
```

Note que o `hidden … sm:flex` sai junto: um estado que pede ação do agente não pode desaparecer no celular, e o `PRODUCT.md` diz que desktop e mobile são igualmente reais.

- [ ] **Step 6: Run everything**

Run: `npx tsc --noEmit && npx vitest run && npx eslint app components lib workers`
Expected: `tsc` limpo, suíte verde, eslint sem erro.

- [ ] **Step 7: Commit**

```bash
git add app/api/agent/carrier-sync components/CarrierSyncBadge.tsx components/CarrierSyncBadge.test.tsx components/Shell.tsx
git commit -m "put a badge that reads state where a green dot was painted on"
```

---

## Self-Review

**Cobertura da spec.** Selo com três estados e só um clicável (Tasks 1 e 3); posição na barra substituindo o indicador fixo, visível no celular (Task 3); login onde o agente está (Task 3, link para a integração — a modal já vive lá); fila mora na linha, sem central nova (Task 2); estacionar em `ACTION_REQUIRED` e drenar na transação do connect (Task 2); frase do tempo esperado (Task 2); selo ausente quando não há integração ou o estado falha (Task 3). Sem lacuna.

**Placeholders.** Nenhum passo sem código, nenhum "TBD", nenhum "similar à Task N".

**Consistência de tipos.** `CarrierSyncState` da Task 1 é o que a rota devolve e o componente consome na Task 3. `IllustrationPdfStatus` ganha `BLOCKED` na Task 2 e nada fora dali o consome — `illustrationPdfMessage` cobre os três casos.

**Uma coisa que a Task 3 assume:** `text-gold` e `bg-gold` existem (`--color-gold`, `app/globals.css:48`), e `bg-teal`/`bg-success` são usados no `Shell` hoje. Nenhum token novo é introduzido.

**Fora de escopo, deliberado:** o selo não atualiza sozinho depois do carregamento. Se o agente pedir um PDF e quiser ver o contador subir, ele recarrega. Polling é o próximo passo se doer, e a spec diz para não construí-lo antes disso.
