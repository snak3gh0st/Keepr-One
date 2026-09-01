import { z } from 'zod'
import { recordLocalConnectorAuthState } from '@/lib/national-life/local-connector/auth-notification-service'
import {
  isNationalLifeLocalConnectorEnabled,
  localConnectorUnavailableResponse,
} from '@/lib/national-life/local-connector/config'
import {
  LocalConnectorSignatureError,
  verifyLocalConnectorDeviceRequest,
} from '@/lib/national-life/local-connector/device-signature'
import { parseJsonBody, readLimitedBody } from '@/lib/national-life/local-connector/request'
import { LocalConnectorRunError } from '@/lib/national-life/local-connector/run-service'
import { prisma } from '@/lib/prisma'

const MAX_BODY_BYTES = 1_024
const NO_STORE = { 'Cache-Control': 'no-store' }
const paramsSchema = z.strictObject({
  runId: z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/),
})
const bodySchema = z.strictObject({
  state: z.enum(['REQUIRED', 'MFA_REQUIRED', 'RESTORED']),
})

export async function POST(
  request: Request,
  context: { params: Promise<{ runId: string }> },
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
    const payload = bodySchema.parse(parseJsonBody(body))
    const result = await recordLocalConnectorAuthState(prisma, {
      ...device,
      runId: params.runId,
      state: payload.state,
    })
    return Response.json(result, { status: 200, headers: NO_STORE })
  } catch (error) {
    if (error instanceof LocalConnectorSignatureError) {
      return Response.json(
        { error: 'DEVICE_REQUEST_REJECTED' },
        { status: 401, headers: { ...NO_STORE, 'x-fyntra-device-error': error.code } },
      )
    }
    if (error instanceof LocalConnectorRunError) {
      return Response.json({ error: error.code }, { status: 404, headers: NO_STORE })
    }
    return Response.json({ error: 'INVALID_REQUEST' }, { status: 400, headers: NO_STORE })
  }
}
