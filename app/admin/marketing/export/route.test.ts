import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ requireRole: vi.fn(), transaction: vi.fn(), count: vi.fn(), findMany: vi.fn() }))
vi.mock('@/lib/require-role', () => ({ requireRole: mocks.requireRole }))
vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: mocks.transaction } }))
import { GET } from './route'
import { marketingLeadWhere, parseLeadFilters } from '@/lib/marketing/filters'

beforeEach(() => {
  vi.resetAllMocks()
  mocks.requireRole.mockResolvedValue({ user: { id: 'admin-1' } })
  mocks.count.mockResolvedValue(0)
  mocks.findMany.mockResolvedValue([])
  mocks.transaction.mockImplementation((callback) => callback({ marketingLead: { count: mocks.count, findMany: mocks.findMany } }))
})

describe('marketing lead export', () => {
  it.each([['Not authenticated', 401], ['Forbidden: insufficient role', 403], ['Forbidden: account access is suspended', 403]])('denies %s before persistence', async (message, status) => {
    mocks.requireRole.mockRejectedValue(new Error(message as string))
    const response = await GET(new Request('http://localhost/admin/marketing/export'))
    expect(response.status).toBe(status)
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
  it('uses the same filters as the table but exports all matching pages', async () => {
    const query = new URLSearchParams('q=Ana&status=NEW&campaign=founders-program&owner=none&page=4')
    const response = await GET(new Request(`http://localhost/admin/marketing/export?${query}`))
    expect(response.status).toBe(200)
    const call = mocks.findMany.mock.calls[0][0]
    expect(call.where).toEqual(marketingLeadWhere(parseLeadFilters(query)))
    expect(call).not.toHaveProperty('skip')
    expect(call.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }])
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(response.headers.get('content-disposition')).toMatch(/attachment; filename="keepr-one-marketing-leads-/)
    const bytes = new Uint8Array(await response.arrayBuffer())
    expect([...bytes.slice(0, 3)]).toEqual([239, 187, 191])
  })
  it('fails explicitly instead of silently truncating more than 10,000 rows', async () => {
    mocks.count.mockResolvedValue(10001)
    const response = await GET(new Request('http://localhost/admin/marketing/export'))
    expect(response.status).toBe(422)
    expect((await response.json()).error).toContain('10.000')
    expect(mocks.findMany).not.toHaveBeenCalled()
  })
  it('does not expose database errors in failed downloads', async () => {
    mocks.transaction.mockRejectedValue(new Error('private connection details'))
    const response = await GET(new Request('http://localhost/admin/marketing/export'))
    expect(response.status).toBe(500)
    expect(await response.text()).not.toContain('private')
  })
})
