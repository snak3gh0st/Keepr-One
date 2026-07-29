import { getCurrentAgent } from '@/lib/agent-context'
import { getOwnedAttemptStatus } from '@/lib/national-life/interactive-connection-service'

export async function GET(
  _request: Request,
  context: { params: Promise<{ attemptId: string }> },
) {
  try {
    const agent = await getCurrentAgent()
    const { attemptId } = await context.params
    const attempt = await getOwnedAttemptStatus(agent.id, attemptId)
    return Response.json(
      {
        id: attempt.id,
        state: attempt.state,
        currentOrigin: attempt.currentOrigin,
        safeErrorCode: attempt.safeErrorCode,
        expiresAt: attempt.expiresAt.toISOString(),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch {
    return new Response(null, {
      status: 404,
      headers: { 'Cache-Control': 'no-store' },
    })
  }
}
