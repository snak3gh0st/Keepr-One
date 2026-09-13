import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  getCurrentAgent: vi.fn(),
  getAgentScopeIds: vi.fn(),
  findUnique: vi.fn(),
}))

vi.mock('@/lib/require-role', () => ({ requireRole: mocks.requireRole }))
vi.mock('@/lib/agent-context', () => ({ getCurrentAgent: mocks.getCurrentAgent }))
vi.mock('@/lib/agent-access', () => ({ getAgentScopeIds: mocks.getAgentScopeIds }))
vi.mock('@/lib/prisma', () => ({
  prisma: { illustration: { findUnique: mocks.findUnique } },
}))

import { GET } from './route'

const quickReview = {
  summary: {
    initialFaceAmount: 500_000, lapseYear: null, mecYear: null, modalPremium: 300,
    minimumPremium: null, deathBenefitProtectionPremium: null, targetPremium: 4_200,
    mecPremium: null, guidelineLevelPremium: null, guidelineSinglePremium: null,
  },
  annualProjection: Array.from({ length: 30 }, (_, index) => ({
    policyYear: index + 1, age: 40 + index,
    premiumOutlay: 3_600, weightedAverageInterestRate: 6.1, loan: null, annualIncome: null,
    accumulatedValue: (index + 1) * 12_000,
    cashSurrenderValue: (index + 1) * 10_000,
    netDeathBenefit: 500_000 + (index + 1) * 1_000,
  })),
}

const verified = {
  agentId: 'agent-1',
  agent: { user: { name: 'Ana Corretora' } },
  insuredName: 'Maria Silva',
  productName: '956',
  documentFetchedAt: new Date('2026-09-01T12:00:00Z'),
  documentMimeType: 'application/pdf',
  rawPayload: {
    foresightResult: {
      solveBasis: 'PREMIUM', requestedAmount: 300,
      confirmedFaceAmount: 500_000,
      confirmedMonthlyPremium: 300,
      confirmedAnnualPremium: 3_600,
      quickReview,
    },
  },
}

const request = new Request('http://localhost/api/illustrations/illustration-1/client-summary')
const params = Promise.resolve({ id: 'illustration-1' })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireRole.mockResolvedValue({ user: { role: 'AGENT' } })
  mocks.getCurrentAgent.mockResolvedValue({ id: 'agent-1' })
  mocks.getAgentScopeIds.mockResolvedValue(['agent-1'])
  mocks.findUnique.mockResolvedValue(verified)
})

describe('client summary route', () => {
  it('serves a PDF as a downloadable file for a verified illustration', async () => {
    const response = await GET(request, { params })
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/pdf')
    expect(response.headers.get('Content-Disposition'))
      .toBe('attachment; filename="Maria-Silva-proposal-summary-2026-09-01.pdf"')
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    const bytes = new Uint8Array(await response.arrayBuffer())
    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe('%PDF-')
  })

  // The condition the whole feature rests on. A client-facing document may
  // never be produced from numbers National Life has not confirmed, so these
  // three refusals are the design, not error handling.
  it('refuses an illustration whose official PDF has not arrived', async () => {
    mocks.findUnique.mockResolvedValue({ ...verified, documentFetchedAt: null })
    const response = await GET(request, { params })
    expect(response.status).toBe(404)
    expect(response.headers.get('Content-Type')).not.toBe('application/pdf')
  })

  it('refuses an illustration with no verified carrier result', async () => {
    mocks.findUnique.mockResolvedValue({
      ...verified, rawPayload: { foresightRequest: { faceAmount: 500_000 } },
    })
    expect((await GET(request, { params })).status).toBe(404)
  })

  it('serves Term from the four numbers and the duration the carrier confirmed', async () => {
    mocks.findUnique.mockResolvedValue({
      ...verified,
      insuredName: 'Ale Teste',
      productName: 'NL Term',
      rawPayload: {
        foresightTermResult: {
          source: 'OFFICIAL_PDF', premiumMode: 'Monthly',
          confirmedFaceAmount: 500_000,
          confirmedMonthlyPremium: 62.92,
          confirmedAnnualPremium: 755.04,
          requestedTermDuration: '20-G',
          confirmedTermDuration: '20-G',
        },
      },
    })
    const response = await GET(request, { params })
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/pdf')
  })

  it('refuses a Term result that never recorded the confirmed duration', async () => {
    mocks.findUnique.mockResolvedValue({
      ...verified,
      productName: 'NL Term',
      rawPayload: {
        foresightTermResult: {
          source: 'OFFICIAL_PDF', premiumMode: 'Monthly',
          confirmedFaceAmount: 500_000,
          confirmedMonthlyPremium: 62.92,
          confirmedAnnualPremium: 755.04,
        },
      },
    })
    expect((await GET(request, { params })).status).toBe(404)
  })

  it('refuses an agent outside the scope that owns the illustration', async () => {
    mocks.getAgentScopeIds.mockResolvedValue(['agent-2'])
    const response = await GET(request, { params })
    expect(response.status).toBe(403)
    expect(response.headers.get('Content-Type')).not.toBe('application/pdf')
  })

  it('lets an admin read any agent’s summary', async () => {
    mocks.requireRole.mockResolvedValue({ user: { role: 'ADMIN' } })
    expect((await GET(request, { params })).status).toBe(200)
    expect(mocks.getAgentScopeIds).not.toHaveBeenCalled()
  })

  it('refuses an unauthenticated caller', async () => {
    mocks.requireRole.mockRejectedValue(new Error('nope'))
    expect((await GET(request, { params })).status).toBe(401)
  })

  it('is a 404, not a crash, for an illustration that does not exist', async () => {
    mocks.findUnique.mockResolvedValue(null)
    expect((await GET(request, { params })).status).toBe(404)
  })
})

describe('variant and language', () => {
  it('serves the five-page presentation when asked for the full variant', async () => {
    const response = await GET(
      new Request('http://localhost/x?variant=full'), { params })
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Disposition'))
      .toContain('Maria-Silva-proposal-presentation-2026-09-01.pdf')
  })

  // A stale link or a hand-typed URL should hand the agent the safe, shorter
  // document rather than an error page in front of a client.
  it('falls back to the one-pager for an unknown variant', async () => {
    const response = await GET(
      new Request('http://localhost/x?variant=deluxe'), { params })
    expect(response.headers.get('Content-Disposition')).toContain('proposal-summary')
  })

  it('renders in Portuguese when asked', async () => {
    const response = await GET(new Request('http://localhost/x?lang=pt'), { params })
    expect(response.status).toBe(200)
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(1024)
  })

  // An admin pulling a copy must not put their own name on a client's plan.
  it('names the owning agent as the advisor, whoever downloads it', async () => {
    mocks.requireRole.mockResolvedValue({ user: { role: 'ADMIN' } })
    const response = await GET(
      new Request('http://localhost/x?variant=full'), { params })
    expect(response.status).toBe(200)
    const selected = mocks.findUnique.mock.calls[0]?.[0]?.select
    expect(selected?.agent).toBeTruthy()
  })
})
