import { getCurrentAgentWithoutOnboarding } from '@/lib/agent-context'
import {
  isNationalLifeLocalConnectorEnabled,
  localConnectorUnavailableResponse,
} from '@/lib/national-life/local-connector/config'
import { createLocalConnectorPairing } from '@/lib/national-life/local-connector/pairing'
import { prisma } from '@/lib/prisma'
import { assertSameOriginAction } from '@/lib/security/same-origin-action'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(request: Request) {
  if (!isNationalLifeLocalConnectorEnabled()) return localConnectorUnavailableResponse()

  try {
    assertSameOriginAction({
      origin: request.headers.get('origin'),
      host: request.headers.get('host'),
      forwardedHost: request.headers.get('x-forwarded-host'),
      forwardedProto: request.headers.get('x-forwarded-proto'),
    })
    const agent = await getCurrentAgentWithoutOnboarding()
    const pairing = await createLocalConnectorPairing(prisma, { agentId: agent.id })
    return Response.json(
      { code: pairing.code, expiresAt: pairing.expiresAt.toISOString() },
      { status: 201, headers: NO_STORE },
    )
  } catch {
    return Response.json({ error: 'PAIRING_NOT_AVAILABLE' }, { status: 403, headers: NO_STORE })
  }
}
