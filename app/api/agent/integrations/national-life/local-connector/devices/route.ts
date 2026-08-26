import { getCurrentAgentWithoutOnboarding } from '@/lib/agent-context'
import {
  isNationalLifeLocalConnectorEnabled,
  localConnectorUnavailableResponse,
} from '@/lib/national-life/local-connector/config'
import { listLocalConnectorDevices } from '@/lib/national-life/local-connector/device-service'
import { prisma } from '@/lib/prisma'
import { assertSameOriginAction } from '@/lib/security/same-origin-action'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function GET(request: Request) {
  if (!isNationalLifeLocalConnectorEnabled()) return localConnectorUnavailableResponse()

  try {
    assertSameOriginAction({
      origin: request.headers.get('origin'),
      host: request.headers.get('host'),
      forwardedHost: request.headers.get('x-forwarded-host'),
      forwardedProto: request.headers.get('x-forwarded-proto'),
    })
    const agent = await getCurrentAgentWithoutOnboarding()
    const devices = await listLocalConnectorDevices(prisma, { agentId: agent.id })
    return Response.json({ devices }, { status: 200, headers: NO_STORE })
  } catch {
    return Response.json({ error: 'DEVICES_NOT_AVAILABLE' }, { status: 403, headers: NO_STORE })
  }
}
