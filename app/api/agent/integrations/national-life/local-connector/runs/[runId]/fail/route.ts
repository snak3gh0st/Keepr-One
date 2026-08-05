import { z } from 'zod'
import {
  isNationalLifeLocalConnectorEnabled,
  localConnectorUnavailableResponse,
} from '@/lib/national-life/local-connector/config'
import {
  LocalConnectorSignatureError,
  verifyLocalConnectorDeviceRequest,
} from '@/lib/national-life/local-connector/device-signature'
import {
  parseJsonBody,
  readLimitedBody,
} from '@/lib/national-life/local-connector/request'
import {
  failLocalConnectorRun,
  LocalConnectorRunError,
} from '@/lib/national-life/local-connector/run-service'
import { prisma } from '@/lib/prisma'

const MAX_FAIL_BODY_BYTES = 2_048
const NO_STORE = { 'Cache-Control': 'no-store' }
const paramsSchema = z.strictObject({
  runId: z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/),
})
const bodySchema = z.strictObject({
  code: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[A-Z0-9_]+$/),
})

export async function POST(
  request: Request,
  context: { params: Promise<{ runId: string }> },
) {
  if (!isNationalLifeLocalConnectorEnabled()) return localConnectorUnavailableResponse()

  try {
    const body = await readLimitedBody(request, MAX_FAIL_BODY_BYTES)
    const device = await verifyLocalConnectorDeviceRequest(prisma, {
      method: request.method,
      pathname: new URL(request.url).pathname,
      headers: request.headers,
      body,
    })
    const params = paramsSchema.parse(await context.params)
    const payload = bodySchema.parse(parseJsonBody(body))
    const result = await failLocalConnectorRun(prisma, {
      ...device,
      runId: params.runId,
      safeErrorCode: payload.code,
    })
    return Response.json(result, { status: 200, headers: NO_STORE })
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
      return Response.json({ error: error.code }, { status: 404, headers: NO_STORE })
    }
    return Response.json({ error: 'INVALID_REQUEST' }, { status: 400, headers: NO_STORE })
  }
}