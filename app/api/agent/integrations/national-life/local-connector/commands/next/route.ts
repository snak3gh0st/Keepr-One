import { z } from 'zod'
import { ConnectorCommandError } from '@/lib/national-life/connector-command-service'
import {
  claimNextConnectorCommand,
} from '@/lib/national-life/local-connector/command-dispatch-service'
import {
  prismaLocalConnectorCommandDispatchRepository,
} from '@/lib/national-life/local-connector/command-dispatch-prisma'
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
import { refuseLocalConnectorCapability } from '@/lib/national-life/local-connector/remote-config'
import { prisma } from '@/lib/prisma'

const MAX_BODY_BYTES = 256
const NO_STORE = { 'Cache-Control': 'no-store' }
const bodySchema = z.strictObject({
  commandId: z.string().min(1).max(200).regex(/^[A-Za-z0-9._:-]+$/).optional(),
})

function commandErrorResponse(error: ConnectorCommandError): Response {
  const status = error.code === 'COMMAND_NOT_FOUND' ? 404
    : error.code === 'COMMAND_EXPIRED' ? 410
      : error.code === 'CONFIRMATION_REQUIRED' ? 409
        : 400
  return Response.json({ error: error.code }, { status, headers: NO_STORE })
}

export async function POST(request: Request) {
  if (!isNationalLifeLocalConnectorEnabled()) return localConnectorUnavailableResponse()

  try {
    const body = await readLimitedBody(request, MAX_BODY_BYTES)
    const device = await verifyLocalConnectorDeviceRequest(prisma, {
      method: request.method,
      pathname: new URL(request.url).pathname,
      headers: request.headers,
      body,
    })
    const payload = bodySchema.parse(parseJsonBody(body))

    const dispatch = await claimNextConnectorCommand(
      prismaLocalConnectorCommandDispatchRepository,
      { ...device, ...payload, now: new Date() },
    )
    if (!dispatch) return new Response(null, { status: 204, headers: NO_STORE })

    const refusal = refuseLocalConnectorCapability(dispatch.command.capability, request.headers)
    if (refusal) return refusal
    return Response.json(dispatch, { status: 200, headers: NO_STORE })
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
    return Response.json({ error: 'COMMAND_POLL_FAILED' }, { status: 500, headers: NO_STORE })
  }
}
