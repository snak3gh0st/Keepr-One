// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ send: vi.fn(), prepare: vi.fn(), refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock('@/components/i18n/LanguageProvider', () => ({ useI18n: () => ({ locale: 'en-US', copy: (_pt: string, en: string) => en }) }))
vi.mock('@/app/agent/integrations/national-life/NationalLifeConnectorClient', () => ({ sendConnectorMessage: mocks.send }))
vi.mock('./actions', () => ({ prepareKBotApplicationDraft: mocks.prepare, reviewKBotApplicationDocument: vi.fn(), reviewKBotApplicationDossier: vi.fn(), saveKBotApplicationDossier: vi.fn(), uploadKBotApplicationDocument: vi.fn() }))
import { ApplicationDossier } from './ApplicationDossier'
const props = {
  application: { id: 'app-test', createdByName: 'Demo', automationState: 'READY_TO_PREPARE', dossier: {}, dossierHash: 'hash', reviewedAt: null, externalId: null, carrierReceipt: {}, documents: [] },
  addon: { entitled: true, status: 'ACTIVE', canAutomate: true, extensionTarget: 'extension-id', preparationEnabled: true, offered: true },
  prospect: { name: 'Demo Person', email: null, phone: null, state: null, dateOfBirth: null }, illustrations: [],
}
beforeEach(() => { vi.clearAllMocks(); mocks.prepare.mockResolvedValue({ ok: true }) })
afterEach(cleanup)
describe('ApplicationDossier preparation', () => {
  it('blocks preparation when the installed extension has no capability metadata', async () => {
    mocks.send.mockResolvedValue({ ok: true, device: { status: 'READY' } })
    render(<ApplicationDossier {...props} />)
    await screen.findByText(/Compatibility unconfirmed/)
    expect(screen.getByRole('button', { name: 'Prepare draft in iGO' })).toBeDisabled()
    expect(mocks.prepare).not.toHaveBeenCalled()
  })
  it('never offers to sell the add-on while the feature is switched off', async () => {
    mocks.send.mockResolvedValue({ ok: true, device: { status: 'READY' }, commandCapabilities: ['PREPARE_APPLICATION_DRAFT'] })
    render(<ApplicationDossier {...props} addon={{ ...props.addon, entitled: false, canAutomate: false, offered: false }} />)
    expect(screen.queryByRole('button', { name: 'Activate Application' })).toBeNull()
    expect(screen.queryByText(/12.99/)).toBeNull()
    expect(screen.getByText(/not being offered right now/)).toBeVisible()
  })
  it('still sells the add-on to an agent who lacks it while the feature is open', async () => {
    mocks.send.mockResolvedValue({ ok: true, device: { status: 'READY' }, commandCapabilities: ['PREPARE_APPLICATION_DRAFT'] })
    render(<ApplicationDossier {...props} addon={{ ...props.addon, entitled: false, canAutomate: false, offered: true }} />)
    expect(screen.getByRole('button', { name: 'Activate Application' })).toBeVisible()
    expect(screen.getByText(/12.99/)).toBeVisible()
  })
  it('requires an explicit click and describes authorization as queued work', async () => {
    mocks.send.mockResolvedValue({ ok: true, device: { status: 'READY' }, commandCapabilities: ['PREPARE_APPLICATION_DRAFT'] })
    render(<ApplicationDossier {...props} />)
    const button = screen.getByRole('button', { name: 'Prepare draft in iGO' })
    await waitFor(() => expect(button).toBeEnabled())
    expect(mocks.prepare).not.toHaveBeenCalled()
    await userEvent.click(button)
    expect(await screen.findByText(/Preparation authorized. K-Bot will wait/)).toBeVisible()
    expect(mocks.prepare).toHaveBeenCalledExactlyOnceWith('app-test')
  })
})
