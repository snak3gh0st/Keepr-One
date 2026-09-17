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

  // A orientação por linha é o que o agente vai agir. Um número sem código de
  // país pede quatro caracteres; um número quebrado pede correção; nenhum dos
  // dois pede que ele procure um telefone que já está na ficha.
  it('manda adicionar o código do país quando é só isso que falta', () => {
    render(<KBotContactList
      rows={[{ id: 'c5', name: 'Elena Rocha', phone: '(555) 123-4567', state: 'COUNTRY_REQUIRED' as const }]}
      onToggle={vi.fn()}
    />)

    expect(screen.queryByRole('switch', { name: /Elena Rocha/ })).not.toBeInTheDocument()
    expect(screen.getByText(/código do país/i)).toBeInTheDocument()
    // O erro que esta linha existe para não cometer.
    expect(screen.queryByText(/sem telefone/i)).not.toBeInTheDocument()
  })

  it('manda corrigir o número quando ele não é um telefone', () => {
    render(<KBotContactList
      rows={[{ id: 'c6', name: 'Felipe Nunes', phone: 'liga no escritório', state: 'INVALID_PHONE' as const }]}
      onToggle={vi.fn()}
    />)

    expect(screen.queryByRole('switch', { name: /Felipe Nunes/ })).not.toBeInTheDocument()
    expect(screen.getByText(/inválido/i)).toBeInTheDocument()
    expect(screen.queryByText(/sem telefone/i)).not.toBeInTheDocument()
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

    expect(onToggle).toHaveBeenCalledWith({ clientId: 'c4', enabled: true })
  })
})
