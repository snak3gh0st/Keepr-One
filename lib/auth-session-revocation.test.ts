import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ deleteUserSessions: vi.fn() }))

vi.mock('@/lib/auth', () => ({
  auth: {
    $context: Promise.resolve({
      internalAdapter: { deleteUserSessions: mocks.deleteUserSessions },
    }),
  },
}))

import { revokeAllAuthSessions } from './auth-session-revocation'

describe('revokeAllAuthSessions', () => {
  beforeEach(() => vi.clearAllMocks())

  it('uses Better Auth canonical revocation for DB and secondary storage', async () => {
    await revokeAllAuthSessions('user-1')

    expect(mocks.deleteUserSessions).toHaveBeenCalledOnce()
    expect(mocks.deleteUserSessions).toHaveBeenCalledWith('user-1')
  })
})
