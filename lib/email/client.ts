import 'server-only'
import { Resend } from 'resend'

let cached: Resend | null = null

export function getResendClient(): Resend {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) throw new Error('RESEND_API_KEY is not configured')
  if (!cached) cached = new Resend(apiKey)
  return cached
}

export const EMAIL_FROM = process.env.EMAIL_FROM ?? 'Keepr One <notificacoes@keeprone.com>'
