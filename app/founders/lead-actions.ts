'use server'

import { createHash } from 'node:crypto'
import { headers } from 'next/headers'
import {
  founderLeadSchema,
  type FounderLeadFieldErrors,
} from '@/lib/founder-lead-validation'
import { consumeFounderRegistrationRateLimit } from '@/lib/founder-rate-limit'
import { prisma } from '@/lib/prisma'
import { FOUNDERS_CAMPAIGN_ID, readLeadAttribution } from '@/lib/marketing/attribution'

export type FounderLeadRegistrationResult =
  | { ok: true }
  | { ok: false; message?: string; fieldErrors?: FounderLeadFieldErrors }

function formString(formData: FormData, key: string): string {
  const value = formData.get(key)
  return typeof value === 'string' ? value : ''
}

function registrationFingerprints(email: string, requestHeaders: Headers) {
  const forwardedFor = requestHeaders.get('x-forwarded-for')
    ?.split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  const address = requestHeaders.get('x-real-ip')
    || forwardedFor?.[forwardedFor.length - 1]
    || 'unknown'
  const digest = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 32)

  return {
    address: digest(address),
    addressAndEmail: digest(`${address}:${email}`),
  }
}

export async function registerFounderLeadAction(
  formData: FormData,
): Promise<FounderLeadRegistrationResult> {
  // A filled honeypot is acknowledged without storing an automated submission.
  if (formString(formData, 'website').trim()) {
    return { ok: true }
  }

  const parsed = founderLeadSchema.safeParse({
    name: formString(formData, 'name'),
    email: formString(formData, 'email'),
    phone: formString(formData, 'phone'),
  })

  if (!parsed.success) {
    return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors }
  }

  try {
    const requestHeaders = await headers()
    const fingerprints = registrationFingerprints(parsed.data.email, requestHeaders)
    const limits = await Promise.all([
      consumeFounderRegistrationRateLimit({
        key: `founders-lead-ip:${fingerprints.address}`,
        max: 12,
        windowSeconds: 60 * 60,
      }),
      consumeFounderRegistrationRateLimit({
        key: `founders-lead-email:${fingerprints.addressAndEmail}`,
        max: 4,
        windowSeconds: 60 * 60,
      }),
    ])

    if (limits.some((limit) => !limit.allowed)) {
      return {
        ok: false,
        message: 'Muitas tentativas de cadastro. Aguarde um pouco antes de tentar novamente.',
      }
    }

    const { campaignSlug, ...attribution } = readLeadAttribution(formData)
    const campaign = campaignSlug
      ? await prisma.marketingCampaign.findUnique({ where: { slug: campaignSlug }, select: { id: true } })
      : null

    // PostgreSQL's conflict handling is atomic, including concurrent requests.
    // Repeated emails return the same success without changing an existing lead.
    await prisma.marketingLead.createMany({
      data: [{
        ...parsed.data, ...attribution,
        source: 'FOUNDERS', campaignId: campaign?.id ?? FOUNDERS_CAMPAIGN_ID,
      }],
      skipDuplicates: true,
    })

    return { ok: true }
  } catch {
    // Do not log submitted contact data or database connection details.
    console.error('Founder lead registration failed.')
    return {
      ok: false,
      message: 'Não foi possível concluir seu cadastro agora. Tente novamente em instantes.',
    }
  }
}
