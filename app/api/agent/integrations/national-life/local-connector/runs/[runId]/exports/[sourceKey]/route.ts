import { z } from 'zod'
import { isNationalLifeLocalConnectorEnabled, localConnectorUnavailableResponse } from '@/lib/national-life/local-connector/config'
import { LocalConnectorSignatureError, verifyLocalConnectorDeviceRequest } from '@/lib/national-life/local-connector/device-signature'
import { beginNationalLifeExportUpload, NationalLifeExportUploadError } from '@/lib/national-life/local-connector/export-upload-service'
import { LocalConnectorRequestError, parseJsonBody, readLimitedBody } from '@/lib/national-life/local-connector/request'
import { refuseLocalConnectorCapability } from '@/lib/national-life/local-connector/remote-config'
import { NATIONAL_LIFE_GRIDS, type NationalLifeGridKey } from '@/lib/national-life/portal-grid-client'
import { prisma } from '@/lib/prisma'

const NO_STORE = { 'Cache-Control': 'no-store' }
const MAX_BODY_BYTES = 1024
const paramsSchema = z.strictObject({
  runId: z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/),
  sourceKey: z.enum(Object.keys(NATIONAL_LIFE_GRIDS) as [NationalLifeGridKey, ...NationalLifeGridKey[]]),
})
const bodySchema = z.strictObject({
  runId: z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/),
  sourceKey: z.enum(Object.keys(NATIONAL_LIFE_GRIDS) as [NationalLifeGridKey, ...NationalLifeGridKey[]]),
  fileName: z.string().min(1).max(160),
  contentType: z.string().min(1).max(160),
  expectedBytes: z.number().int().positive(),
  expectedSha256: z.string().regex(/^[a-f0-9]{64}$/),
})

export async function POST(request: Request, context: { params: Promise<{ runId: string; sourceKey: string }> }) {
  if (!isNationalLifeLocalConnectorEnabled()) return localConnectorUnavailableResponse()
  const refusal = refuseLocalConnectorCapability('READ_EXPORT', request.headers)
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
    if (body.runId !== params.runId || body.sourceKey !== params.sourceKey) {
      return Response.json({ error: 'INVALID_REQUEST' }, { status: 400, headers: NO_STORE })
    }
    const result = await beginNationalLifeExportUpload(prisma, { ...device, ...body })
    return Response.json(result, { status: result.duplicate ? 200 : 201, headers: NO_STORE })
  } catch (error) {
    if (error instanceof LocalConnectorSignatureError) {
      return Response.json({ error: 'DEVICE_REQUEST_REJECTED' }, { status: 401, headers: { ...NO_STORE, 'x-fyntra-device-error': error.code } })
    }
    if (error instanceof NationalLifeExportUploadError) {
      const status = error.code === 'RUN_NOT_ACTIVE' ? 404 : error.code === 'EXPORT_UPLOAD_CONFLICT' ? 409 : 400
      return Response.json({ error: error.code }, { status, headers: NO_STORE })
    }
    if (error instanceof LocalConnectorRequestError || error instanceof z.ZodError) {
      return Response.json({ error: 'INVALID_REQUEST' }, { status: 400, headers: NO_STORE })
    }
    return Response.json({ error: 'EXPORT_UPLOAD_START_FAILED' }, { status: 500, headers: NO_STORE })
  }
}
