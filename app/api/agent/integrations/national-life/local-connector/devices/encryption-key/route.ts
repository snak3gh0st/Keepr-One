import { z } from 'zod'
import {
  DeviceEncryptionKeyError,
  registerDeviceEncryptionKey,
} from '@/lib/national-life/credentials/device-key-service'
import {
  isNationalLifeLocalConnectorEnabled,
  localConnectorUnavailableResponse,
} from '@/lib/national-life/local-connector/config'
import { publicRsaOaepJwkSchema } from '@/lib/national-life/local-connector/contracts'
import {
  LocalConnectorSignatureError,
  verifyLocalConnectorDeviceRequest,
} from '@/lib/national-life/local-connector/device-signature'
import {
  LocalConnectorRequestError,
  parseJsonBody,
  readLimitedBody,
} from '@/lib/national-life/local-connector/request'
import { prisma } from '@/lib/prisma'

const MAX_BODY_BYTES = 8 * 1024
const NO_STORE = { 'Cache-Control': 'no-store' }
const bodySchema = z.strictObject({
  schemaVersion: z.literal(1),
  publicKeyJwk: publicRsaOaepJwkSchema,
})

export async function POST(request: Request) {
  if (!isNationalLifeLocalConnectorEnabled()) return localConnectorUnavailableResponse()
  try {
    const raw = await readLimitedBody(request, MAX_BODY_BYTES)
    const device = await verifyLocalConnectorDeviceRequest(prisma, {
      method: request.method,
      pathname: new URL(request.url).pathname,
      headers: request.headers,
      body: raw,
    })
    const input = bodySchema.parse(parseJsonBody(raw))
    const result = await registerDeviceEncryptionKey(prisma, {
      deviceId: device.deviceId,
      agentId: device.agentId,
      publicKeyJwk: input.publicKeyJwk,
    })
    return Response.json(
      { registered: result.registered, thumbprint: result.thumbprint },
      { status: result.registered ? 201 : 200, headers: NO_STORE },
    )
  } catch (error) {
    if (error instanceof LocalConnectorSignatureError) {
      return Response.json(
        { error: 'DEVICE_REQUEST_REJECTED' },
        {
          status: 401,
          headers: { ...NO_STORE, 'x-fyntra-device-error': error.code },
        },
      )
    }
    if (error instanceof DeviceEncryptionKeyError) {
      return Response.json(
        { error: error.code },
        { status: error.code === 'DEVICE_ENCRYPTION_KEY_CONFLICT' ? 409 : 400, headers: NO_STORE },
      )
    }
    if (error instanceof LocalConnectorRequestError || error instanceof z.ZodError) {
      return Response.json({ error: 'INVALID_REQUEST' }, { status: 400, headers: NO_STORE })
    }
    return Response.json(
      { error: 'DEVICE_ENCRYPTION_KEY_REGISTRATION_FAILED' },
      { status: 500, headers: NO_STORE },
    )
  }
}
