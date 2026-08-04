import {
  isNationalLifeLocalConnectorEnabled,
  localConnectorUnavailableResponse,
} from '@/lib/national-life/local-connector/config'
import { verifyLocalConnectorDeviceRequest } from '@/lib/national-life/local-connector/device-signature'
import { readLimitedBody } from '@/lib/national-life/local-connector/request'
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
  } catch {
    return Response.json({ error: 'DEVICE_REQUEST_REJECTED' }, { status: 401, headers: NO_STORE })
  }
}
