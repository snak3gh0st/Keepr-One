import { z } from 'zod'
import { isNationalLifeLocalConnectorEnabled, localConnectorUnavailableResponse } from '@/lib/national-life/local-connector/config'
import { LocalConnectorSignatureError, verifyLocalConnectorDeviceRequest } from '@/lib/national-life/local-connector/device-signature'
import { NATIONAL_LIFE_EXPORT_CHUNK_BYTES, NationalLifeExportUploadError, putNationalLifeExportChunk } from '@/lib/national-life/local-connector/export-upload-service'
import { LocalConnectorRequestError, readLimitedBody } from '@/lib/national-life/local-connector/request'
import { refuseLocalConnectorCapability } from '@/lib/national-life/local-connector/remote-config'
import { prisma } from '@/lib/prisma'

const NO_STORE = { 'Cache-Control': 'no-store' }
const paramsSchema = z.strictObject({
  uploadId: z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/),
  sequence: z.coerce.number().int().min(0).max(10_000),
})

export async function PUT(request: Request, context: { params: Promise<{ uploadId: string; sequence: string }> }) {
  if (!isNationalLifeLocalConnectorEnabled()) return localConnectorUnavailableResponse()
  const refusal = refuseLocalConnectorCapability('READ_EXPORT', request.headers)
  if (refusal) return refusal
  try {
    const raw = await readLimitedBody(request, NATIONAL_LIFE_EXPORT_CHUNK_BYTES)
    const device = await verifyLocalConnectorDeviceRequest(prisma, {
      method: request.method,
      pathname: new URL(request.url).pathname,
      headers: request.headers,
      body: raw,
    })
    const params = paramsSchema.parse(await context.params)
    const result = await putNationalLifeExportChunk(prisma, { ...device, ...params, bytes: raw })
    return Response.json(result, { status: result.duplicate ? 200 : 201, headers: NO_STORE })
  } catch (error) {
    if (error instanceof LocalConnectorSignatureError) {
      return Response.json({ error: 'DEVICE_REQUEST_REJECTED' }, { status: 401, headers: { ...NO_STORE, 'x-fyntra-device-error': error.code } })
    }
    if (error instanceof NationalLifeExportUploadError) {
      const status = error.code === 'EXPORT_UPLOAD_NOT_FOUND' ? 404 : error.code === 'EXPORT_UPLOAD_CONFLICT' ? 409 : 400
      return Response.json({ error: error.code }, { status, headers: NO_STORE })
    }
    if (error instanceof LocalConnectorRequestError || error instanceof z.ZodError) {
      return Response.json({ error: 'INVALID_REQUEST' }, { status: 400, headers: NO_STORE })
    }
    return Response.json({ error: 'EXPORT_CHUNK_FAILED' }, { status: 500, headers: NO_STORE })
  }
}
