import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { isNationalLifeLocalConnectorEnabled, localConnectorUnavailableResponse } from '@/lib/national-life/local-connector/config'
import { LocalConnectorSignatureError, verifyLocalConnectorDeviceRequest } from '@/lib/national-life/local-connector/device-signature'
import { completeNationalLifeDocumentTransfer, NationalLifeDocumentTransferError } from '@/lib/national-life/local-connector/document-transfer-service'
import { LocalConnectorRequestError, parseJsonBody, readLimitedBody } from '@/lib/national-life/local-connector/request'
import { refuseLocalConnectorCapability } from '@/lib/national-life/local-connector/remote-config'

const NO_STORE = { 'Cache-Control': 'no-store' }
const identifier = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/)
const paramsSchema = z.strictObject({ transferId: identifier })
const bodySchema = z.strictObject({ transferId: identifier })

export async function POST(request: Request, context: { params: Promise<{ transferId: string }> }) {
  if (!isNationalLifeLocalConnectorEnabled()) return localConnectorUnavailableResponse()
  const refusal = refuseLocalConnectorCapability('READ_DOCUMENT', request.headers)
  if (refusal) return refusal
  try {
    const raw = await readLimitedBody(request, 512)
    const device = await verifyLocalConnectorDeviceRequest(prisma, {
      method: request.method,
      pathname: new URL(request.url).pathname,
      headers: request.headers,
      body: raw,
    })
    const params = paramsSchema.parse(await context.params)
    const body = bodySchema.parse(parseJsonBody(raw))
    if (params.transferId !== body.transferId) {
      return Response.json({ error: 'INVALID_REQUEST' }, { status: 400, headers: NO_STORE })
    }
    const result = await completeNationalLifeDocumentTransfer(prisma, { ...device, ...body })
    return Response.json(result, { status: result.duplicate ? 200 : 201, headers: NO_STORE })
  } catch (error) {
    if (error instanceof LocalConnectorSignatureError) {
      return Response.json({ error: 'DEVICE_REQUEST_REJECTED' }, { status: 401, headers: { ...NO_STORE, 'x-fyntra-device-error': error.code } })
    }
    if (error instanceof NationalLifeDocumentTransferError) {
      const status = error.code === 'DOCUMENT_TRANSFER_NOT_FOUND' ? 404 : error.code === 'DOCUMENT_INCOMPLETE' || error.code === 'DOCUMENT_HASH_MISMATCH' ? 409 : 400
      return Response.json({ error: error.code }, { status, headers: NO_STORE })
    }
    if (error instanceof LocalConnectorRequestError || error instanceof z.ZodError) {
      return Response.json({ error: 'INVALID_REQUEST' }, { status: 400, headers: NO_STORE })
    }
    return Response.json({ error: 'DOCUMENT_COMPLETE_FAILED' }, { status: 500, headers: NO_STORE })
  }
}
