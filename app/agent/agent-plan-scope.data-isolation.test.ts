import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const scopedModules = [
  './page.tsx',
  './cases/page.tsx',
  './cases/actions.ts',
  './cases/[id]/page.tsx',
  './cases/[id]/actions.ts',
  './clients/page.tsx',
  './clients/[id]/page.tsx',
  './policies/page.tsx',
  './policies/[id]/page.tsx',
  './policies/[id]/actions.ts',
  './activities/page.tsx',
  './commissions/page.tsx',
] as const

describe('agent plan data isolation', () => {
  it.each(scopedModules)('%s resolves the explicit plan scope instead of raw hierarchy', (file) => {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8')

    expect(source).toMatch(/get(?:CurrentAgentAccess|AgentScopeIds)/)
    expect(source).not.toContain('getDownlineIds')
  })

  it('protects the team route with the agency capability before loading its canvas', () => {
    const source = readFileSync(new URL('./hierarchy/page.tsx', import.meta.url), 'utf8')

    expect(source).toContain('await getCurrentAgentAccess()')
    expect(source).toContain("if (!access.canManageTeam) redirect('/agent/agency')")
    expect(source).toContain('getAgencyTreeForAgent(agent.id)')
    expect(source).not.toContain('scopeAgentIds')
    expect(source).not.toContain('getUplineIds')
  })

  it.each([
    '../api/documents/[id]/route.ts',
    '../api/illustrations/[id]/document/route.ts',
  ])('%s applies the same plan scope to protected downloads', (file) => {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8')

    expect(source).toContain('getAgentScopeIds(agent.id)')
    expect(source).not.toContain('getDownlineIds')
  })

  it('does not render team or agency promotion metrics for an individual plan', () => {
    const source = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

    expect(source).toContain("const canUseTeam = hasModule('TEAM') && access.canManageTeam")
    expect(source).toContain('{canUseTeam ? (')
    expect(source).toContain('access.canViewAgencyNationalLife')
    expect(source).toContain("mode: 'individual' as const")
  })
})
