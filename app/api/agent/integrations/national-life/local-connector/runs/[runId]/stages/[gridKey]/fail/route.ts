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
import {
  failLocalConnectorStage,
  LocalConnectorRunError,
} from '@/lib/national-life/local-connector/run-service'
import { NATIONAL_LIFE_GRIDS, type NationalLifeGridKey } from '@/lib/national-life/portal-grid-client'
import { prisma } from '@/lib/prisma'

const NO_STORE = { 'Cache-Control': 'no-store' }
const MAX_FAIL_BODY_BYTES = 1_024
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
  code: z.string().trim().min(1).max(80).regex(/^[A-Z0-9_]+$/),
  retryable: z.boolean(),
})

export async function POST(
  request: Request,
  context: { params: Promise<{ runId: string; gridKey: string }> },
) {
  if (!isNationalLifeLocalConnectorEnabled()) return localConnectorUnavailableResponse()
  try {
    const raw = await readLimitedBody(request, MAX_FAIL_BODY_BYTES)
    const device = await verifyLocalConnectorDeviceRequest(prisma, {
      method: request.method,
      pathname: new URL(request.url).pathname,
      headers: request.headers,
      body: raw,
    })
    const params = paramsSchema.parse(await context.params)
    const body = bodySchema.parse(parseJsonBody(raw))
    if (params.runId !== body.runId || params.gridKey !== body.gridKey) {
      return Response.json({ error: 'INVALID_REQUEST' }, { status: 400, headers: NO_STORE })
    }
    const result = await failLocalConnectorStage(prisma, {
      ...device,
      runId: body.runId,
      gridKey: body.gridKey,
      safeErrorCode: body.code,
      retryable: body.retryable,
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
    return Response.json({ error: 'STAGE_FAIL_FAILED' }, { status: 500, headers: NO_STORE })
  }
}
