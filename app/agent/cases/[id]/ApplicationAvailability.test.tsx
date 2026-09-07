// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('@/app/agent/integrations/national-life/NationalLifeConnectorClient', () => ({ sendConnectorMessage: mocks.send }))
vi.mock('@/components/i18n/LanguageProvider', () => ({ useI18n: () => ({ copy: (_pt: string, en: string) => en }) }))
import { ApplicationAvailability, applicationAvailability, useApplicationAvailability } from './ApplicationAvailability'

const compatible = { ok: true, device: { status: 'READY' }, extensionVersion: '0.1.84', commandCapabilities: ['PREPARE_APPLICATION_DRAFT'] }
function Probe({ enabled = true }: { enabled?: boolean }) {
  const availability = useApplicationAvailability('extension-id', enabled)
  return <ApplicationAvailability availability={availability} />
}
beforeEach(() => { vi.clearAllMocks(); mocks.send.mockResolvedValue(compatible) })
afterEach(cleanup)

describe('Application availability', () => {
  it('does not infer compatibility from pairing or a version number alone', () => {
    expect(applicationAvailability({ ok: true, device: { status: 'READY' }, extensionVersion: '9.0.0' }).state).toBe('UNVERIFIED')
    expect(applicationAvailability({ ...compatible, commandCapabilities: [] }).state).toBe('UNSUPPORTED')
    expect(applicationAvailability({ ...compatible, device: { status: 'UNPAIRED' } }).state).toBe('DISCONNECTED')
  })
  it('reads installed capabilities without starting carrier work and explains the unavailable steps', async () => {
    render(<Probe />)
    expect(await screen.findByText(/Compatible extension/)).toBeVisible()
    expect(screen.getByText('Extension 0.1.84')).toBeVisible()
    expect(screen.getByText('Attach documents in iGO: not available yet.')).toBeVisible()
    expect(screen.getByText('Submit to National Life through K-Bot: not available yet.')).toBeVisible()
    expect(mocks.send).toHaveBeenCalledExactlyOnceWith('extension-id', { type: 'GET_CONNECTOR_STATUS' })
  })
  it('offers recovery after a failed probe', async () => {
    mocks.send.mockRejectedValueOnce(new Error('CONNECTOR_TIMEOUT'))
    render(<Probe />)
    expect(await screen.findByText(/Connect the extension in this browser/)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
    expect(await screen.findByText(/Compatible extension/)).toBeVisible()
  })
  it('ignores an older response when a focus refresh finishes first', async () => {
    let resolveOld!: (value: typeof compatible) => void
    mocks.send.mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve }))
    mocks.send.mockResolvedValueOnce({ ...compatible, commandCapabilities: [] })
    render(<Probe />)
    fireEvent.focus(window)
    expect(await screen.findByText(/does not support iGO preparation/)).toBeVisible()
    await act(async () => resolveOld(compatible))
    expect(screen.queryByText(/Compatible extension/)).toBeNull()
  })
  it('does not probe when preparation is disabled on the server', async () => {
    render(<Probe enabled={false} />)
    await waitFor(() => expect(screen.getByText(/Preparation currently unavailable/)).toBeVisible())
    expect(mocks.send).not.toHaveBeenCalled()
  })
})
