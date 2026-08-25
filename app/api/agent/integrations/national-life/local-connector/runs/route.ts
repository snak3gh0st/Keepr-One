import { z } from 'zod'
import {
  isNationalLifePageDiscoveryEnabled,
  isNationalLifeExportEnabled,
  isNationalLifeLocalConnectorEnabled,
  localConnectorUnavailableResponse,
} from '@/lib/national-life/local-connector/config'
import {
  LocalConnectorSignatureError,
  verifyLocalConnectorDeviceRequest,
} from '@/lib/national-life/local-connector/device-signature'
import {
  LocalConnectorRequestError,
  parseJsonBody,
  readLimitedBody,
} from '@/lib/national-life/local-connector/request'
import {
  COMMISSION_DETAIL_PROTOCOL_MIN_VERSION,
  localConnectorUpgradeRequiredResponse,
  refuseLocalConnectorCapability,
  supportsCommissionDetailProtocol,
  supportsExportProtocol,
} from '@/lib/national-life/local-connector/remote-config'
import {
  LOCAL_CONNECTOR_PRIORITY_GRID_KEYS,
  startLocalConnectorRun,
} from '@/lib/national-life/local-connector/run-service'
import { NATIONAL_LIFE_DISCOVERY_PAGE_KEYS } from '@/lib/national-life/read-coverage'
import { prisma } from '@/lib/prisma'
import { consumeRateLimit } from '@/lib/redis/rate-limit'

const MAX_RUN_BODY_BYTES = 1_024
const NO_STORE = { 'Cache-Control': 'no-store' }
/// Teto de disparos de run por agente, não por IP: o dono da fadiga de sessão
/// é o portal da carrier, e é o agente quem repete o clique num bug de UI ou
/// num loop de retry. 10 em 10 minutos cobre um uso ativo normal com folga e
/// ainda para um loop antes de ele custar uma sessão inteira do carrier.
const RUN_START_MAX = 10
const RUN_START_WINDOW_SECONDS = 600
const bodySchema = z.strictObject({ forceRefresh: z.literal(true).optional() })
const PAGE_DISCOVERY_KEYS = new Set<string>(NATIONAL_LIFE_DISCOVERY_PAGE_KEYS)

function priorityGridKeys(pageDiscoveryEnabled: boolean) {
  return pageDiscoveryEnabled
    ? [...LOCAL_CONNECTOR_PRIORITY_GRID_KEYS]
    : LOCAL_CONNECTOR_PRIORITY_GRID_KEYS.filter((gridKey) => !PAGE_DISCOVERY_KEYS.has(gridKey))
}

export async function POST(request: Request) {
  if (!isNationalLifeLocalConnectorEnabled()) return localConnectorUnavailableResponse()
  // Antes de qualquer trabalho, e por autoridade do próprio endpoint: a versão
  // que o cliente diz ter é auto-declarada, então o piso não é uma sugestão que
  // ele possa ignorar — é aqui que ele é aplicado. Um run é o começo de tudo;
  // barrar aqui evita abrir um run que o cliente não conseguiria terminar.
  const pageDiscoveryEnabled = isNationalLifePageDiscoveryEnabled()
  const exportEnabled = isNationalLifeExportEnabled() && supportsExportProtocol(request.headers)
  const refusal =
    refuseLocalConnectorCapability('READ_GRID', request.headers) ??
    (!supportsCommissionDetailProtocol(request.headers)
      ? localConnectorUpgradeRequiredResponse(COMMISSION_DETAIL_PROTOCOL_MIN_VERSION)
      : null) ??
    (exportEnabled ? refuseLocalConnectorCapability('READ_EXPORT', request.headers) : null) ??
    (pageDiscoveryEnabled
      ? refuseLocalConnectorCapability('READ_PAGE', request.headers)
      : null)
  if (refusal) return refusal

  try {
    const body = await readLimitedBody(request, MAX_RUN_BODY_BYTES)
    const payload = bodySchema.parse(parseJsonBody(body))
    const device = await verifyLocalConnectorDeviceRequest(prisma, {
      method: request.method,
      pathname: new URL(request.url).pathname,
      headers: request.headers,
      body,
    })
    const rateLimit = await consumeRateLimit({
      key: `national-life-run-start:${device.agentId}`,
      max: RUN_START_MAX,
      windowSeconds: RUN_START_WINDOW_SECONDS,
    })
    if (!rateLimit.allowed) {
      return Response.json(
        { error: 'RUN_START_RATE_LIMITED' },
        { status: 429, headers: { ...NO_STORE, 'Retry-After': String(rateLimit.retryAfterSeconds) } },
      )
    }

    const runOptions = {
      gridKeys: priorityGridKeys(pageDiscoveryEnabled),
      ...(payload.forceRefresh === true ? { forceRefresh: true } : {}),
      ...(exportEnabled ? { exportEnabled: true } : {}),
    }
    const run = await startLocalConnectorRun(prisma, device, runOptions)
    return Response.json(run, { status: 201, headers: NO_STORE })
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
    if (error instanceof LocalConnectorRequestError || error instanceof z.ZodError || error instanceof SyntaxError) {
      return Response.json({ error: 'INVALID_REQUEST' }, { status: 400, headers: NO_STORE })
    }
    return Response.json({ error: 'RUN_START_FAILED' }, { status: 500, headers: NO_STORE })
  }
}
