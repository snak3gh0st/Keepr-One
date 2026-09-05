import { z } from 'zod'
import { getCurrentAgent } from '@/lib/agent-context'
import { featureEnabled } from '@/lib/kbot-followup/domain'
import { AI_FILTERS, AI_PERIODS } from '@/lib/kbot-ai/overview'
import { getAiOverview } from '@/lib/kbot-ai/service'

const headers = { 'Cache-Control': 'private, no-store' }
const query = z.strictObject({ period: z.enum(AI_PERIODS).default('month'), filter: z.enum(AI_FILTERS).default('all'), page: z.coerce.number().int().min(0).max(10000).default(0) })
export async function GET(request: Request) {
  try {
    const agent = await getCurrentAgent()
    const parsed = query.safeParse(Object.fromEntries(new URL(request.url).searchParams))
    if (!parsed.success) return Response.json({ error: 'INVALID_REQUEST' }, { status: 400, headers })
    if (!featureEnabled()) return Response.json({ enabled: false }, { headers })
    return Response.json(await getAiOverview(agent.id, parsed.data), { headers })
  } catch {
    return Response.json({ error: 'AI_OVERVIEW_UNAVAILABLE' }, { status: 503, headers })
  }
}
