import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { isNationalLifeLocalConnectorEnabled, localConnectorUnavailableResponse } from '@/lib/national-life/local-connector/config'
import { LocalConnectorSignatureError, verifyLocalConnectorDeviceRequest } from '@/lib/national-life/local-connector/device-signature'
import { NATIONAL_LIFE_DOCUMENT_CHUNK_BYTES, NationalLifeDocumentTransferError, putNationalLifeDocumentChunk } from '@/lib/national-life/local-connector/document-transfer-service'
import { LocalConnectorRequestError, readLimitedBody } from '@/lib/national-life/local-connector/request'
import { refuseLocalConnectorCapability } from '@/lib/national-life/local-connector/remote-config'

const NO_STORE = { 'Cache-Control': 'no-store' }
const paramsSchema = z.strictObject({
  transferId: z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/),
  sequence: z.coerce.number().int().min(0).max(25),
})

export async function PUT(request: Request, context: { params: Promise<{ transferId: string; sequence: string }> }) {
  if (!isNationalLifeLocalConnectorEnabled()) return localConnectorUnavailableResponse()
  const refusal = refuseLocalConnectorCapability('READ_DOCUMENT', request.headers)
  if (refusal) return refusal
  try {
    const raw = await readLimitedBody(request, NATIONAL_LIFE_DOCUMENT_CHUNK_BYTES)
    const device = await verifyLocalConnectorDeviceRequest(prisma, {
      method: request.method,
      pathname: new URL(request.url).pathname,
      headers: request.headers,
      body: raw,
    })
    const params = paramsSchema.parse(await context.params)
    const result = await putNationalLifeDocumentChunk(prisma, { ...device, ...params, bytes: raw })
    return Response.json(result, { status: result.duplicate ? 200 : 201, headers: NO_STORE })
  } catch (error) {
    if (error instanceof LocalConnectorSignatureError) {
      return Response.json({ error: 'DEVICE_REQUEST_REJECTED' }, { status: 401, headers: { ...NO_STORE, 'x-fyntra-device-error': error.code } })
    }
    if (error instanceof NationalLifeDocumentTransferError) {
      const status = error.code === 'DOCUMENT_TRANSFER_NOT_FOUND' ? 404 : error.code === 'DOCUMENT_TRANSFER_CONFLICT' ? 409 : 400
      return Response.json({ error: error.code }, { status, headers: NO_STORE })
    }
    if (error instanceof LocalConnectorRequestError || error instanceof z.ZodError) {
      return Response.json({ error: 'INVALID_REQUEST' }, { status: 400, headers: NO_STORE })
    }
    return Response.json({ error: 'DOCUMENT_CHUNK_FAILED' }, { status: 500, headers: NO_STORE })
  }
}
