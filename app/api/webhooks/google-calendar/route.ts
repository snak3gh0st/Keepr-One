import * as Sentry from '@sentry/nextjs'
import { acceptGoogleWebhook, readGoogleWebhookHeaders } from '@/lib/calendar/google/watch'

export async function POST(request: Request) {
  try {
    const result = await acceptGoogleWebhook(readGoogleWebhookHeaders(request.headers))
    if (!result) return new Response(null, { status: 404 })
    // Push bodies contain no event data. We persist one wake-up and return fast;
    // the leased worker performs the incremental Events.list call.
    return new Response(null, { status: 204 })
  } catch (error) {
    Sentry.captureException(error)
    return new Response(null, { status: 500 })
  }
}
