// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  toggle: vi.fn(),
  enableAll: vi.fn(),
}))

vi.mock('./actions', () => ({
  toggleKBotContact: mocks.toggle,
  enableAllKBotContacts: mocks.enableAll,
}))

import { KBotMessageCenter } from './KBotMessageCenter'

afterEach(() => cleanup())
beforeEach(() => {
  vi.clearAllMocks()
  mocks.toggle.mockResolvedValue({ ok: true })
  mocks.enableAll.mockResolvedValue({ ok: true, enabled: 3, withoutPhone: 1, optedOut: 0 })
})

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

const someContacts = [
  { id: 'c1', name: 'Ana Souza', phone: '+5511999990001', state: 'OFF' as const },
  { id: 'c2', name: 'Bruno Lima', phone: '+5511999990002', state: 'OFF' as const },
]

// O convite "ligar para todos" tem que olhar o agente inteiro
// (`reach.enabledCount`), não as linhas que aconteceram de carregar na
// página em tela — uma tela de 25 contatos não sabe se algum dos outros
// 17 mil já está ligado.
describe('KBotMessageCenter — o convite olha o agente inteiro, não a página', () => {
  it('com enabledCount 0, convida mesmo havendo contatos na página', () => {
    render(<KBotMessageCenter
      proposals={[]}
      contacts={someContacts}
      reach={{ total: 100, withPhone: 50, enabledCount: 0 }}
    />)

    expect(screen.getByRole('button', { name: /ligar o k-bot para todos/i })).toBeInTheDocument()
  })

  // Este é exatamente o caso que passaria sob o gate antigo (olhar só as
  // linhas em tela): nenhum contato da página está 'ON', mas o agente já
  // ligou 12 em outra página. O convite não pode aparecer aqui.
  it('com enabledCount 12, não convida mesmo que nenhum contato da página esteja ligado', () => {
    render(<KBotMessageCenter
      proposals={[]}
      contacts={someContacts}
      reach={{ total: 100, withPhone: 50, enabledCount: 12 }}
    />)

    expect(screen.queryByRole('button', { name: /ligar o k-bot para todos/i })).not.toBeInTheDocument()
  })
})

// A contagem que a tela mostrava antes do clique ("X têm telefone e podem
// receber") também precisa ser honesta depois: quantos foram de fato
// ligados, quantos não tinham telefone e quantos pediram para não receber
// e ficaram de fora. Uma frase fixa depois do clique jogaria fora
// exatamente a informação que `enableAllKBotContacts` calculou para isso.
describe('KBotMessageCenter — a contagem depois de ligar para todos é honesta', () => {
  it('mostra os números reais devolvidos pela ação, não uma frase fixa', async () => {
    mocks.enableAll.mockResolvedValue({ ok: true, enabled: 3, withoutPhone: 1, optedOut: 2 })
    render(<KBotMessageCenter
      proposals={[]}
      contacts={someContacts}
      reach={{ total: 100, withPhone: 50, enabledCount: 0 }}
    />)

    await userEvent.click(screen.getByRole('button', { name: /ligar o k-bot para todos/i }))

    expect(await screen.findByText(/3 contato\(s\) ligado\(s\)/)).toBeInTheDocument()
    expect(screen.getByText(/1 sem telefone/)).toBeInTheDocument()
    expect(screen.getByText(/2 que pediram para não receber/)).toBeInTheDocument()
  })
})

describe('KBotMessageCenter — o exemplo mostra valor antes da decisão', () => {
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
})
