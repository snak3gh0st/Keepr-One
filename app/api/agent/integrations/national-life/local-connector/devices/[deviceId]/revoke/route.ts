import { z } from 'zod'
import { getCurrentAgentWithoutOnboarding } from '@/lib/agent-context'
import {
  isNationalLifeLocalConnectorEnabled,
  localConnectorUnavailableResponse,
} from '@/lib/national-life/local-connector/config'
import {
  LocalConnectorDeviceError,
  revokeLocalConnectorDevice,
} from '@/lib/national-life/local-connector/device-service'
import { prisma } from '@/lib/prisma'
import { assertSameOriginAction } from '@/lib/security/same-origin-action'

const NO_STORE = { 'Cache-Control': 'no-store' }
const paramsSchema = z.strictObject({
  deviceId: z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/),
})

export async function POST(
  request: Request,
  context: { params: Promise<{ deviceId: string }> },
) {
  if (!isNationalLifeLocalConnectorEnabled()) return localConnectorUnavailableResponse()

  try {
    assertSameOriginAction({
      origin: request.headers.get('origin'),
      host: request.headers.get('host'),
      forwardedHost: request.headers.get('x-forwarded-host'),
      forwardedProto: request.headers.get('x-forwarded-proto'),
    })
    const agent = await getCurrentAgentWithoutOnboarding()
    const params = paramsSchema.parse(await context.params)
    const result = await revokeLocalConnectorDevice(prisma, {
      agentId: agent.id,
      deviceId: params.deviceId,
    })
    return Response.json(result, { status: 200, headers: NO_STORE })
  } catch (error) {
    if (error instanceof LocalConnectorDeviceError) {
      return Response.json({ error: error.code }, { status: 404, headers: NO_STORE })
    }
    return Response.json({ error: 'REVOKE_NOT_AVAILABLE' }, { status: 403, headers: NO_STORE })
  }
}
