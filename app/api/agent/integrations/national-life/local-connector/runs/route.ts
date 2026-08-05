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
  readLimitedBody,
} from '@/lib/national-life/local-connector/request'
import { startLocalConnectorRun } from '@/lib/national-life/local-connector/run-service'
import { prisma } from '@/lib/prisma'

const MAX_RUN_BODY_BYTES = 1_024
const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(request: Request) {
  if (!isNationalLifeLocalConnectorEnabled()) return localConnectorUnavailableResponse()

  try {
    const body = await readLimitedBody(request, MAX_RUN_BODY_BYTES)
    const device = await verifyLocalConnectorDeviceRequest(prisma, {
      method: request.method,
      pathname: new URL(request.url).pathname,
      headers: request.headers,
      body,
    })
    const run = await startLocalConnectorRun(prisma, device)
    return Response.json(run, { status: 201, headers: NO_STORE })
  } catch (error) {
    if (error instanceof LocalConnectorSignatureError) {
      return Response.json(
        { error: 'DEVICE_REQUEST_REJECTED' },
        { status: 401, headers: NO_STORE },
      )
    }
    if (error instanceof LocalConnectorRequestError) {
      return Response.json({ error: 'INVALID_REQUEST' }, { status: 400, headers: NO_STORE })
    }
    return Response.json({ error: 'RUN_START_FAILED' }, { status: 500, headers: NO_STORE })
  }
}
