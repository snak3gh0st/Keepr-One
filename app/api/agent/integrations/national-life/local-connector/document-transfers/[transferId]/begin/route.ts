import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { isNationalLifeLocalConnectorEnabled, localConnectorUnavailableResponse } from '@/lib/national-life/local-connector/config'
import { LocalConnectorSignatureError, verifyLocalConnectorDeviceRequest } from '@/lib/national-life/local-connector/device-signature'
import { declareNationalLifeDocumentTransfer, NationalLifeDocumentTransferError } from '@/lib/national-life/local-connector/document-transfer-service'
import { LocalConnectorRequestError, parseJsonBody, readLimitedBody } from '@/lib/national-life/local-connector/request'
import { refuseLocalConnectorCapability } from '@/lib/national-life/local-connector/remote-config'

const NO_STORE = { 'Cache-Control': 'no-store' }
const identifier = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/)
const paramsSchema = z.strictObject({ transferId: identifier })
const bodySchema = z.strictObject({
  transferId: identifier,
  contentType: z.literal('application/pdf'),
  expectedBytes: z.number().int().positive(),
  expectedSha256: z.string().regex(/^[a-f0-9]{64}$/),
})

export async function POST(request: Request, context: { params: Promise<{ transferId: string }> }) {
  if (!isNationalLifeLocalConnectorEnabled()) return localConnectorUnavailableResponse()
  const refusal = refuseLocalConnectorCapability('READ_DOCUMENT', request.headers)
  if (refusal) return refusal
  try {
    const raw = await readLimitedBody(request, 1024)
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
    const result = await declareNationalLifeDocumentTransfer(prisma, { ...device, ...body })
    return Response.json(result, { status: 200, headers: NO_STORE })
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
    return Response.json({ error: 'DOCUMENT_TRANSFER_START_FAILED' }, { status: 500, headers: NO_STORE })
  }
}
