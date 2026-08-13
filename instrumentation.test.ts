import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureRequestError: vi.fn(),
}))
vi.mock('./sentry.server.config', () => ({}))
vi.mock('./sentry.edge.config', () => ({}))

const ORIGINAL_RUNTIME = process.env.NEXT_RUNTIME
const ORIGINAL_INTERVAL = process.env.NATIONAL_LIFE_JANITOR_INTERVAL_SECONDS
const ORIGINAL_CRM_INTERVAL = process.env.CRM_FOLLOW_UP_INTERVAL_SECONDS

afterEach(async () => {
  const { stopLocalConnectorJanitor } = await import(
    './lib/national-life/local-connector/janitor-scheduler'
  )
  stopLocalConnectorJanitor()
  const { stopFollowUpNotificationScheduler } = await import(
    './lib/crm/follow-up-notification-scheduler'
  )
  stopFollowUpNotificationScheduler()
  const { stopGoogleCalendarScheduler } = await import(
    './lib/calendar/google/scheduler'
  )
  stopGoogleCalendarScheduler()
  if (ORIGINAL_RUNTIME === undefined) delete process.env.NEXT_RUNTIME
  else process.env.NEXT_RUNTIME = ORIGINAL_RUNTIME
  if (ORIGINAL_INTERVAL === undefined) delete process.env.NATIONAL_LIFE_JANITOR_INTERVAL_SECONDS
  else process.env.NATIONAL_LIFE_JANITOR_INTERVAL_SECONDS = ORIGINAL_INTERVAL
  if (ORIGINAL_CRM_INTERVAL === undefined) delete process.env.CRM_FOLLOW_UP_INTERVAL_SECONDS
  else process.env.CRM_FOLLOW_UP_INTERVAL_SECONDS = ORIGINAL_CRM_INTERVAL
  vi.clearAllMocks()
})

describe('server boot', () => {
  it('does not fail to boot when the janitor interval is misconfigured', async () => {
    process.env.NEXT_RUNTIME = 'nodejs'
    process.env.NATIONAL_LIFE_JANITOR_INTERVAL_SECONDS = '15m'

    const { register } = await import('./instrumentation')
    const Sentry = await import('@sentry/nextjs')

    // Um valor digitado errado numa variável de varredura não pode derrubar o
    // servidor: o healthcheck do Dockerfile transformaria isso em deploy falho,
    // e o app deixaria de servir por causa de uma tarefa de fundo.
    await expect(register()).resolves.toBeUndefined()
    expect(Sentry.captureException).toHaveBeenCalledTimes(1)
  })

  it('boots clean with a valid interval', async () => {
    process.env.NEXT_RUNTIME = 'nodejs'
    process.env.NATIONAL_LIFE_JANITOR_INTERVAL_SECONDS = '900'

    const { register } = await import('./instrumentation')
    const Sentry = await import('@sentry/nextjs')

    await expect(register()).resolves.toBeUndefined()
    expect(Sentry.captureException).not.toHaveBeenCalled()
  })

  it('does not fail to boot when the CRM reminder interval is misconfigured', async () => {
    process.env.NEXT_RUNTIME = 'nodejs'
    process.env.NATIONAL_LIFE_JANITOR_INTERVAL_SECONDS = '900'
    process.env.CRM_FOLLOW_UP_INTERVAL_SECONDS = 'instant'

    const { register } = await import('./instrumentation')
    const Sentry = await import('@sentry/nextjs')

    await expect(register()).resolves.toBeUndefined()
    expect(Sentry.captureException).toHaveBeenCalledTimes(1)
  })
})
