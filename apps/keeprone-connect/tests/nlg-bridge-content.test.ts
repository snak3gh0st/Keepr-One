import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ capture: vi.fn() }))
vi.mock('../lib/policy-detail', async () => {
  const actual = await vi.importActual<typeof import('../lib/policy-detail')>('../lib/policy-detail')
  return { ...actual, captureNationalLifePolicyDetail: mocks.capture }
})

type MessageListener = (
  value: unknown,
  sender: unknown,
  sendResponse: (value: unknown) => void,
) => boolean | void

let listener: MessageListener | undefined
let windowMessageListener: ((event: Record<string, unknown>) => void) | undefined
const postMessage = vi.fn()

beforeEach(() => {
  vi.resetModules()
  listener = undefined
  windowMessageListener = undefined
  postMessage.mockReset()
  mocks.capture.mockReset()
  vi.stubGlobal('defineContentScript', (config: unknown) => config)
  vi.stubGlobal('location', {
    pathname: '/agent/book-of-business/inforce-book/all-clients/policy-details',
    href: `https://www.nationallife.com/agent/book-of-business/inforce-book/all-clients/policy-details?id=${'a'.repeat(32)}`,
    origin: 'https://www.nationallife.com',
  })
  vi.stubGlobal('document', {})
  vi.stubGlobal('window', {
    addEventListener: (type: string, value: (event: Record<string, unknown>) => void) => {
      if (type === 'message') windowMessageListener = value
    },
    postMessage,
  })
  vi.stubGlobal('chrome', {
    runtime: {
      onMessage: { addListener: (value: MessageListener) => { listener = value } },
      sendMessage: vi.fn(),
    },
  })
})

describe('National Life isolated-world bridge', () => {
  it('relays one correlated FlexLife quote between the extension and page worlds', async () => {
    const content = (await import('../entrypoints/nlg-bridge.content')).default as unknown as {
      main: () => void
    }
    content.main()
    const snapshot = {
      schemaVersion: 1,
      illustrationId: 'ill_quote_1',
      request: {
        IssueState: 'FL', FirstName: 'KeeprOne', LastName: 'Test', DateOfBirth: '08/26/1981',
        IssueAge: 45, Gender: 'Male', RateClass: 'Standard_NT', SolveType: 'Specify_Amount',
        Amount: 250000, DeathBenefitOption: 'A_Level', Strategy: 'SP500PointToPointCapFocus',
        Allocation: 100, ProductCode: '956', PremiumMode: 'Monthly',
      },
    }
    const request = {
      type: 'EXECUTE_FLEXLIFE_QUOTE', token: 't'.repeat(32), correlationId: 'c'.repeat(16),
      inputHash: 'a'.repeat(64), snapshot,
    }
    const responsePromise = new Promise<unknown>((resolve) => {
      expect(listener?.(request, {}, resolve)).toBe(true)
    })
    expect(postMessage).toHaveBeenCalledWith(
      { channel: 'FYNTRA_NL_CONNECTOR_V1', payload: request },
      'https://www.nationallife.com',
    )
    windowMessageListener?.({
      source: window,
      origin: 'https://www.nationallife.com',
      data: {
        channel: 'FYNTRA_NL_CONNECTOR_V1',
        payload: {
          type: 'FLEXLIFE_QUOTE_DONE', token: request.token,
          correlationId: request.correlationId, inputHash: request.inputHash,
          response: { Success: true, AnnualPremium: 5100 },
        },
      },
    })
    await expect(responsePromise).resolves.toEqual({
      ok: true, type: 'FLEXLIFE_QUOTE_RECEIVED', token: request.token,
      correlationId: request.correlationId, inputHash: request.inputHash,
      response: { Success: true, AnnualPremium: 5100 },
    })
  })

  it('returns only the typed policy detail observation for a correlated capture', async () => {
    const detail = {
      navigatePath: `/agent/book-of-business/inforce-book/all-clients/policy-details?id=${'a'.repeat(32)}`,
      expectedPolicyNumber: 'LS1473219',
      visiblePolicyNumber: 'LS1473219',
      observedAt: '2026-08-26T17:00:00.000Z',
      fields: [{ section: 'COVERAGE', label: 'Total Face Amount', value: '$100,000.00' }],
    }
    mocks.capture.mockResolvedValue(detail)
    const content = (await import('../entrypoints/nlg-bridge.content')).default as unknown as {
      main: () => void
    }
    content.main()

    const response = await new Promise<unknown>((resolve) => {
      const asynchronous = listener?.({
        type: 'CAPTURE_POLICY_DETAIL',
        expectedPolicyNumber: 'LS1473219',
        navigatePath: detail.navigatePath,
        token: 't'.repeat(32),
        correlationId: 'c'.repeat(16),
      }, {}, resolve)
      expect(asynchronous).toBe(true)
    })

    expect(response).toEqual({
      ok: true,
      type: 'POLICY_DETAIL_CAPTURED',
      token: 't'.repeat(32),
      correlationId: 'c'.repeat(16),
      detail,
    })
  })
})
