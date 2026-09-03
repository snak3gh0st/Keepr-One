import { auth } from '@/lib/auth'
import { toNextJsHandler } from 'better-auth/next-js'

const authHandlers = toNextJsHandler(auth)

function isInternalAdminEndpoint(request: Request): boolean {
  const pathname = new URL(request.url).pathname
  return pathname === '/api/auth/admin' || pathname.startsWith('/api/auth/admin/')
}

function rejectInternalAdminEndpoint(): Response {
  return Response.json({ error: 'Not found' }, { status: 404 })
}

// Better Auth's admin plugin is used in-process by audited Server Actions.
// Its stock HTTP endpoints must stay private; publishing them would let an
// administrator bypass product invariants such as protected admin accounts,
// optimistic locking and the mandatory AuditLog trail.
export async function GET(request: Request): Promise<Response> {
  if (isInternalAdminEndpoint(request)) return rejectInternalAdminEndpoint()
  return authHandlers.GET(request)
}

export async function POST(request: Request): Promise<Response> {
  if (isInternalAdminEndpoint(request)) return rejectInternalAdminEndpoint()
  return authHandlers.POST(request)
}
