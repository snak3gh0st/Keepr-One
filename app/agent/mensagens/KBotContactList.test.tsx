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

    expect(onToggle).toHaveBeenCalledWith({ clientId: 'c4', enabled: true })
  })
})
