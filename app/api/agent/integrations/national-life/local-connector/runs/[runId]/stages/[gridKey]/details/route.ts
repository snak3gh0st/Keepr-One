import { z } from 'zod'
import {
  isNationalLifeLocalConnectorEnabled,
  localConnectorUnavailableResponse,
} from '@/lib/national-life/local-connector/config'
import {
  LocalConnectorSignatureError,
  verifyLocalConnectorDeviceRequest,
} from '@/lib/national-life/local-connector/device-signature'
import { LocalConnectorRequestError, parseJsonBody, readLimitedBody } from '@/lib/national-life/local-connector/request'
import { refuseLocalConnectorCapability } from '@/lib/national-life/local-connector/remote-config'
import { listNationalLifeCommissionEarningLinks } from '@/lib/national-life/local-connector/commission-detail-service'
import { LocalConnectorRunError } from '@/lib/national-life/local-connector/run-service'
import { NATIONAL_LIFE_GRIDS, type NationalLifeGridKey } from '@/lib/national-life/portal-grid-client'
import { prisma } from '@/lib/prisma'

const NO_STORE = { 'Cache-Control': 'no-store' }
const MAX_BODY_BYTES = 512
const gridKeySchema = z.enum(
  Object.keys(NATIONAL_LIFE_GRIDS) as [NationalLifeGridKey, ...NationalLifeGridKey[]],
)
const paramsSchema = z.strictObject({
  runId: z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/),
  gridKey: gridKeySchema,
})
const bodySchema = z.strictObject({
  runId: z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/),
  gridKey: gridKeySchema,
})

export async function POST(
  request: Request,
  context: { params: Promise<{ runId: string; gridKey: string }> },
) {
  if (!isNationalLifeLocalConnectorEnabled()) return localConnectorUnavailableResponse()
  const refusal = refuseLocalConnectorCapability('READ_GRID', request.headers)
  if (refusal) return refusal

  try {
    const raw = await readLimitedBody(request, MAX_BODY_BYTES)
    const device = await verifyLocalConnectorDeviceRequest(prisma, {
      method: request.method,
      pathname: new URL(request.url).pathname,
      headers: request.headers,
      body: raw,
    })
    const params = paramsSchema.parse(await context.params)
    const body = bodySchema.parse(parseJsonBody(raw))
    if (
      params.runId !== body.runId ||
      params.gridKey !== body.gridKey ||
      body.gridKey !== 'COMMISSIONS_EARNING_REPORT'
    ) {
      return Response.json({ error: 'INVALID_REQUEST' }, { status: 400, headers: NO_STORE })
    }
    const result = await listNationalLifeCommissionEarningLinks(prisma, {
      ...device,
      runId: body.runId,
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
    if (error instanceof LocalConnectorRequestError || error instanceof z.ZodError || error instanceof SyntaxError) {
      return Response.json({ error: 'INVALID_REQUEST' }, { status: 400, headers: NO_STORE })
    }
    return Response.json({ error: 'COMMISSION_DETAIL_LINKS_FAILED' }, { status: 500, headers: NO_STORE })
  }
}
