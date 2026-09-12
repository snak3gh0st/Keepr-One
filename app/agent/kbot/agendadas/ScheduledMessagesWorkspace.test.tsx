// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  toggle: vi.fn(),
  autoSend: vi.fn(),
  consent: vi.fn(),
}))

vi.mock('./actions', () => ({
  saveScheduledTemplate: mocks.save,
  setScheduledCategoryEnabled: mocks.toggle,
  setScheduledCategoryAutoSend: mocks.autoSend,
  setContactConsent: mocks.consent,
}))

import { ScheduledMessagesWorkspace, type ScheduledMessagesView } from './ScheduledMessagesWorkspace'

afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  mocks.save.mockResolvedValue({ ok: true })
  mocks.toggle.mockResolvedValue({ ok: true })
  mocks.consent.mockResolvedValue({ ok: true })
  mocks.autoSend.mockResolvedValue({ ok: true })
})

const view: ScheduledMessagesView = {
  categories: [
    { category: 'BIRTHDAY', enabled: false, autoSend: false, canAutoSend: true, languages: [
      { language: 'PT', body: 'Feliz aniversário, {{primeiro_nome}}! — {{agente}}', updatedAt: '2026-09-01T12:00:00.000Z' },
      { language: 'EN', body: '', updatedAt: null },
    ] },
    { category: 'ANNUAL_REVIEW', enabled: false, autoSend: false, canAutoSend: false, languages: [
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

// A fila de aprovação mudou de casa (agora vive em /agent/mensagens), então
// este componente nunca mais renderiza "Esperando você liberar". O que fica
// aqui é configuração: Modelos, Envios e Consentimento continuam alcançáveis.
describe('a configuração continua alcançável depois que a fila saiu daqui', () => {
  it('nunca renderiza a fila de aprovação', () => {
    render(<ScheduledMessagesWorkspace view={view} />)
    expect(screen.queryByText('Esperando você liberar')).toBeNull()
  })

  it('mantém as três áreas de configuração navegáveis', async () => {
    render(<ScheduledMessagesWorkspace view={view} />)
    expect(screen.getByRole('button', { name: 'Modelos' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Envios' }))
    expect(screen.getByText('Por que estes clientes não receberam')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Consentimento' }))
    expect(screen.getByText('+14075550100')).toBeInTheDocument()
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

  // A migration deu a todo agente uma linha ligada com `body` nulo em cada
  // categoria. Se o botão só olhasse a existência da linha, bastaria um clique
  // para o modelo escrever sobre um lapso e a mensagem sair sem ninguém ler.
  it('does not offer automatic sending for a category the K-Bot still writes', async () => {
    render(<ScheduledMessagesWorkspace view={view} />)

    const auto = screen.getAllByRole('button', { name: 'Mandar sem me perguntar' })
    expect(auto[1]).toBeDisabled()
    expect(screen.getByText(/Só depois de salvar o texto desta categoria/)).toBeInTheDocument()

    await userEvent.click(auto[1])
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(mocks.autoSend).not.toHaveBeenCalled()
  })

  // Texto digitado e não salvo é texto que ninguém aprovou: o botão lê a
  // verdade do servidor, não a caixa de edição.
  it('stays closed while the text is only typed, never saved', async () => {
    render(<ScheduledMessagesWorkspace view={view} />)

    const editors = screen.getAllByRole('textbox')
    await userEvent.type(editors[1], 'Oi {{primeiro_nome}}')

    expect(screen.getAllByRole('button', { name: 'Mandar sem me perguntar' })[1]).toBeDisabled()
  })

  // A forma comum depois da migration: idioma do agente com texto salvo, o outro
  // sem linha nenhuma, automático ligado. A frase promete que a mensagem espera
  // leitura — e com o automático ligado ela não espera, ela sai.
  it('never promises the message waits for a category that sends on its own', () => {
    const auto = {
      ...view,
      categories: view.categories.map((c, index) => index === 0 ? { ...c, enabled: true, autoSend: true } : c),
    }
    render(<ScheduledMessagesWorkspace view={auto} />)

    expect(screen.queryByText(/espera você ler antes de sair/)).toBeNull()
  })

  it('still says who writes the text while the category waits for the agent', () => {
    const waiting = {
      ...view,
      categories: view.categories.map((c, index) => index === 0 ? { ...c, enabled: true } : c),
    }
    render(<ScheduledMessagesWorkspace view={waiting} />)

    expect(screen.getByText(/espera você ler antes de sair/)).toBeInTheDocument()
  })

  it('turns off without a second question', async () => {
    const on = { ...view, categories: view.categories.map((c, index) => index === 0 ? { ...c, autoSend: true } : c) }
    render(<ScheduledMessagesWorkspace view={on} />)

    await userEvent.click(screen.getByRole('button', { name: 'Voltar a me perguntar' }))

    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(mocks.autoSend).toHaveBeenCalledWith({ category: 'BIRTHDAY', autoSend: false })
  })
})
