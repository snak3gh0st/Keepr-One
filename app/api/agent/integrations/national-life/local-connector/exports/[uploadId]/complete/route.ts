import { z } from 'zod'
import { isNationalLifeLocalConnectorEnabled, localConnectorUnavailableResponse } from '@/lib/national-life/local-connector/config'
import { LocalConnectorSignatureError, verifyLocalConnectorDeviceRequest } from '@/lib/national-life/local-connector/device-signature'
import { completeNationalLifeExportUpload, NationalLifeExportUploadError } from '@/lib/national-life/local-connector/export-upload-service'
import { NationalLifeExportWorkbookError } from '@/lib/national-life/local-connector/export-workbook'
import { LocalConnectorRequestError, parseJsonBody, readLimitedBody } from '@/lib/national-life/local-connector/request'
import { refuseLocalConnectorCapability } from '@/lib/national-life/local-connector/remote-config'
import { LocalConnectorRunError, LocalConnectorStageCompletionError } from '@/lib/national-life/local-connector/run-service'
import { ingestPortfolioIfRunFinished } from '@/lib/national-life/portfolio-ingest'
import { prismaIngestDeps } from '@/lib/national-life/portfolio-ingest-prisma'
import { prisma } from '@/lib/prisma'

const NO_STORE = { 'Cache-Control': 'no-store' }
const MAX_BODY_BYTES = 256
const paramsSchema = z.strictObject({ uploadId: z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/) })
const bodySchema = z.strictObject({ uploadId: z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/) })

export async function POST(request: Request, context: { params: Promise<{ uploadId: string }> }) {
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
    if (params.uploadId !== body.uploadId) {
      return Response.json({ error: 'INVALID_REQUEST' }, { status: 400, headers: NO_STORE })
    }
    const result = await completeNationalLifeExportUpload(prisma, { ...device, uploadId: body.uploadId })
    const portfolio = await ingestPortfolioIfRunFinished(prismaIngestDeps(prisma), {
      agentId: device.agentId,
      // A completed upload replay has no terminal flag. The original terminal
      // request already attempted promotion, so this remains a no-op.
      terminal: 'terminal' in result && result.terminal === true,
    })
    return Response.json(
      { ...result, portfolio },
      { status: result.duplicate ? 200 : 201, headers: NO_STORE },
    )
  } catch (error) {
    if (error instanceof LocalConnectorSignatureError) {
      return Response.json({ error: 'DEVICE_REQUEST_REJECTED' }, { status: 401, headers: { ...NO_STORE, 'x-fyntra-device-error': error.code } })
    }
    if (error instanceof NationalLifeExportUploadError) {
      const status = error.code === 'EXPORT_UPLOAD_NOT_FOUND' ? 404 : error.code === 'EXPORT_INCOMPLETE' || error.code === 'EXPORT_HASH_MISMATCH' ? 409 : 400
      return Response.json({ error: error.code }, { status, headers: NO_STORE })
    }
    if (error instanceof NationalLifeExportWorkbookError) {
      return Response.json({ error: error.code }, { status: 422, headers: NO_STORE })
    }
    if (error instanceof LocalConnectorStageCompletionError) {
      return Response.json({ error: error.code }, { status: 409, headers: NO_STORE })
    }
    if (error instanceof LocalConnectorRunError) {
      return Response.json({ error: error.code }, { status: 404, headers: NO_STORE })
    }
    if (error instanceof LocalConnectorRequestError || error instanceof z.ZodError) {
      return Response.json({ error: 'INVALID_REQUEST' }, { status: 400, headers: NO_STORE })
    }
    return Response.json({ error: 'EXPORT_COMPLETE_FAILED' }, { status: 500, headers: NO_STORE })
  }
}
