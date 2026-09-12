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
