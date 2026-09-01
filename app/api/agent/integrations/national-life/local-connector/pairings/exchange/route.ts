import { z } from 'zod'
import {
  isNationalLifeLocalConnectorEnabled,
  localConnectorUnavailableResponse,
} from '@/lib/national-life/local-connector/config'
import {
  publicP256JwkSchema,
  publicRsaOaepJwkSchema,
} from '@/lib/national-life/local-connector/contracts'
import {
  exchangeLocalConnectorPairing,
  LocalConnectorPairingError,
} from '@/lib/national-life/local-connector/pairing'
import {
  parseJsonBody,
  readLimitedBody,
} from '@/lib/national-life/local-connector/request'
import { prisma } from '@/lib/prisma'

const MAX_PAIRING_BODY_BYTES = 16 * 1024
const NO_STORE = { 'Cache-Control': 'no-store' }
const exchangeSchema = z.strictObject({
  code: z.string().trim().min(8).max(128),
  label: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .refine((value) => !/[<>\u0000]/.test(value)),
  publicKeyJwk: publicP256JwkSchema,
  encryptionPublicKeyJwk: publicRsaOaepJwkSchema.optional(),
})

export async function POST(request: Request) {
  if (!isNationalLifeLocalConnectorEnabled()) return localConnectorUnavailableResponse()

  try {
    const bytes = await readLimitedBody(request, MAX_PAIRING_BODY_BYTES)
    const input = exchangeSchema.parse(parseJsonBody(bytes))
    const device = await exchangeLocalConnectorPairing(prisma, input)
    return Response.json(device, { status: 201, headers: NO_STORE })
  } catch (error) {
    const status = error instanceof LocalConnectorPairingError ? 409 : 400
    return Response.json({ error: 'PAIRING_REJECTED' }, { status, headers: NO_STORE })
  }
}
