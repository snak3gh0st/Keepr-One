import { createHash } from 'node:crypto'
import { z } from 'zod'
import { ConnectorCommandError } from '@/lib/national-life/connector-command-service'
import { prismaLocalConnectorCommandDispatchRepository } from '@/lib/national-life/local-connector/command-dispatch-prisma'
import { readDeviceConnectorCommandInput } from '@/lib/national-life/local-connector/command-dispatch-service'
import {
  isNationalLifeLocalConnectorEnabled,
  localConnectorUnavailableResponse,
} from '@/lib/national-life/local-connector/config'
import {
  LocalConnectorSignatureError,
  verifyLocalConnectorDeviceRequest,
} from '@/lib/national-life/local-connector/device-signature'
import {
  LocalConnectorRequestError,
  readLimitedBody,
} from '@/lib/national-life/local-connector/request'
import { prisma } from '@/lib/prisma'

const NO_STORE = { 'Cache-Control': 'no-store' }
const MAX_PDF_BYTES = 25 * 1024 * 1024
const paramsSchema = z.strictObject({
  commandId: z.string().min(1).max(200).regex(/^[A-Za-z0-9._:-]+$/),
})

function commandErrorResponse(error: ConnectorCommandError): Response {
  const status = error.code === 'COMMAND_NOT_FOUND' ? 404
    : error.code === 'COMMAND_EXPIRED' ? 410
      : 400
  return Response.json({ error: error.code }, { status, headers: NO_STORE })
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ commandId: string }> },
) {
  if (!isNationalLifeLocalConnectorEnabled()) return localConnectorUnavailableResponse()
  try {
    const params = paramsSchema.parse(await context.params)
    const body = await readLimitedBody(request, MAX_PDF_BYTES)
    const device = await verifyLocalConnectorDeviceRequest(prisma, {
      method: request.method,
      pathname: new URL(request.url).pathname,
      headers: request.headers,
      body,
    })
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/pdf' ||
      body.byteLength < 5 || new TextDecoder('ascii').decode(body.subarray(0, 5)) !== '%PDF-') {
      return Response.json({ error: 'INVALID_PDF' }, { status: 400, headers: NO_STORE })
    }
    const approved = await readDeviceConnectorCommandInput(
      prismaLocalConnectorCommandDispatchRepository,
      {
        async findOwnedIllustration(input) {
          return prisma.illustration.findFirst({
            where: { id: input.illustrationId, agentId: input.agentId },
            select: {
              id: true, caseId: true, createdAt: true, productName: true, rawPayload: true,
            },
          })
        },
      },
      { ...device, commandId: params.commandId, now: new Date() },
    )
    const now = new Date()
    const documentSha256 = createHash('sha256').update(body).digest('hex')
    const updated = await prisma.illustration.updateMany({
      where: { id: approved.snapshot.illustrationId, agentId: device.agentId },
      data: {
        provider: 'NATIONAL_LIFE_FORESIGHT',
        externalId: `${device.agentId}:${approved.snapshot.carrierCaseName}`,
        sourceUpdatedAt: now,
        documentUrl: null,
        documentBytes: Buffer.from(body),
        documentMimeType: 'application/pdf',
        documentFetchedAt: now,
      },
    })
    if (updated.count !== 1) throw new ConnectorCommandError('COMMAND_NOT_FOUND')
    return Response.json({
      documentSha256,
      documentBytes: body.byteLength,
    }, { status: 200, headers: NO_STORE })
  } catch (error) {
    if (error instanceof LocalConnectorSignatureError) {
      return Response.json(
        { error: 'DEVICE_REQUEST_REJECTED' },
        { status: 401, headers: { ...NO_STORE, 'x-fyntra-device-error': error.code } },
      )
    }
    if (error instanceof ConnectorCommandError) return commandErrorResponse(error)
    if (error instanceof LocalConnectorRequestError || error instanceof z.ZodError) {
      return Response.json({ error: 'INVALID_REQUEST' }, { status: 400, headers: NO_STORE })
    }
    return Response.json({ error: 'COMMAND_ARTIFACT_FAILED' }, { status: 500, headers: NO_STORE })
  }
}
