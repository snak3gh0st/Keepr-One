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
import {
  completeLocalConnectorStage,
  LocalConnectorRunError,
  LocalConnectorStageCompletionError,
} from '@/lib/national-life/local-connector/run-service'
import { NATIONAL_LIFE_GRIDS, type NationalLifeGridKey } from '@/lib/national-life/portal-grid-client'
import { ingestPortfolioIfRunFinished } from '@/lib/national-life/portfolio-ingest'
import { prismaIngestDeps } from '@/lib/national-life/portfolio-ingest-prisma'
import { prisma } from '@/lib/prisma'

const NO_STORE = { 'Cache-Control': 'no-store' }
const MAX_COMPLETE_BODY_BYTES = 1_024

const paramsSchema = z.strictObject({
  runId: z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/),
  gridKey: z.enum(Object.keys(NATIONAL_LIFE_GRIDS) as [NationalLifeGridKey, ...NationalLifeGridKey[]]),
})
const bodySchema = z.strictObject({
  runId: z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/),
  gridKey: z.enum(Object.keys(NATIONAL_LIFE_GRIDS) as [NationalLifeGridKey, ...NationalLifeGridKey[]]),
  expectedRecordCount: z.number().int().min(0).max(200_000),
  finalSequence: z.number().int().min(0).max(10_000),
  truncated: z.boolean(),
})

export async function POST(
  request: Request,
  context: { params: Promise<{ runId: string; gridKey: string }> },
) {
  if (!isNationalLifeLocalConnectorEnabled()) return localConnectorUnavailableResponse()
  const refusal = refuseLocalConnectorCapability('READ_GRID', request.headers)
  if (refusal) return refusal
  try {
    const raw = await readLimitedBody(request, MAX_COMPLETE_BODY_BYTES)
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
    const result = await completeLocalConnectorStage(prisma, { ...device, ...body })
    // The book only becomes the agent's portfolio once every stage has settled:
    // running earlier would ingest a half-read export and report counts that the
    // next stage contradicts. This never throws — see `ingestPortfolioIfRunFinished`.
    const portfolio = await ingestPortfolioIfRunFinished(prismaIngestDeps(prisma), {
      agentId: device.agentId,
      // A replayed completion for an already-settled stage returns without
      // `terminal`. The ingestion ran on the original request, so the absence is
      // the answer: do not run it again.
      terminal: result.terminal === true,
    })
    return Response.json({ ...result, portfolio }, { status: 201, headers: NO_STORE })
  } catch (error) {
    if (error instanceof LocalConnectorSignatureError) {
      return Response.json(
        { error: 'DEVICE_REQUEST_REJECTED' },
        { status: 401, headers: { ...NO_STORE, 'x-fyntra-device-error': error.code } },
      )
    }
    if (error instanceof LocalConnectorStageCompletionError) {
      return Response.json({ error: error.code }, { status: 409, headers: NO_STORE })
    }
    if (error instanceof LocalConnectorRunError) {
      return Response.json({ error: error.code }, { status: 404, headers: NO_STORE })
    }
    if (error instanceof LocalConnectorRequestError || error instanceof z.ZodError || error instanceof SyntaxError) {
      return Response.json({ error: 'INVALID_REQUEST' }, { status: 400, headers: NO_STORE })
    }
    return Response.json({ error: 'STAGE_COMPLETE_FAILED' }, { status: 500, headers: NO_STORE })
  }
}
