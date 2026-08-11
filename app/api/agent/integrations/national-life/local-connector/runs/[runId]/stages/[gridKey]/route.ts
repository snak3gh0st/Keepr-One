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
  refuseLocalConnectorCapability,
  supportsStageCompletionProtocol,
} from '@/lib/national-life/local-connector/remote-config'
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
  // É aqui que a flag ganha a latência que a Store não dá. Uma grade grande sobe
  // lote a lote, um PUT por lote: uma pausa ligada no meio do run derruba o run no
  // lote seguinte — minutos —, sem depender de a extensão ter consultado nada.
  const refusal = refuseLocalConnectorCapability('READ_GRID', request.headers)
  if (refusal) return refusal

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
      // Versions before 0.1.2 have no separate stage-complete call. This is a
      // temporary compatibility bridge for already-installed pilot builds; new
      // extensions always use the server-reconciled completion endpoint.
      legacyStageCompletion: !supportsStageCompletionProtocol(request.headers),
    })
    return Response.json(result, { status: result.duplicate ? 200 : 201, headers: NO_STORE })
  } catch (error) {
    if (error instanceof LocalConnectorSignatureError) {
      // O cabeçalho é o que deixa o dispositivo distinguir "não te conheço mais"
      // de "esta requisição não passou". Só o primeiro autoriza apagar a chave.
      return Response.json(
        // O corpo mantém o código público estável; quem carrega a distinção é o
        // cabeçalho, para não mudar o contrato já consumido.
        { error: 'DEVICE_REQUEST_REJECTED' },
        { status: 401, headers: { ...NO_STORE, 'x-fyntra-device-error': error.code } },
      )
    }
    if (error instanceof LocalConnectorRunError) {
      // GRID_NOT_PLANNED joins RUN_NOT_FOUND on 404: the device addressed a stage
      // that does not exist on this run. 403 would imply the device lacks rights
      // to a real resource, and 409 is reserved for the idempotency clash.
      const status = error.code === 'IDEMPOTENCY_CONFLICT' ? 409 : 404
      return Response.json({ error: error.code }, { status, headers: NO_STORE })
    }
    return Response.json({ error: 'INVALID_ENVELOPE' }, { status: 400, headers: NO_STORE })
  }
}
