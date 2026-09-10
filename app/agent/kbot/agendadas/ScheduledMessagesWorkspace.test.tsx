// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  toggle: vi.fn(),
  autoSend: vi.fn(),
  consent: vi.fn(),
  approve: vi.fn(),
  discard: vi.fn(),
}))

vi.mock('./actions', () => ({
  saveScheduledTemplate: mocks.save,
  setScheduledCategoryEnabled: mocks.toggle,
  setScheduledCategoryAutoSend: mocks.autoSend,
  setContactConsent: mocks.consent,
  approveScheduledProposals: mocks.approve,
  discardScheduledProposals: mocks.discard,
}))

import { ScheduledMessagesWorkspace, type ScheduledMessagesView } from './ScheduledMessagesWorkspace'

afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  mocks.save.mockResolvedValue({ ok: true })
  mocks.toggle.mockResolvedValue({ ok: true })
  mocks.consent.mockResolvedValue({ ok: true })
  mocks.autoSend.mockResolvedValue({ ok: true })
  mocks.approve.mockResolvedValue({ ok: true, released: 1 })
  mocks.discard.mockResolvedValue({ ok: true, released: 1 })
})

const view: ScheduledMessagesView = {
  categories: [
    { category: 'BIRTHDAY', enabled: false, autoSend: false, languages: [
      { language: 'PT', body: 'Feliz aniversário, {{primeiro_nome}}! — {{agente}}', updatedAt: '2026-09-01T12:00:00.000Z' },
      { language: 'EN', body: '', updatedAt: null },
    ] },
    { category: 'ANNUAL_REVIEW', enabled: false, autoSend: false, languages: [
      { language: 'PT', body: '', updatedAt: null },
      { language: 'EN', body: '', updatedAt: null },
    ] },
  ],
  entries: [
    { id: 'j1', category: 'BIRTHDAY', customerName: 'Ana Ribeiro', phone: '+14075550100', language: 'PT',
      status: 'BLOCKED', bucket: 'BLOCKED', blockedReason: 'OPTED_OUT', content: null,
      createdAt: '2026-09-01T12:00:00.000Z', updatedAt: '2026-09-01T12:00:00.000Z' },
    { id: 'j2', category: 'BIRTHDAY', customerName: 'João Silva', phone: '+14075550101', language: 'PT',
      status: 'SENT', bucket: 'SENT', blockedReason: null, content: 'Feliz aniversário, João!',
      createdAt: '2026-09-01T12:00:00.000Z', updatedAt: '2026-09-01T12:00:00.000Z' },
  ],
  proposals: [],
  contacts: [{ subjectKey: '+14075550100', optedOut: true, snoozedUntil: null }],
  consent: [
    { id: 'e1', subjectKey: '+14075550100', action: 'OPT_OUT', source: 'WHATSAPP_REPLY',
      evidence: 'PARE', snoozedUntil: null, occurredAt: '2026-08-30T15:00:00.000Z' },
  ],
}

describe('scheduled message templates', () => {
  it('starts every category switched off and offers activation as its own act', () => {
    render(<ScheduledMessagesWorkspace view={view} />)
    expect(screen.getAllByRole('button', { name: 'Ativar categoria' })).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'Desativar categoria' })).toBeNull()
  })

  it('shows the message rendered with sample data before it is saved', () => {
    render(<ScheduledMessagesWorkspace view={view} />)
    expect(screen.getByText('Feliz aniversário, Ana! — Paulo Loureiro')).toBeInTheDocument()
  })

  it('blocks saving an unknown variable and names it instead of letting it through', async () => {
    render(<ScheduledMessagesWorkspace view={view} />)
    const editor = screen.getByLabelText('Aniversário')
    const field = editor.querySelector('textarea')!
    await userEvent.clear(field)
    // `{{` is userEvent's escape for a literal `{`, so this types `Oi {{sobrenome}}`.
    await userEvent.type(field, 'Oi {{{{sobrenome}}')
    expect(screen.getByRole('alert')).toHaveTextContent('sobrenome')
    expect(screen.getAllByRole('button', { name: 'Salvar modelo' })[0]).toBeDisabled()
    expect(mocks.save).not.toHaveBeenCalled()
  })
})

describe('what was held back', () => {
  it('leads with the reason a client did not receive the message', async () => {
    render(<ScheduledMessagesWorkspace view={view} />)
    await userEvent.click(screen.getByRole('button', { name: 'Envios' }))
    expect(screen.getByText('Por que estes clientes não receberam')).toBeInTheDocument()
    expect(screen.getAllByText('Pediu para não receber').length).toBeGreaterThan(0)
    expect(screen.getByText('Ana Ribeiro')).toBeInTheDocument()
    expect(screen.queryByText('João Silva')).toBeNull()
  })

  it('records an opt-out from the screen against the contact phone', async () => {
    render(<ScheduledMessagesWorkspace view={view} />)
    await userEvent.click(screen.getByRole('button', { name: 'Envios' }))
    await userEvent.click(screen.getByRole('button', { name: 'Permitir contato novamente' }))
    expect(mocks.consent).toHaveBeenCalledWith({ subjectKey: '+14075550100', optedOut: false })
  })

  // A stop request that arrived as a WhatsApp reply, or an opt-out made in the
  // follow-up screen, writes only the preference. The button has to read that
  // row, not the event log, or it invites the agent to opt out someone who is
  // already out.
  it('reads the current state from the preference even with no consent event', async () => {
    render(<ScheduledMessagesWorkspace view={{ ...view, consent: [] }} />)
    await userEvent.click(screen.getByRole('button', { name: 'Envios' }))
    expect(screen.getByRole('button', { name: 'Permitir contato novamente' })).toBeInTheDocument()
  })

  it('offers the opt-out for a contact with no preference row at all', async () => {
    render(<ScheduledMessagesWorkspace view={{ ...view, contacts: [] }} />)
    await userEvent.click(screen.getByRole('button', { name: 'Envios' }))
    expect(screen.getByRole('button', { name: 'Cliente pediu para não receber' })).toBeInTheDocument()
  })
})

describe('consent history', () => {
  it('shows when the person asked to stop and through which route', async () => {
    render(<ScheduledMessagesWorkspace view={view} />)
    await userEvent.click(screen.getByRole('button', { name: 'Consentimento' }))
    expect(screen.getByText('+14075550100')).toBeInTheDocument()
    expect(screen.getByText(/resposta no WhatsApp/)).toBeInTheDocument()
    expect(screen.getByText('PARE')).toBeInTheDocument()
  })
})

const proposal = (over: Partial<ScheduledMessagesView['proposals'][number]> = {}): ScheduledMessagesView['proposals'][number] => ({
  id: 'p1',
  category: 'BIRTHDAY',
  customerName: 'Ana Ribeiro',
  phone: '+14075550100',
  language: 'PT',
  // Deliberately not the sample preview text: the template editor on the same
  // screen renders that one, and a test that cannot tell them apart proves
  // nothing about the queue.
  text: 'Parabéns, Ana! Que o ano seja bom. — Paulo Loureiro',
  problem: null,
  unknown: [],
  createdAt: '2026-09-01T12:00:00.000Z',
  expiresAt: '2999-01-01T00:00:00.000Z',
  ...over,
})

describe('the queue waiting for the agent', () => {
  it('shows the exact text that will go out, with the client behind it', () => {
    render(<ScheduledMessagesWorkspace view={{ ...view, proposals: [proposal()] }} />)

    expect(screen.getByText('Parabéns, Ana! Que o ano seja bom. — Paulo Loureiro')).toBeInTheDocument()
    expect(screen.getByText(/\+14075550100/)).toBeInTheDocument()
    expect(screen.getByText('Esperando você liberar')).toBeInTheDocument()
  })

  it('releases only what was selected, and says how many actually went', async () => {
    mocks.approve.mockResolvedValue({ ok: true, released: 1 })
    render(<ScheduledMessagesWorkspace view={{ ...view, proposals: [proposal(), proposal({ id: 'p2', customerName: 'João Silva' })] }} />)

    await userEvent.click(screen.getAllByRole('checkbox')[1])
    await userEvent.click(screen.getByRole('button', { name: /Enviar selecionadas/ }))

    expect(mocks.approve).toHaveBeenCalledWith({ jobIds: ['p2'] })
    expect(await screen.findByText(/1 mensagem\(ns\) liberada\(s\)/)).toBeInTheDocument()
  })

  it('discards what the agent chose not to send', async () => {
    mocks.discard.mockResolvedValue({ ok: true, released: 1 })
    render(<ScheduledMessagesWorkspace view={{ ...view, proposals: [proposal()] }} />)

    await userEvent.click(screen.getAllByRole('checkbox')[0])
    await userEvent.click(screen.getByRole('button', { name: /Descartar selecionadas/ }))

    expect(mocks.discard).toHaveBeenCalledWith({ jobIds: ['p1'] })
  })

  it('says how long is left, because a proposal that vanishes reads as a bug', async () => {
    const expiresAt = new Date(Date.now() + 3 * 3_600_000 + 30 * 60_000).toISOString()
    render(<ScheduledMessagesWorkspace view={{ ...view, proposals: [proposal({ expiresAt })] }} />)

    expect(await screen.findByText(/Expira em 3h(29|30)/)).toBeInTheDocument()
  })

  it('says a closed window is closed instead of letting the row look alive', async () => {
    render(<ScheduledMessagesWorkspace view={{ ...view, proposals: [proposal({ expiresAt: '2020-01-01T00:00:00.000Z' })] }} />)

    expect(await screen.findByText(/Expirou/)).toBeInTheDocument()
    await userEvent.click(screen.getAllByRole('checkbox')[0])
    expect(screen.getByRole('button', { name: /Enviar selecionadas/ })).toBeDisabled()
  })

  it('never prints a raw variable, and will not let the agent release it', async () => {
    render(<ScheduledMessagesWorkspace view={{ ...view, proposals: [proposal({ text: null, problem: 'UNRENDERABLE', unknown: ['apelido'] })] }} />)

    expect(screen.queryByText(/\{\{ *apelido *\}\}/)).toBeNull()
    expect(screen.getByRole('alert')).toHaveTextContent('apelido')
    // Selecting it still offers the one decision that remains available.
    await userEvent.click(screen.getAllByRole('checkbox')[0])
    expect(screen.getByRole('button', { name: /Enviar selecionadas/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Descartar selecionadas/ })).toBeEnabled()
  })

  it('leaves a proposal whose template was switched off unreleasable', async () => {
    render(<ScheduledMessagesWorkspace view={{ ...view, proposals: [proposal({ text: null, problem: 'TEMPLATE_MISSING' })] }} />)

    expect(screen.getByRole('alert')).toHaveTextContent('desligado')
    await userEvent.click(screen.getAllByRole('checkbox')[0])
    expect(screen.getByRole('button', { name: /Enviar selecionadas/ })).toBeDisabled()
  })

  it('selects only what can actually be sent', async () => {
    render(<ScheduledMessagesWorkspace view={{ ...view, proposals: [proposal(), proposal({ id: 'p2', text: null, problem: 'TEMPLATE_MISSING' })] }} />)

    await userEvent.click(screen.getByRole('button', { name: 'Selecionar todas' }))
    await userEvent.click(screen.getByRole('button', { name: /Enviar selecionadas/ }))

    expect(mocks.approve).toHaveBeenCalledWith({ jobIds: ['p1'] })
  })

  it('stays out of the way when there is nothing to approve', () => {
    render(<ScheduledMessagesWorkspace view={view} />)
    expect(screen.queryByText('Esperando você liberar')).toBeNull()
  })
})

describe('automatic sending', () => {
  it('starts off and does not borrow the verb activation already uses', () => {
    render(<ScheduledMessagesWorkspace view={view} />)

    expect(screen.getAllByRole('button', { name: 'Ativar categoria' })).toHaveLength(2)
    const auto = screen.getAllByRole('button', { name: 'Mandar sem me perguntar' })
    expect(auto).toHaveLength(2)
    expect(auto[0]).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getAllByText(/espera você ler e liberar/)).toHaveLength(2)
  })

  it('asks again before letting a message out without anyone reading it', async () => {
    render(<ScheduledMessagesWorkspace view={view} />)

    await userEvent.click(screen.getAllByRole('button', { name: 'Mandar sem me perguntar' })[0])
    expect(mocks.autoSend).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog')).toHaveTextContent('sem passar por você')

    await userEvent.click(screen.getByRole('button', { name: 'Sim, mandar sem me perguntar' }))
    expect(mocks.autoSend).toHaveBeenCalledWith({ category: 'BIRTHDAY', autoSend: true })
  })

  it('lets the agent back out of the confirmation without changing anything', async () => {
    render(<ScheduledMessagesWorkspace view={view} />)

    await userEvent.click(screen.getAllByRole('button', { name: 'Mandar sem me perguntar' })[0])
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(mocks.autoSend).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('turns off without a second question', async () => {
    const on = { ...view, categories: view.categories.map((c, index) => index === 0 ? { ...c, autoSend: true } : c) }
    render(<ScheduledMessagesWorkspace view={on} />)

    await userEvent.click(screen.getByRole('button', { name: 'Voltar a me perguntar' }))

    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(mocks.autoSend).toHaveBeenCalledWith({ category: 'BIRTHDAY', autoSend: false })
  })
})
