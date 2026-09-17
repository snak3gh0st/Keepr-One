// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/i18n/LanguageProvider', () => ({
  useI18n: () => ({
    language: 'EN',
    locale: 'en-US',
    copy: (_pt: string, en: string, values: Record<string, string | number> = {}) =>
      en.replace(/\{(\w+)\}/g, (_match, token: string) => String(values[token] ?? `{${token}}`)),
  }),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => '/agent/cases/case-1' }))
vi.mock('next/dynamic', () => ({ default: () => () => null }))
vi.mock('@/app/agent/calendar/actions', () => ({}))
vi.mock('../actions', () => ({}))
vi.mock('./actions', () => ({}))
vi.mock('@/components/CrmNavigation', () => ({ CrmNavigation: () => null }))
vi.mock('@/components/crm/FollowUpModal', () => ({ FollowUpModal: () => null }))
vi.mock('@/components/crm/FollowUpPanel', () => ({ FollowUpPanel: () => null }))
vi.mock('@/components/calendar/CaseMeetingsSection', () => ({
  CaseMeetingsSection: () => null,
  caseMeetingCopy: () => ({}),
}))
vi.mock('./CasePipelineStageControl', () => ({ CasePipelineStageControl: () => null }))
vi.mock('./ApplicationDossier', () => ({
  ApplicationDossier: ({ application }: { application: { id: string } }) => <div>dossier {application.id}</div>,
}))

import { CaseWorkspace } from './CaseWorkspace'

type CaseData = Parameters<typeof CaseWorkspace>[0]['caseData']

function caseData(overrides: Partial<CaseData> = {}): CaseData {
  return {
    id: 'case-1',
    crmStage: null,
    crmStages: [],
    crmPipelineAvailable: false,
    readOnly: false,
    objective: null,
    productType: null,
    carrier: null,
    targetCoverage: null,
    monthlyBudget: null,
    needsAnalysis: null,
    prospect: { name: 'Ana Silva', email: null, phone: null, state: null, tobaccoStatus: null, dateOfBirth: null },
    agentName: 'Agent',
    illustrations: [],
    applications: [],
    applicationAddon: { entitled: false, status: null, canAutomate: false, offered: false },
    policies: [],
    timeline: [],
    followUps: [],
    calendar: {
      canManage: false,
      connection: null as never,
      calendars: [],
      timeZone: 'America/New_York',
      events: [],
    },
    now: '2026-09-17T12:00:00.000Z',
    ...overrides,
  }
}

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
  })
  vi.stubGlobal('IntersectionObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
})

afterEach(cleanup)

describe('CaseWorkspace Application section', () => {
  it('hides the Application section while Application is not offered', () => {
    render(<CaseWorkspace caseData={caseData()} />)

    expect(screen.queryByText(/No Application has been started/)).toBeNull()
    expect(document.getElementById('application')).toBeNull()
  })

  it('keeps an existing Application dossier visible', () => {
    render(<CaseWorkspace caseData={caseData({
      applications: [{
        id: 'app-1', createdByName: null, status: 'DRAFT', automationState: 'IDLE', dossier: null,
        dossierHash: null, reviewedAt: null, externalId: null, carrierReceipt: null, documents: [], requirements: [],
      }],
    })} />)

    expect(document.getElementById('application')).not.toBeNull()
    expect(screen.getByText('dossier app-1')).toBeTruthy()
  })
})
