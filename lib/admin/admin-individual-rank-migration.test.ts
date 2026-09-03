import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL(
    '../../prisma/migrations/20260902220000_preserve_admin_individual_rank/migration.sql',
    import.meta.url,
  ),
  'utf8',
)

describe('admin individual-rank migration safety', () => {
  it('stores only professional ranks in a typed, non-null column', () => {
    expect(migration).toContain('CREATE TYPE "AgentProfessionalRank" AS ENUM')
    for (const rank of ['AGENT', 'MANAGER', 'DIRECTOR']) {
      expect(migration).toContain(`'${rank}'`)
    }
    expect(migration).not.toContain("'AGENCY_OWNER'")
    expect(migration).toContain(
      'ADD COLUMN "individualRank" "AgentProfessionalRank" NOT NULL DEFAULT \'AGENT\'',
    )
  })

  it('backfills a managed agent progression and safely defaults structural roles', () => {
    expect(migration).toContain('UPDATE "AdminProvisionedAccess" AS access')
    expect(migration).toContain('FROM "Agent" AS agent')
    expect(migration).toContain('WHERE agent."id" = access."agentId"')
    expect(migration).toContain(
      'WHEN agent."rank" = \'MANAGER\' THEN \'MANAGER\'::"AgentProfessionalRank"',
    )
    expect(migration).toContain(
      'WHEN agent."rank" = \'DIRECTOR\' THEN \'DIRECTOR\'::"AgentProfessionalRank"',
    )
    expect(migration).toContain('ELSE \'AGENT\'::"AgentProfessionalRank"')
  })

  it('does not mutate the operational Agent rank during backfill', () => {
    expect(migration).not.toMatch(/UPDATE\s+"Agent"/i)
    expect(migration).not.toMatch(/DROP\s+(?:TABLE|COLUMN|TYPE)/i)
  })
})
