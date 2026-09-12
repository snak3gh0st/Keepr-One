# Central de mensagens — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A área de Mensagens passa a ser a central: os contatos do agente com um interruptor por pessoa (padrão desligado), a fila do K-Bot esperando Enviar ou Descartar, e as conversas que já existem.

**Architecture:** Um campo novo de habilitação em `KBotContactPreference` (ausência = desligado) entra como condição no gate único de envio; a lista de contatos vem do book (`Client.assignedAgentId`); a fila reaproveita `ApprovalQueue` e as server actions que já existem; `/agent/kbot/agendadas` fica só com a configuração.

**Tech Stack:** Next.js 15 (App Router, server components + server actions), Prisma/PostgreSQL, React 19, Vitest + Testing Library, i18n via `useI18n().copy(pt, en, values)`.

**Spec:** `docs/superpowers/specs/2026-09-12-central-de-mensagens-design.md`

## Global Constraints

- **Padrão desligado.** Ausência de habilitação significa desligado. Nenhuma mensagem existe para um contato que o agente nunca ligou.
- **O não do cliente sempre vence.** `optedOut` é verificado **antes** da habilitação, e a ação em massa nunca inclui quem pediu para parar.
- **Habilitação é campo novo.** `optedOut` não é invertido nem reinterpretado: ele continua significando o pedido do cliente.
- **A trava de envio continua única.** Toda decisão de enviar passa por `evaluateSendGate` (`lib/kbot-messaging/send-gate.ts`). O interruptor é mais uma condição dentro dela, nunca um caminho paralelo.
- **Envio manual do agente não é barrado pela habilitação.** O interruptor governa o que o K-Bot faz sozinho, não o que o agente faz com as próprias mãos.
- **Contato sem telefone não é oferecido**: a lista mostra o motivo em vez de aceitar um clique que vai falhar.
- **Nenhuma chamada de modelo na tela de chegada.** O exemplo é montado do texto de modelo já aprovado com o nome real do contato — token gasto para ilustrar seria cobrado do agente sem ele pedir.
- **Copy sempre em pt/en** via `copy('português', 'english', valores)`.
- **Escala real de produção:** 17.733 contatos por agente, 4.184 com telefone. Toda listagem nasce paginada e com busca.

---

### Task 1: O campo de habilitação e o gate

**Files:**
- Modify: `prisma/schema.prisma` (model `KBotContactPreference`)
- Create: `prisma/migrations/20260912170000_kbot_contact_enablement/migration.sql`
- Modify: `lib/kbot-messaging/send-gate.ts`
- Test: `lib/kbot-messaging/send-gate.test.ts`

**Interfaces:**
- Consumes: nada (primeira task).
- Produces: `ContactPreference.kbotEnabledAt?: Date | null`; `SendGateInput.requireEnabled: boolean`; nova razão de bloqueio `'NOT_ENABLED'` em `SendGateBlockReason`.

- [ ] **Step 1: Escrever os testes que falham**

Em `lib/kbot-messaging/send-gate.test.ts`, acrescente:

```ts
describe('habilitação por contato', () => {
  const base = { phone: '+5511999990000', recentJobs: [], now: new Date('2026-09-12T15:00:00.000Z') }

  it('barra o envio automático de quem nunca foi ligado', () => {
    const decision = evaluateSendGate({ ...base, preferences: [], requireEnabled: true, enforceQuietHours: false })

    expect(decision).toMatchObject({ allowed: false, reason: 'NOT_ENABLED' })
  })

  it('libera quem o agente ligou', () => {
    const decision = evaluateSendGate({
      ...base,
      preferences: [{ kbotEnabledAt: new Date('2026-09-10T00:00:00.000Z') }],
      requireEnabled: true,
      enforceQuietHours: false,
    })

    expect(decision).toMatchObject({ allowed: true, reason: null })
  })

  it('o pedido do cliente vence a habilitação do agente', () => {
    const decision = evaluateSendGate({
      ...base,
      preferences: [{ optedOut: true, kbotEnabledAt: new Date('2026-09-10T00:00:00.000Z') }],
      requireEnabled: true,
      enforceQuietHours: false,
    })

    expect(decision).toMatchObject({ allowed: false, reason: 'OPTED_OUT' })
  })

  it('não barra o envio manual do agente por falta de habilitação', () => {
    const decision = evaluateSendGate({ ...base, preferences: [], requireEnabled: false, enforceQuietHours: false })

    expect(decision).toMatchObject({ allowed: true, reason: null })
  })
})
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `npx vitest run lib/kbot-messaging/send-gate.test.ts -t "habilitação por contato"`
Expected: FAIL — `requireEnabled` não existe no tipo e nenhuma decisão devolve `NOT_ENABLED`.

- [ ] **Step 3: Implementar no gate**

Em `lib/kbot-messaging/send-gate.ts`, acrescente a razão, o campo e a condição — **depois** de `OPTED_OUT` e `SNOOZED`, que são o pedido do cliente e a pausa do agente:

```ts
export type SendGateBlockReason =
  | 'OPTED_OUT'
  | 'SNOOZED'
  | 'RECENT_CONTACT'
  | 'QUIET_HOURS'
  /// O agente nunca ligou o K-Bot para esta pessoa. Padrão desligado: ausência
  /// de habilitação é uma resposta, não um estado indefinido.
  | 'NOT_ENABLED'

export type ContactPreference = {
  optedOut?: boolean
  snoozedUntil?: Date | null
  lastManualAt?: Date | null
  /// Quando o agente ligou o K-Bot para este contato. Nulo ou ausente significa
  /// desligado — e a data existe para que "quem ligou e quando" seja auditável.
  kbotEnabledAt?: Date | null
}
```

No `SendGateInput`:

```ts
  /// Verdadeiro no que o K-Bot faz sozinho; falso quando o agente aperta enviar.
  /// O interruptor governa o robô, não as mãos do agente.
  requireEnabled: boolean
```

E dentro de `evaluateSendGate`, imediatamente após o bloco de `SNOOZED`:

```ts
  if (input.requireEnabled && !preferences.some((preference) => preference.kbotEnabledAt)) {
    return { allowed: false, reason: 'NOT_ENABLED', quietHours: null }
  }
```

- [ ] **Step 4: Rodar os testes do gate inteiro**

Run: `npx vitest run lib/kbot-messaging/send-gate.test.ts`
Expected: PASS — inclusive os casos antigos. Os chamadores ainda não compilam; é a próxima etapa.

- [ ] **Step 5: Passar `requireEnabled` em cada chamador**

Run: `grep -rn "evaluateSendGate(" --include="*.ts" lib app | grep -v "\.test\."`

Para cada ocorrência: `true` no caminho do K-Bot (`lib/kbot-messaging/scheduled-queue.ts`, e o dispatch de envio agendado), `false` onde o agente aperta enviar. Em `lib/kbot-messaging/scheduled-queue.ts:319`, o bloco fica:

```ts
  const gate = evaluateSendGate({
    phone: candidate.phone,
    preferences,
    recentJobs: recent ? [{ sentAt: now }] : [],
    now,
    // O K-Bot age sozinho aqui: sem habilitação do agente, não existe proposta.
    requireEnabled: true,
    enforceQuietHours: false,
  })
```

- [ ] **Step 6: Campo no schema e migração**

Em `prisma/schema.prisma`, no model `KBotContactPreference`, depois de `optedOut`:

```prisma
  /// Quando o agente ligou o K-Bot para este contato. Nulo é desligado — o
  /// padrão. Deliberadamente não é a inversão de `optedOut`: aquele campo é o
  /// pedido do cliente e continua significando só isso.
  kbotEnabledAt DateTime?
```

`prisma/migrations/20260912170000_kbot_contact_enablement/migration.sql`:

```sql
-- Ausência é desligado: nenhuma linha existente passa a estar ligada por esta
-- migração, que é exatamente o padrão que o produto pediu.
ALTER TABLE "KBotContactPreference" ADD COLUMN "kbotEnabledAt" TIMESTAMP(3);
```

- [ ] **Step 7: Gerar o cliente e rodar a suíte de mensageria**

Run: `npx prisma generate && npx vitest run lib/kbot-messaging lib/kbot-templates`
Expected: PASS. Se um teste de fila esperava proposta sem habilitação, ele estava documentando o padrão antigo: atualize-o para ligar o contato explicitamente e registre no comentário que o padrão agora é desligado.

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260912170000_kbot_contact_enablement lib/kbot-messaging
git commit -m "feat(kbot): habilitação por contato entra no gate único de envio"
```

---

### Task 2: Ligar, desligar e a ação em massa

**Files:**
- Create: `lib/kbot-messaging/contact-enablement.ts`
- Test: `lib/kbot-messaging/contact-enablement.test.ts`

**Interfaces:**
- Consumes: `kbotEnabledAt` (Task 1).
- Produces: `setContactEnabled(db, input): Promise<{ enabled: boolean }>` e `enableAllAgentContacts(db, input): Promise<{ enabled: number; withoutPhone: number; optedOut: number }>`, onde `db` é a interface mínima definida no módulo.

- [ ] **Step 1: Escrever os testes que falham**

`lib/kbot-messaging/contact-enablement.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { enableAllAgentContacts, setContactEnabled } from './contact-enablement'

const now = new Date('2026-09-12T15:00:00.000Z')

function db(contacts: Array<{ id: string; phone: string | null }>, optedOut: string[] = []) {
  return {
    client: { findMany: vi.fn(async () => contacts) },
    kBotContactPreference: {
      findMany: vi.fn(async () => optedOut.map((subjectKey) => ({ subjectKey, optedOut: true }))),
      upsert: vi.fn(async () => ({})),
      update: vi.fn(async () => ({})),
    },
  }
}

describe('setContactEnabled', () => {
  it('liga gravando a data, sem tocar no pedido do cliente', async () => {
    const deps = db([])

    await setContactEnabled(deps as never, { agentId: 'a1', subjectKey: 'c1', enabled: true, now })

    expect(deps.kBotContactPreference.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ agentId: 'a1', subjectKey: 'c1', kbotEnabledAt: now }),
      update: { kbotEnabledAt: now },
    }))
  })

  it('desliga limpando a data, e também sem tocar no pedido do cliente', async () => {
    const deps = db([])

    await setContactEnabled(deps as never, { agentId: 'a1', subjectKey: 'c1', enabled: false, now })

    expect(deps.kBotContactPreference.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: { kbotEnabledAt: null },
    }))
    expect(JSON.stringify(deps.kBotContactPreference.upsert.mock.calls)).not.toContain('optedOut')
  })
})

describe('enableAllAgentContacts', () => {
  it('liga só quem tem telefone e conta o resto', async () => {
    const deps = db([
      { id: 'c1', phone: '+5511999990001' },
      { id: 'c2', phone: null },
      { id: 'c3', phone: '+5511999990003' },
    ])

    const result = await enableAllAgentContacts(deps as never, { agentId: 'a1', now })

    expect(result).toEqual({ enabled: 2, withoutPhone: 1, optedOut: 0 })
    expect(deps.kBotContactPreference.upsert).toHaveBeenCalledTimes(2)
  })

  it('nunca inclui quem pediu para parar', async () => {
    const deps = db(
      [{ id: 'c1', phone: '+5511999990001' }, { id: 'c2', phone: '+5511999990002' }],
      ['c2'],
    )

    const result = await enableAllAgentContacts(deps as never, { agentId: 'a1', now })

    expect(result).toEqual({ enabled: 1, withoutPhone: 0, optedOut: 1 })
    expect(JSON.stringify(deps.kBotContactPreference.upsert.mock.calls)).not.toContain('c2')
  })
})
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `npx vitest run lib/kbot-messaging/contact-enablement.test.ts`
Expected: FAIL — `Cannot find module './contact-enablement'`.

- [ ] **Step 3: Implementar o módulo**

`lib/kbot-messaging/contact-enablement.ts`:

```ts
/// Ligar e desligar o K-Bot por pessoa.
///
/// Duas regras moram aqui e não em nenhum chamador: gravar habilitação nunca
/// toca no pedido do cliente, e a ação em massa não inclui quem pediu para
/// parar. A segunda é redundante com o gate de propósito — o gate barra de todo
/// jeito, e a contagem que o agente vê antes de confirmar precisa ser honesta.

export type ContactEnablementDb = {
  client: {
    findMany(args: unknown): Promise<Array<{ id: string; phone: string | null }>>
  }
  kBotContactPreference: {
    findMany(args: unknown): Promise<Array<{ subjectKey: string; optedOut: boolean }>>
    upsert(args: unknown): Promise<unknown>
  }
}

export async function setContactEnabled(
  db: ContactEnablementDb,
  input: { agentId: string; subjectKey: string; enabled: boolean; now: Date },
): Promise<{ enabled: boolean }> {
  const kbotEnabledAt = input.enabled ? input.now : null
  await db.kBotContactPreference.upsert({
    where: { agentId_subjectKey: { agentId: input.agentId, subjectKey: input.subjectKey } },
    create: { agentId: input.agentId, subjectKey: input.subjectKey, kbotEnabledAt },
    update: { kbotEnabledAt },
  })
  return { enabled: input.enabled }
}

export async function enableAllAgentContacts(
  db: ContactEnablementDb,
  input: { agentId: string; now: Date },
): Promise<{ enabled: number; withoutPhone: number; optedOut: number }> {
  const contacts = await db.client.findMany({
    where: { assignedAgentId: input.agentId },
    select: { id: true, phone: true },
  })
  const stopped = new Set(
    (await db.kBotContactPreference.findMany({
      where: { agentId: input.agentId, optedOut: true },
      select: { subjectKey: true, optedOut: true },
    })).map((preference) => preference.subjectKey),
  )

  let enabled = 0
  let withoutPhone = 0
  let optedOut = 0
  for (const contact of contacts) {
    if (!contact.phone) { withoutPhone += 1; continue }
    if (stopped.has(contact.id) || stopped.has(contact.phone)) { optedOut += 1; continue }
    await setContactEnabled(db, {
      agentId: input.agentId, subjectKey: contact.id, enabled: true, now: input.now,
    })
    enabled += 1
  }
  return { enabled, withoutPhone, optedOut }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run lib/kbot-messaging/contact-enablement.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add lib/kbot-messaging/contact-enablement.ts lib/kbot-messaging/contact-enablement.test.ts
git commit -m "feat(kbot): ligar e desligar o K-Bot por contato, com ação em massa honesta"
```

---

### Task 3: A lista de contatos com o interruptor

**Files:**
- Create: `lib/kbot-messaging/contact-list.ts`
- Test: `lib/kbot-messaging/contact-list.test.ts`
- Create: `app/agent/mensagens/KBotContactList.tsx`
- Test: `app/agent/mensagens/KBotContactList.test.tsx`

**Interfaces:**
- Consumes: `kbotEnabledAt` (Task 1).
- Produces: `toKBotContactRows(input): KBotContactRow[]` com `KBotContactRow = { id, name, phone, state: 'ON' | 'OFF' | 'NO_PHONE' | 'STOPPED' }`; componente `KBotContactList({ rows, onToggle })`.

- [ ] **Step 1: Escrever o teste do mapeador**

`lib/kbot-messaging/contact-list.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { toKBotContactRows } from './contact-list'

const now = new Date('2026-09-12T15:00:00.000Z')

describe('toKBotContactRows', () => {
  it('classifica cada contato pelo que decide se ele pode receber', () => {
    const rows = toKBotContactRows({
      contacts: [
        { id: 'c1', name: 'Ana Souza', phone: '+5511999990001' },
        { id: 'c2', name: 'Bruno Lima', phone: null },
        { id: 'c3', name: 'Carla Dias', phone: '+5511999990003' },
        { id: 'c4', name: 'Davi Melo', phone: '+5511999990004' },
      ],
      preferences: [
        { subjectKey: 'c1', optedOut: false, kbotEnabledAt: now },
        { subjectKey: 'c3', optedOut: true, kbotEnabledAt: now },
      ],
    })

    expect(rows.map((row) => [row.name, row.state])).toEqual([
      ['Ana Souza', 'ON'],
      ['Bruno Lima', 'NO_PHONE'],
      // Pediu para parar: vence a habilitação, e a tela não oferece interruptor.
      ['Carla Dias', 'STOPPED'],
      ['Davi Melo', 'OFF'],
    ])
  })

  it('casa preferência gravada pelo telefone, não só pelo id', () => {
    const rows = toKBotContactRows({
      contacts: [{ id: 'c1', name: 'Ana', phone: '+5511999990001' }],
      preferences: [{ subjectKey: '+5511999990001', optedOut: true, kbotEnabledAt: null }],
    })

    expect(rows[0]!.state).toBe('STOPPED')
  })
})
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `npx vitest run lib/kbot-messaging/contact-list.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar o mapeador**

`lib/kbot-messaging/contact-list.ts`:

```ts
/// A lista de contatos da central, com o único dado que o agente precisa ver
/// por linha: se o K-Bot pode cuidar desta pessoa, e quando não pode, por quê.
///
/// A preferência pode estar gravada sob o id do contato ou sob o próprio
/// número: um pedido de parada chega por telefone, não por id de cliente.

export type KBotContactState = 'ON' | 'OFF' | 'NO_PHONE' | 'STOPPED'

export type KBotContactRow = {
  id: string
  name: string
  phone: string | null
  state: KBotContactState
}

export function toKBotContactRows(input: {
  contacts: ReadonlyArray<{ id: string; name: string; phone: string | null }>
  preferences: ReadonlyArray<{ subjectKey: string; optedOut: boolean; kbotEnabledAt: Date | null }>
}): KBotContactRow[] {
  const byKey = new Map(input.preferences.map((preference) => [preference.subjectKey, preference]))
  return input.contacts.map((contact) => {
    const matches = [byKey.get(contact.id), contact.phone ? byKey.get(contact.phone) : undefined]
      .filter((value): value is NonNullable<typeof value> => Boolean(value))
    // O pedido do cliente é a primeira pergunta, sempre.
    if (matches.some((preference) => preference.optedOut)) {
      return { id: contact.id, name: contact.name, phone: contact.phone, state: 'STOPPED' as const }
    }
    if (!contact.phone) {
      return { id: contact.id, name: contact.name, phone: null, state: 'NO_PHONE' as const }
    }
    const enabled = matches.some((preference) => preference.kbotEnabledAt)
    return {
      id: contact.id, name: contact.name, phone: contact.phone,
      state: enabled ? ('ON' as const) : ('OFF' as const),
    }
  })
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run lib/kbot-messaging/contact-list.test.ts`
Expected: PASS (2 testes).

- [ ] **Step 5: Escrever o teste do componente**

`app/agent/mensagens/KBotContactList.test.tsx`:

```tsx
// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { KBotContactList } from './KBotContactList'

// Sem `globals: true` no vitest, a limpeza não é automática.
afterEach(() => cleanup())

const rows = [
  { id: 'c1', name: 'Ana Souza', phone: '+5511999990001', state: 'ON' as const },
  { id: 'c2', name: 'Bruno Lima', phone: null, state: 'NO_PHONE' as const },
  { id: 'c3', name: 'Carla Dias', phone: '+5511999990003', state: 'STOPPED' as const },
  { id: 'c4', name: 'Davi Melo', phone: '+5511999990004', state: 'OFF' as const },
]

describe('KBotContactList', () => {
  it('dá interruptor a quem pode receber e diz o estado de cada um', () => {
    render(<KBotContactList rows={rows} onToggle={vi.fn()} />)

    expect(screen.getByRole('switch', { name: /Ana Souza/ })).toBeChecked()
    expect(screen.getByRole('switch', { name: /Davi Melo/ })).not.toBeChecked()
  })

  it('não oferece interruptor a quem não tem telefone, e diz por quê', () => {
    render(<KBotContactList rows={rows} onToggle={vi.fn()} />)

    expect(screen.queryByRole('switch', { name: /Bruno Lima/ })).not.toBeInTheDocument()
    expect(screen.getByText(/sem telefone/i)).toBeInTheDocument()
  })

  it('não oferece interruptor a quem pediu para parar', () => {
    render(<KBotContactList rows={rows} onToggle={vi.fn()} />)

    expect(screen.queryByRole('switch', { name: /Carla Dias/ })).not.toBeInTheDocument()
    expect(screen.getByText(/pediu para não receber/i)).toBeInTheDocument()
  })

  it('avisa quem liga e quem desliga', () => {
    const onToggle = vi.fn()
    render(<KBotContactList rows={rows} onToggle={onToggle} />)

    screen.getByRole('switch', { name: /Davi Melo/ }).click()

    expect(onToggle).toHaveBeenCalledWith({ subjectKey: 'c4', enabled: true })
  })
})
```

- [ ] **Step 6: Rodar e confirmar a falha**

Run: `npx vitest run app/agent/mensagens/KBotContactList.test.tsx`
Expected: FAIL — componente inexistente.

- [ ] **Step 7: Implementar o componente**

`app/agent/mensagens/KBotContactList.tsx`:

```tsx
"use client"

import { useI18n } from '@/components/i18n/LanguageProvider'
import type { KBotContactRow } from '@/lib/kbot-messaging/contact-list'

export function KBotContactList({
  rows,
  onToggle,
}: {
  rows: readonly KBotContactRow[]
  onToggle: (input: { subjectKey: string; enabled: boolean }) => void
}) {
  const { copy } = useI18n()
  return (
    <ul className="divide-y divide-border-steel">
      {rows.map((row) => (
        <li key={row.id} className="flex items-center justify-between gap-3 py-3">
          <div>
            <p className="text-sm font-medium text-ink">{row.name}</p>
            {row.state === 'NO_PHONE' && (
              <p className="text-xs text-ink-muted">
                {copy('Sem telefone — o K-Bot não tem por onde falar.', 'No phone — K-Bot has no way to reach them.')}
              </p>
            )}
            {row.state === 'STOPPED' && (
              <p className="text-xs text-ink-muted">
                {copy('Pediu para não receber.', 'Asked not to be contacted.')}
              </p>
            )}
          </div>
          {(row.state === 'ON' || row.state === 'OFF') && (
            <button
              type="button"
              role="switch"
              aria-checked={row.state === 'ON'}
              aria-label={row.name}
              onClick={() => onToggle({ subjectKey: row.id, enabled: row.state === 'OFF' })}
              className="rounded-full border border-border-steel px-3 py-1 text-xs text-ink"
            >
              {row.state === 'ON' ? copy('Ligado', 'On') : copy('Desligado', 'Off')}
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}
```

- [ ] **Step 8: Rodar e ver passar**

Run: `npx vitest run app/agent/mensagens/KBotContactList.test.tsx`
Expected: PASS (4 testes).

- [ ] **Step 9: Commit**

```bash
git add lib/kbot-messaging/contact-list.ts lib/kbot-messaging/contact-list.test.ts app/agent/mensagens/KBotContactList.tsx app/agent/mensagens/KBotContactList.test.tsx
git commit -m "feat(kbot): lista de contatos da central, com o motivo de quem não pode receber"
```

---

### Task 4: A fila do K-Bot dentro de Mensagens

**Files:**
- Modify: `app/agent/mensagens/page.tsx`
- Create: `app/agent/mensagens/KBotMessageCenter.tsx`
- Test: `app/agent/mensagens/KBotMessageCenter.test.tsx`
- Modify: `app/agent/kbot/agendadas/ScheduledMessagesWorkspace.tsx` (remover a fila)
- Modify: `app/agent/kbot/agendadas/ScheduledMessagesWorkspace.test.tsx`
- Create: `app/agent/mensagens/actions.ts`

**Interfaces:**
- Consumes: `setContactEnabled` e `enableAllAgentContacts` (Task 2), `toKBotContactRows` e `KBotContactList` (Task 3).
- Produces: componente `KBotMessageCenter({ proposals, contacts, reach })` e as server actions `toggleKBotContact` e `enableAllKBotContacts`.

- [ ] **Step 1: Escrever o teste do bloco**

`app/agent/mensagens/KBotMessageCenter.test.tsx`:

```tsx
// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { KBotMessageCenter } from './KBotMessageCenter'

afterEach(() => cleanup())

const proposal = {
  jobIds: ['job-1'],
  category: 'BIRTHDAY' as const,
  customerName: 'Ana Souza',
  phone: '+5511999990001',
  language: 'PT' as const,
  content: 'Ana, feliz aniversário!',
  createdAt: '2026-09-12T12:00:00.000Z',
}

describe('KBotMessageCenter', () => {
  it('mostra a mensagem escrita esperando decisão', () => {
    render(<KBotMessageCenter proposals={[proposal]} contacts={[]} reach={{ total: 0, withPhone: 0 }} />)

    expect(screen.getByText('Ana, feliz aniversário!')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /enviar/i })).toBeInTheDocument()
  })

  it('com nada ligado, convida a ligar e diz quantos podem receber', () => {
    render(<KBotMessageCenter proposals={[]} contacts={[]} reach={{ total: 17733, withPhone: 4184 }} />)

    expect(screen.getByRole('button', { name: /ligar o k-bot para todos/i })).toBeInTheDocument()
    expect(screen.getByText(/4\.184/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `npx vitest run app/agent/mensagens/KBotMessageCenter.test.tsx`
Expected: FAIL — componente inexistente.

- [ ] **Step 3: Implementar o bloco**

Crie `app/agent/mensagens/KBotMessageCenter.tsx` compondo o que já existe: importe `ApprovalQueue` de `app/agent/kbot/agendadas` (mova o arquivo para `components/kbot/ApprovalQueue.tsx` se ele ainda estiver dentro da pasta de agendadas, atualizando os dois importadores) e a `KBotContactList` da Task 3. O bloco recebe `proposals`, `contacts` e `reach`, renderiza a fila quando há proposta, e o convite com a contagem quando não há nada ligado.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run app/agent/mensagens/KBotMessageCenter.test.tsx`
Expected: PASS (2 testes).

- [ ] **Step 5: Server actions**

`app/agent/mensagens/actions.ts`, no mesmo formato de `app/agent/kbot/agendadas/actions.ts`: `'use server'`, `assertSameOriginAction` com os headers, `getCurrentAgent()`, zod no input, chamada a `setContactEnabled` / `enableAllAgentContacts` com `prisma`, e `revalidatePath('/agent/mensagens')`.

- [ ] **Step 6: Ligar na página e tirar a fila de agendadas**

Em `app/agent/mensagens/page.tsx`, carregue no servidor: as propostas (`kBotFollowupJob` com `status: AWAITING_APPROVAL` e `category in SCHEDULED_CATEGORIES`, mapeadas por `toApprovalProposal`), os contatos paginados com as preferências (mapeados por `toKBotContactRows`), e a contagem de alcance (`total` e `withPhone`). Renderize `<KBotMessageCenter />` acima do `MessagingWorkspace`.

Em `ScheduledMessagesWorkspace.tsx`, remova o `<ApprovalQueue />` e o cabeçalho que anunciava a fila; a página fica com Modelos, Envios e Consentimento. Ajuste o teste correspondente para não esperar mais a fila ali e para afirmar que a configuração continua alcançável.

- [ ] **Step 7: Rodar as suítes tocadas**

Run: `npx vitest run app/agent/mensagens app/agent/kbot lib/kbot-messaging && npx tsc --noEmit -p tsconfig.json`
Expected: PASS e tipos limpos.

- [ ] **Step 8: Commit**

```bash
git add app/agent/mensagens app/agent/kbot/agendadas components/kbot
git commit -m "feat(kbot): a fila de mensagens passa a viver na área de Mensagens"
```

---

### Task 5: A chegada mostra o valor antes da decisão

**Files:**
- Create: `lib/kbot-messaging/arrival-example.ts`
- Test: `lib/kbot-messaging/arrival-example.test.ts`
- Modify: `app/agent/mensagens/KBotMessageCenter.tsx`
- Modify: `app/agent/mensagens/KBotMessageCenter.test.tsx`
- Modify: `app/agent/mensagens/page.tsx`

**Interfaces:**
- Consumes: `KBotContactRow` (Task 3), `KBotMessageCenter` (Task 4).
- Produces: `toArrivalExample(input): { name: string; when: string; text: string } | null`.

- [ ] **Step 1: Escrever o teste**

`lib/kbot-messaging/arrival-example.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { toArrivalExample } from './arrival-example'

const now = new Date('2026-09-12T12:00:00.000Z')

describe('toArrivalExample', () => {
  it('monta o exemplo com o contato real mais próximo do aniversário', () => {
    const example = toArrivalExample({
      now,
      templateBody: '{nome}, feliz aniversário! Que seu ano seja ótimo.',
      candidates: [
        { name: 'Ana Souza', dateOfBirth: new Date('1980-09-18T00:00:00.000Z') },
        { name: 'Bruno Lima', dateOfBirth: new Date('1975-11-02T00:00:00.000Z') },
      ],
    })

    expect(example).toEqual({
      name: 'Ana Souza',
      when: '18/09',
      text: 'Ana Souza, feliz aniversário! Que seu ano seja ótimo.',
    })
  })

  it('devolve nulo sem candidato com data — melhor nada que um exemplo inventado', () => {
    expect(toArrivalExample({ now, templateBody: '{nome}, parabéns!', candidates: [] })).toBeNull()
  })

  it('não chama modelo nenhum: o texto sai do modelo aprovado', () => {
    const example = toArrivalExample({
      now,
      templateBody: 'Oi {nome}!',
      candidates: [{ name: 'Ana', dateOfBirth: new Date('1990-09-20T00:00:00.000Z') }],
    })

    expect(example!.text).toBe('Oi Ana!')
  })
})
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `npx vitest run lib/kbot-messaging/arrival-example.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar**

```ts
/// O exemplo que a chegada mostra quando nada está ligado ainda.
///
/// Sai do texto de modelo já aprovado com o nome de um contato real — nunca de
/// uma chamada ao modelo. Gastar token do agente para ilustrar uma tela que ele
/// não pediu seria cobrar por uma demonstração.

export function toArrivalExample(input: {
  now: Date
  templateBody: string
  candidates: ReadonlyArray<{ name: string; dateOfBirth: Date | null }>
}): { name: string; when: string; text: string } | null {
  const withDate = input.candidates.filter(
    (candidate): candidate is { name: string; dateOfBirth: Date } => candidate.dateOfBirth !== null,
  )
  if (withDate.length === 0) return null

  const dayOfYear = (date: Date) => date.getUTCMonth() * 31 + date.getUTCDate()
  const today = dayOfYear(input.now)
  const next = [...withDate].sort((left, right) => {
    const distance = (candidate: { dateOfBirth: Date }) => {
      const value = dayOfYear(candidate.dateOfBirth) - today
      return value < 0 ? value + 372 : value
    }
    return distance(left) - distance(right)
  })[0]!

  const day = String(next.dateOfBirth.getUTCDate()).padStart(2, '0')
  const month = String(next.dateOfBirth.getUTCMonth() + 1).padStart(2, '0')
  return {
    name: next.name,
    when: `${day}/${month}`,
    text: input.templateBody.replaceAll('{nome}', next.name),
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run lib/kbot-messaging/arrival-example.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 5: Teste do bloco com o exemplo**

Acrescente a `KBotMessageCenter.test.tsx`:

```tsx
  it('mostra o que sairia, com nome e data reais, antes de qualquer decisão', () => {
    render(<KBotMessageCenter
      proposals={[]}
      contacts={[]}
      reach={{ total: 17733, withPhone: 4184 }}
      example={{ name: 'Ana Souza', when: '18/09', text: 'Ana Souza, feliz aniversário!' }}
    />)

    expect(screen.getByText(/Ana Souza, feliz aniversário!/)).toBeInTheDocument()
    expect(screen.getByText(/18\/09/)).toBeInTheDocument()
  })
```

- [ ] **Step 6: Rodar, confirmar a falha, implementar e ver passar**

Run: `npx vitest run app/agent/mensagens/KBotMessageCenter.test.tsx`
Expected: FAIL (prop `example` inexistente) → aceite a prop opcional no componente e renderize o exemplo dentro do convite → PASS.

- [ ] **Step 7: Ligar na página**

Em `app/agent/mensagens/page.tsx`, carregue o corpo do modelo de aniversário do agente (`kBotMessageTemplate` da categoria `BIRTHDAY` no idioma dele) e até 50 clientes com `dateOfBirth`, e passe `toArrivalExample(...)` ao bloco.

- [ ] **Step 8: Suíte inteira e lint**

Run: `npx vitest run lib/kbot-messaging app/agent/mensagens app/agent/kbot && npx eslint lib/kbot-messaging app/agent/mensagens && npx tsc --noEmit -p tsconfig.json`
Expected: PASS, sem erro de lint, tipos limpos.

- [ ] **Step 9: Commit**

```bash
git add lib/kbot-messaging/arrival-example.ts lib/kbot-messaging/arrival-example.test.ts app/agent/mensagens
git commit -m "feat(kbot): a chegada mostra o que sairia antes de o agente decidir"
```

---

## Auto-revisão feita

**Cobertura da spec:** decisão 1 (lugar) → Task 4; decisão 2 (contatos do book, com alcance) → Tasks 3 e 4; decisão 3 (padrão desligado) → Task 1; decisão 4 (ação em massa e exemplo na chegada) → Tasks 2, 4 e 5. Invariantes: os dois "nãos" → Task 1 Step 3 (ordem das condições) e Task 2 Step 1; campo novo em vez de inversão → Task 1 Step 6; trava única → Task 1 Step 5; contato sem telefone → Task 3.

**Fora do plano, de propósito** (está no "Fora de escopo" da spec): editar o texto antes de enviar, as duas ofertas de promoção da Fase 1, e começar conversa com quem nunca escreveu.

**Ponto que o executor deve decidir na hora:** se `ApprovalQueue` ainda mora em `app/agent/kbot/agendadas`, a Task 4 o move para `components/kbot/` — é o único caminho para dois consumidores sem duplicar componente.
