import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import type { PlatformModuleName } from './platform-modules'

const MODULE_ACTION_FILES: ReadonlyArray<{
  path: string
  module: PlatformModuleName
}> = [
  { path: '../app/agent/calendar/actions.ts', module: 'CALENDAR' },
  { path: '../app/agent/cases/actions.ts', module: 'CRM' },
  { path: '../app/agent/cases/new/actions.ts', module: 'CRM' },
  { path: '../app/agent/cases/[id]/actions.ts', module: 'CRM' },
  { path: '../app/agent/illustrations/actions.ts', module: 'ILLUSTRATIONS' },
  { path: '../app/agent/illustrations/new/actions.ts', module: 'ILLUSTRATIONS' },
  { path: '../app/agent/policies/[id]/actions.ts', module: 'POLICIES' },
  { path: '../app/agent/agency/actions.ts', module: 'AGENCY' },
  { path: '../app/agent/integrations/national-life/actions.ts', module: 'INTEGRATIONS' },
]

describe('agent Server Action module boundaries', () => {
  it.each(MODULE_ACTION_FILES)(
    'requires $module in $path',
    async ({ path, module }) => {
      const source = await readFile(new URL(path, import.meta.url), 'utf8')
      expect(source).toMatch(
        new RegExp(`requireAgentModule\\(["']${module}["']\\)`),
      )
    },
  )

  it.each([
    '../app/agent/settings/actions.ts',
    '../app/agent/settings/credential-actions.ts',
  ])('keeps account settings outside the module gate in %s', async (path) => {
    const source = await readFile(new URL(path, import.meta.url), 'utf8')
    expect(source).not.toContain('requireAgentModule')
  })
})
