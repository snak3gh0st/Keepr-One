import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PLATFORM_MODULES_BY_PLAN,
  PLATFORM_MODULES,
  getPlatformModuleForPath,
  normalizePlatformModules,
} from './platform-modules'

describe('platform module catalog', () => {
  it('keeps TODAY as the baseline while filtering unknown and duplicate values', () => {
    expect(normalizePlatformModules(['CRM', 'CRM', 'UNKNOWN', null])).toEqual([
      'TODAY',
      'CRM',
    ])
    expect(normalizePlatformModules(undefined)).toEqual(['TODAY'])
  })

  it('keeps agency-only surfaces out of the individual defaults', () => {
    expect(DEFAULT_PLATFORM_MODULES_BY_PLAN.AGENT_INDIVIDUAL).toContain('TODAY')
    expect(DEFAULT_PLATFORM_MODULES_BY_PLAN.AGENT_INDIVIDUAL).not.toContain('AGENCY')
    expect(DEFAULT_PLATFORM_MODULES_BY_PLAN.AGENT_INDIVIDUAL).not.toContain('TEAM')
    expect(DEFAULT_PLATFORM_MODULES_BY_PLAN.AGENCY).toEqual(PLATFORM_MODULES)
  })
})

describe('getPlatformModuleForPath', () => {
  it.each([
    ['/agent', 'TODAY'],
    ['/agent/calendar', 'CALENDAR'],
    ['/agent/cases/new?source=quick-action', 'CRM'],
    ['/agent/clients/client-1', 'CRM'],
    ['/agent/activities/', 'CRM'],
    ['/agent/mensagens', 'MESSAGES'],
    ['/agent/policies/policy-1', 'POLICIES'],
    ['/agent/illustrations/new', 'ILLUSTRATIONS'],
    ['/agent/commissions', 'COMMISSIONS'],
    ['/agent/journey', 'JOURNEY'],
    ['/agent/agency', 'AGENCY'],
    ['/agent/hierarchy', 'TEAM'],
    ['/agent/integrations/google-calendar', 'INTEGRATIONS'],
    ['/api/agent/calendar/events/event-1', 'CALENDAR'],
    ['/api/agent/scheduling/page', 'CALENDAR'],
    ['/api/agent/messaging/conversations', 'MESSAGES'],
    ['/api/agent/integrations/national-life/sync', 'INTEGRATIONS'],
    ['/api/agent/notifications/read-all', 'TODAY'],
    ['/api/documents/document-1', 'POLICIES'],
    ['/api/illustrations/illustration-1/document', 'ILLUSTRATIONS'],
  ] as const)('maps %s to %s', (pathname, expected) => {
    expect(getPlatformModuleForPath(pathname)).toBe(expected)
  })

  it.each([
    '/agent/settings',
    '/api/billing/checkout',
    '/api/auth/sign-out',
    '/onboarding',
    '/agent-archive',
    '/api/agent-archive',
  ])('leaves the operational or unrelated path %s outside the module gate', (pathname) => {
    expect(getPlatformModuleForPath(pathname)).toBeNull()
  })
})
