import { z } from 'zod'
import {
  ConnectorCommandError,
} from '@/lib/national-life/connector-command-service'
import { parseConnectorCommandEvent } from '@/lib/national-life/connector-command-contract'
import {
  prismaLocalConnectorCommandDispatchRepository,
} from '@/lib/national-life/local-connector/command-dispatch-prisma'
import {
  recordDeviceConnectorCommandEvent,
} from '@/lib/national-life/local-connector/command-dispatch-service'
import {
  LOCAL_CONNECTOR_DEPLOYMENT_SCOPE,
  isNationalLifeLocalConnectorEnabled,
  localConnectorUnavailableResponse,
} from '@/lib/national-life/local-connector/config'
import {
  LocalConnectorSignatureError,
  verifyLocalConnectorDeviceRequest,
} from '@/lib/national-life/local-connector/device-signature'
import {
  LocalConnectorRequestError,
  parseJsonBody,
  readLimitedBody,
} from '@/lib/national-life/local-connector/request'
import { prisma } from '@/lib/prisma'
import { createPrismaPolicyDetailRepository } from '@/lib/national-life/policy-detail-prisma'
import { createFlexLifeQuoteResultRepository } from '@/lib/national-life/flexlife-quote-result'

const MAX_BODY_BYTES = 64 * 1024
const NO_STORE = { 'Cache-Control': 'no-store' }
const paramsSchema = z.strictObject({
  commandId: z.string().min(1).max(200).regex(/^[A-Za-z0-9._:-]+$/),
})
const policyDetailRepository = createPrismaPolicyDetailRepository(prisma)
const flexLifeQuoteRepository = createFlexLifeQuoteResultRepository(prisma)
const foresightArtifactRepository = {
  async findOwnedArtifact(input: { agentId: string; illustrationId: string }) {
    return prisma.illustration.findFirst({
      where: { id: input.illustrationId, agentId: input.agentId },
      select: {
        provider: true, externalId: true, documentBytes: true, documentMimeType: true,
      },
    })
  },
}

function commandErrorResponse(error: ConnectorCommandError): Response {
  const status = error.code === 'COMMAND_NOT_FOUND' ? 404
    : error.code === 'COMMAND_EXPIRED' ? 410
      : error.code === 'CONFIRMATION_REQUIRED' ? 409
        : 400
  return Response.json({ error: error.code }, { status, headers: NO_STORE })
}

export async function POST(
  request: Request,
  context: { params: Promise<{ commandId: string }> },
) {
  if (!isNationalLifeLocalConnectorEnabled()) return localConnectorUnavailableResponse()

  try {
    const body = await readLimitedBody(request, MAX_BODY_BYTES)
    const device = await verifyLocalConnectorDeviceRequest(prisma, {
      method: request.method,
      pathname: new URL(request.url).pathname,
      headers: request.headers,
      body,
    })
    const params = paramsSchema.parse(await context.params)
    const event = parseConnectorCommandEvent(parseJsonBody(body))
    if (!event || event.commandId !== params.commandId) {
      return Response.json({ error: 'INVALID_REQUEST' }, { status: 400, headers: NO_STORE })
    }

    await recordDeviceConnectorCommandEvent(
      prismaLocalConnectorCommandDispatchRepository,
      {
        ...device,
        commandId: params.commandId,
        event,
        now: new Date(),
        policyDetailRepository,
        foresightArtifactRepository,
        flexLifeQuoteRepository,
        deploymentScope: LOCAL_CONNECTOR_DEPLOYMENT_SCOPE,
      },
    )
    return new Response(null, { status: 204, headers: NO_STORE })
  } catch (error) {
    if (error instanceof LocalConnectorSignatureError) {
      return Response.json(
        { error: 'DEVICE_REQUEST_REJECTED' },
        { status: 401, headers: { ...NO_STORE, 'x-fyntra-device-error': error.code } },
      )
    }
    if (error instanceof ConnectorCommandError) return commandErrorResponse(error)
    if (error instanceof LocalConnectorRequestError || error instanceof z.ZodError) {
      return Response.json({ error: 'INVALID_REQUEST' }, { status: 400, headers: NO_STORE })
    }
    return Response.json({ error: 'COMMAND_EVENT_FAILED' }, { status: 500, headers: NO_STORE })
  }
}
