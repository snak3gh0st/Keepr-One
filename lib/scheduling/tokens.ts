import { createHash, randomBytes } from 'node:crypto'
import { SCHEDULING_MANAGE_TOKEN_BYTES } from './constants'

export function hashSchedulingSecret(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

export function createSchedulingManageToken() {
  const rawToken = randomBytes(SCHEDULING_MANAGE_TOKEN_BYTES).toString('base64url')
  return { rawToken, tokenHash: hashSchedulingSecret(rawToken) }
}
