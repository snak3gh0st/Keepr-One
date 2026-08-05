import { z } from 'zod'
import {
  isNationalLifeLocalConnectorEnabled,
  localConnectorUnavailableResponse,
} from '@/lib/national-life/local-connector/config'
import {
  LOCAL_CONNECTOR_MAX_BODY_BYTES,
  localConnectorRawStageEnvelopeSchema,
} from '@/lib/national-life/local-connector/contracts'
import {
  NATIONAL_LIFE_GRIDS,
  type NationalLifeGridKey,
} from '@/lib/national-life/portal-grid-client'
import {
  LocalConnectorSignatureError,
  sha256Hex,
  verifyLocalConnectorDeviceRequest,
} from '@/lib/national-life/local-connector/device-signature'
import {
  parseJsonBody,
  readLimitedBody,
} from '@/lib/national-life/local-connector/request'
import {
  ingestLocalConnectorStage,
  LocalConnectorRunError,
} from '@/lib/national-life/local-connector/run-service'
import { prisma } from '@/lib/prisma'

const NO_STORE = { 'Cache-Control': 'no-store' }
const idempotencyKeySchema = z.string().min(16).max(160).regex(/^[A-Za-z0-9._:-]+$/)
const routeParamsSchema = z.strictObject({
  runId: z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/),
  // The URL segment is validated against the server's own grid catalogue, and
  // the envelope's gridKey is cross-checked against it below, so neither the
  // path nor the body is authoritative on its own.
  gridKey: z.enum(
    Object.keys(NATIONAL_LIFE_GRIDS) as [NationalLifeGridKey, ...NationalLifeGridKey[]],
  ),
})

export async function PUT(
  request: Request,
  context: { params: Promise<{ runId: string; gridKey: string }> },
) {
  if (!isNationalLifeLocalConnectorEnabled()) return localConnectorUnavailableResponse()

  try {
    const body = await readLimitedBody(request, LOCAL_CONNECTOR_MAX_BODY_BYTES)
    const device = await verifyLocalConnectorDeviceRequest(prisma, {
      method: request.method,
      pathname: new URL(request.url).pathname,
      headers: request.headers,
      body,
    })
    const params = routeParamsSchema.parse(await context.params)
    const envelope = localConnectorRawStageEnvelopeSchema.parse(parseJsonBody(body))
    if (envelope.runId !== params.runId || envelope.gridKey !== params.gridKey) {
      return Response.json({ error: 'INVALID_ENVELOPE' }, { status: 400, headers: NO_STORE })
    }
    const idempotencyKey = idempotencyKeySchema.parse(
      request.headers.get('x-idempotency-key'),
    )
    const result = await ingestLocalConnectorStage(prisma, {
      ...device,
      gridKey: params.gridKey,
      idempotencyKey,
      contentHash: sha256Hex(body),
      envelope,
    })
    return Response.json(result, { status: result.duplicate ? 200 : 201, headers: NO_STORE })
  } catch (error) {
    if (error instanceof LocalConnectorSignatureError) {
      return Response.json(
        { error: 'DEVICE_REQUEST_REJECTED' },
        { status: 401, headers: NO_STORE },
      )
    }
    if (error instanceof LocalConnectorRunError) {
      const status = error.code === 'IDEMPOTENCY_CONFLICT' ? 409 : 404
      return Response.json({ error: error.code }, { status, headers: NO_STORE })
    }
    return Response.json({ error: 'INVALID_ENVELOPE' }, { status: 400, headers: NO_STORE })
  }
}
