import { getCurrentAgent } from '@/lib/agent-context'
import { cancelConnectionAttempt } from '@/lib/national-life/interactive-connection-service'
import { assertSameOriginAction } from '@/lib/security/same-origin-action'

export async function POST(
  request: Request,
  context: { params: Promise<{ attemptId: string }> },
) {
  try {
    assertSameOriginAction({
      origin: request.headers.get('origin'),
      host: request.headers.get('host'),
      forwardedHost: request.headers.get('x-forwarded-host'),
      forwardedProto: request.headers.get('x-forwarded-proto'),
    })
  } catch {
    return new Response(null, {
      status: 403,
      headers: { 'Cache-Control': 'no-store' },
    })
  }

  try {
    const agent = await getCurrentAgent()
    const { attemptId } = await context.params
    await cancelConnectionAttempt({
      agentId: agent.id,
      userId: agent.userId,
      attemptId,
    })
    return new Response(null, {
      status: 204,
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch {
    return new Response(null, {
      status: 404,
      headers: { 'Cache-Control': 'no-store' },
    })
  }
}
