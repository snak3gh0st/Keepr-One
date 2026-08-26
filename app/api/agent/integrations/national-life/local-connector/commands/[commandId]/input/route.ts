import { z } from 'zod'
import { ConnectorCommandError } from '@/lib/national-life/connector-command-service'
import { readDeviceConnectorCommandInput } from '@/lib/national-life/local-connector/command-dispatch-service'
import { prismaLocalConnectorCommandDispatchRepository } from '@/lib/national-life/local-connector/command-dispatch-prisma'
import {
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

const NO_STORE = { 'Cache-Control': 'no-store' }
const MAX_BODY_BYTES = 16
const emptyBody = z.strictObject({})

function commandErrorResponse(error: ConnectorCommandError): Response {
  const status = error.code === 'COMMAND_NOT_FOUND' ? 404
    : error.code === 'COMMAND_EXPIRED' ? 410
      : 400
  return Response.json({ error: error.code }, { status, headers: NO_STORE })
}

export async function POST(
  request: Request,
  context: { params: Promise<{ commandId: string }> },
) {
  if (!isNationalLifeLocalConnectorEnabled()) return localConnectorUnavailableResponse()
  try {
    const { commandId } = await context.params
    if (!/^[A-Za-z0-9._:-]{1,200}$/.test(commandId)) {
      return Response.json({ error: 'INVALID_REQUEST' }, { status: 400, headers: NO_STORE })
    }
    const body = await readLimitedBody(request, MAX_BODY_BYTES)
    const device = await verifyLocalConnectorDeviceRequest(prisma, {
      method: request.method,
      pathname: new URL(request.url).pathname,
      headers: request.headers,
      body,
    })
    emptyBody.parse(parseJsonBody(body))
    const result = await readDeviceConnectorCommandInput(
      prismaLocalConnectorCommandDispatchRepository,
      {
        async findOwnedIllustration(input) {
          return prisma.illustration.findFirst({
            where: { id: input.illustrationId, agentId: input.agentId },
            select: {
              id: true,
              caseId: true,
              createdAt: true,
              productName: true,
              rawPayload: true,
            },
          })
        },
      },
      { ...device, commandId, now: new Date() },
    )
    return Response.json(result, { status: 200, headers: NO_STORE })
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
    return Response.json({ error: 'COMMAND_INPUT_FAILED' }, { status: 500, headers: NO_STORE })
  }
}
