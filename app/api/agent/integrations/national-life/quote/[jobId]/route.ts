import { getCurrentAgent } from '@/lib/agent-context'
import { getOwnedQuoteStatus } from '@/lib/national-life/job-service'

export async function GET(
  _request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  try {
    const agent = await getCurrentAgent()
    const { jobId } = await context.params
    const status = await getOwnedQuoteStatus(agent.id, jobId)

    // A job belonging to another agent already came back null, so it is
    // answered the same way as one that never existed.
    if (!status) {
      return new Response(null, {
        status: 404,
        headers: { 'Cache-Control': 'no-store' },
      })
    }

    return Response.json(status, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch {
    return new Response(null, {
      status: 404,
      headers: { 'Cache-Control': 'no-store' },
    })
  }
}
