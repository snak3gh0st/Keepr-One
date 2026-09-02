// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), send: vi.fn(), routerRefresh: vi.fn() }))
vi.mock('./actions', () => ({ refreshNationalLifePolicyDetail: mocks.refresh }))
vi.mock('@/app/agent/integrations/national-life/NationalLifeConnectorClient', () => ({
  sendConnectorMessage: mocks.send,
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.routerRefresh }) }))

import { NationalLifePolicyRefreshButton } from './NationalLifePolicyRefreshButton'

afterEach(cleanup)

describe('National Life policy detail refresh button', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.refresh.mockResolvedValue({ ok: true, commandId: 'cmd_1' })
    mocks.send.mockResolvedValue({
      ok: true,
      commandId: 'cmd_1',
      command: { commandId: 'cmd_1', status: 'RUNNING' },
    })
  })

  it('issues the server command and wakes the extension without blocking navigation', async () => {
    render(<NationalLifePolicyRefreshButton policyId="policy_1" extensionId="extension_1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar pela National Life' }))

    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledWith('policy_1'))
    expect(mocks.send).toHaveBeenCalledWith('extension_1', {
      type: 'START_NATIONAL_LIFE_COMMAND', commandId: 'cmd_1',
    })
    expect(await screen.findByRole('status')).toHaveTextContent('Atualização iniciada em segundo plano')
  })

  it('keeps the durable queued command when direct browser wake-up is unavailable', async () => {
    mocks.send.mockRejectedValueOnce(new Error('CONNECTOR_UNAVAILABLE'))
    render(<NationalLifePolicyRefreshButton policyId="policy_1" extensionId="extension_1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar pela National Life' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Atualização agendada')
  })
})
