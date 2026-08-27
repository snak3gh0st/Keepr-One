'use server'

import { createHash, randomUUID } from 'node:crypto'
import { hashPassword } from 'better-auth/crypto'
import { Prisma } from '@prisma/client'
import { headers } from 'next/headers'
import { z } from 'zod'
import { sendFounderWelcomeEmail } from '@/lib/email/send'
import { getRequiredOnboardingModulesForAccess } from '@/lib/agent-onboarding'
import { FOUNDER_TRIAL_DURATION_MS } from '@/lib/founder-access'
import {
  isFounderRegistrationOpen,
  matchFounderAccessCode,
} from '@/lib/founder-invite-config'
import { consumeFounderRegistrationRateLimit } from '@/lib/founder-rate-limit'
import {
  AGENCY_MONTHLY_PRICE_CENTS,
  INDIVIDUAL_AGENT_MONTHLY_PRICE_CENTS,
} from '@/lib/plans'
import { prisma } from '@/lib/prisma'

export type FounderRegistrationResult = {
  ok: boolean
  message?: string
  fieldErrors?: Record<string, string[]>
  loginUrl?: string
  email?: string
  trialEndsAt?: string
}

const founderRegistrationSchema = z
  .strictObject({
    accountType: z.enum(['AGENT', 'AGENCY'], {
      error: 'Escolha se o acesso será para agente ou agência.',
    }),
    name: z.string().trim().min(2, 'Informe seu nome completo.').max(100),
    agencyName: z.string().trim().max(120).default(''),
    email: z.string().trim().toLowerCase().email('Informe um e-mail válido.').max(254),
    phone: z
      .string()
      .trim()
      .min(7, 'Informe um telefone válido.')
      .max(30)
      .refine((value) => value.replace(/\D/g, '').length >= 7, 'Informe um telefone válido.')
      .refine((value) => value.replace(/\D/g, '').length <= 15, 'O telefone tem dígitos demais.'),
    npn: z
      .string()
      .trim()
      .max(20)
      .refine((value) => value === '' || /^\d{4,20}$/.test(value), 'Use apenas os números do NPN.'),
    password: z
      .string()
      .min(8, 'Crie uma senha com pelo menos 8 caracteres.')
      .max(128, 'A senha deve ter no máximo 128 caracteres.'),
    confirmPassword: z.string(),
    acceptedTerms: z.string().refine((value) => value === 'on', {
      message: 'Aceite os termos do programa e a política de privacidade.',
    }),
    accessCode: z.string().trim().min(1, 'Informe o código enviado no seu convite.').max(128),
    website: z.string().max(0).default(''),
  })
  .superRefine((value, context) => {
    if (value.accountType === 'AGENCY' && value.agencyName.length < 2) {
      context.addIssue({
        code: 'custom',
        path: ['agencyName'],
        message: 'Informe o nome da agência.',
      })
    }

    if (value.password !== value.confirmPassword) {
      context.addIssue({
        code: 'custom',
        path: ['confirmPassword'],
        message: 'As senhas não coincidem.',
      })
    }
  })

function formString(formData: FormData, key: string): string {
  const value = formData.get(key)
  return typeof value === 'string' ? value : ''
}

function registrationFingerprints(email: string, requestHeaders: Headers) {
  const forwardedFor = requestHeaders
    .get('x-forwarded-for')
    ?.split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  const address = requestHeaders.get('x-real-ip')
    || (forwardedFor && forwardedFor[forwardedFor.length - 1])
    || 'unknown'
  const digest = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 32)
  return {
    address: digest(address),
    addressAndEmail: digest(`${address}:${email}`),
  }
}

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  return phone.trim().startsWith('+') ? `+${digits}` : digits
}

function appLoginUrl(email: string): string {
  const configuredAppUrl = process.env.NEXT_PUBLIC_APP_URL
    ?? process.env.BETTER_AUTH_URL
    ?? 'https://app.keeprone.com'
  const url = new URL('/login', configuredAppUrl)
  url.searchParams.set('founder', 'created')
  url.searchParams.set('email', email)
  return url.toString()
}

function duplicateFieldError(error: Prisma.PrismaClientKnownRequestError): FounderRegistrationResult {
  const target = Array.isArray(error.meta?.target)
    ? error.meta.target.map(String)
    : [String(error.meta?.target ?? '')]

  if (target.some((field) => field.toLowerCase().includes('npn'))) {
    return {
      ok: false,
      fieldErrors: { npn: ['Este NPN já está vinculado a outra conta.'] },
    }
  }

  if (target.some((field) => field.toLowerCase().includes('accesscodehash'))) {
    return {
      ok: false,
      fieldErrors: { accessCode: ['Este convite já foi utilizado. Peça um novo código à Keepr One.'] },
    }
  }

  return {
    ok: false,
    fieldErrors: {
      email: ['Já existe uma conta com este e-mail. Entre com sua senha para continuar.'],
    },
  }
}

export async function registerFounderAction(
  formData: FormData,
): Promise<FounderRegistrationResult> {
  if (!isFounderRegistrationOpen()) {
    return {
      ok: false,
      message: 'As inscrições Founder estão pausadas no momento. Fale com a equipe Keepr One.',
    }
  }

  const parsed = founderRegistrationSchema.safeParse({
    accountType: formString(formData, 'accountType'),
    name: formString(formData, 'name'),
    agencyName: formString(formData, 'agencyName'),
    email: formString(formData, 'email'),
    phone: formString(formData, 'phone'),
    npn: formString(formData, 'npn'),
    password: formString(formData, 'password'),
    confirmPassword: formString(formData, 'confirmPassword'),
    acceptedTerms: formString(formData, 'acceptedTerms'),
    accessCode: formString(formData, 'accessCode'),
    website: formString(formData, 'website'),
  })

  if (!parsed.success) {
    return {
      ok: false,
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }

  const requestHeaders = await headers()
  const fingerprints = registrationFingerprints(parsed.data.email, requestHeaders)
  const [addressRateLimit, emailRateLimit] = await Promise.all([
    consumeFounderRegistrationRateLimit({
      key: `founders-register-ip:${fingerprints.address}`,
      max: 12,
      windowSeconds: 60 * 60,
    }),
    consumeFounderRegistrationRateLimit({
      key: `founders-register-email:${fingerprints.addressAndEmail}`,
      max: 4,
      windowSeconds: 60 * 60,
    }),
  ])
  if (!addressRateLimit.allowed || !emailRateLimit.allowed) {
    return {
      ok: false,
      message: 'Muitas tentativas de cadastro. Aguarde um pouco antes de tentar novamente.',
    }
  }

  // Count invalid invite attempts too; otherwise an invite code could be
  // brute-forced without ever reaching the limiter.
  const accessCodeHash = matchFounderAccessCode(parsed.data.accessCode)
  if (!accessCodeHash) {
    return {
      ok: false,
      fieldErrors: { accessCode: ['Código inválido. Confira o convite recebido.'] },
    }
  }

  const now = new Date()
  const trialEndsAt = new Date(now.getTime() + FOUNDER_TRIAL_DURATION_MS)
  const passwordHash = await hashPassword(parsed.data.password)
  const accountType = parsed.data.accountType
  const plan = accountType === 'AGENCY' ? 'AGENCY' : 'AGENT_INDIVIDUAL'
  const unitAmountCents = accountType === 'AGENCY'
    ? AGENCY_MONTHLY_PRICE_CENTS
    : INDIVIDUAL_AGENT_MONTHLY_PRICE_CENTS
  const phone = normalizePhone(parsed.data.phone)

  try {
    await prisma.$transaction(async (transaction) => {
      const user = await transaction.user.create({
        data: {
          email: parsed.data.email,
          name: parsed.data.name,
          role: 'AGENT',
        },
        select: { id: true },
      })

      await transaction.account.create({
        data: {
          id: randomUUID(),
          accountId: user.id,
          providerId: 'credential',
          userId: user.id,
          password: passwordHash,
        },
      })

      const agent = await transaction.agent.create({
        data: {
          userId: user.id,
          rank: accountType === 'AGENCY' ? 'AGENCY_OWNER' : 'AGENT',
          npn: parsed.data.npn || null,
          phone,
          status: 'ACTIVE',
          promotionAccessScope: accountType === 'AGENCY' ? 'AGENCY' : 'PERSONAL',
        },
        select: { id: true },
      })

      let agencyId: string | null = null
      if (accountType === 'AGENCY') {
        const agency = await transaction.agency.create({
          data: { name: parsed.data.agencyName },
          select: { id: true },
        })
        agencyId = agency.id

        await transaction.agencyMembership.create({
          data: {
            agencyId: agency.id,
            agentId: agent.id,
            role: 'OWNER',
          },
        })

        await transaction.platformSubscription.create({
          data: {
            plan,
            status: 'TRIALING',
            agencyId: agency.id,
            unitAmountCents,
            currency: 'USD',
            currentPeriodStart: now,
            currentPeriodEnd: trialEndsAt,
          },
        })
      } else {
        await transaction.platformSubscription.create({
          data: {
            plan,
            status: 'TRIALING',
            agentId: agent.id,
            unitAmountCents,
            currency: 'USD',
            currentPeriodStart: now,
            currentPeriodEnd: trialEndsAt,
          },
        })
      }

      const enrollment = await transaction.founderEnrollment.create({
        data: {
          agentId: agent.id,
          agencyId,
          accountType,
          phone,
          accessCodeHash,
          trialStartedAt: now,
          trialEndsAt,
          acceptedTermsAt: now,
        },
        select: { id: true },
      })

      await transaction.agentOnboarding.create({
        data: {
          agentId: agent.id,
          status: 'IN_PROGRESS',
          currentStep: 'WELCOME',
          requiredModules: getRequiredOnboardingModulesForAccess({
            canManageTeam: accountType === 'AGENCY',
            canAccessIntegrations: true,
          }),
        },
      })

      await transaction.auditLog.create({
        data: {
          userId: user.id,
          action: 'FOUNDER_REGISTERED',
          entity: 'FounderEnrollment',
          entityId: enrollment.id,
          after: {
            accountType,
            agencyId,
            trialEndsAt: trialEndsAt.toISOString(),
            cohort: 'FOUNDERS_2026',
          },
        },
      })
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return duplicateFieldError(error)
    }

    console.error('Founder registration failed', error)
    return {
      ok: false,
      message: 'Não foi possível criar seu acesso agora. Tente novamente em alguns instantes.',
    }
  }

  try {
    await sendFounderWelcomeEmail({
      to: parsed.data.email,
      founderName: parsed.data.name,
      accountType,
      trialEndsAt,
      loginUrl: appLoginUrl(parsed.data.email),
    })
  } catch (error) {
    // Email delivery is intentionally best-effort. The committed account and
    // its trial must remain usable even when the provider is unavailable.
    console.warn('Founder welcome email could not be sent', error)
  }

  return {
    ok: true,
    email: parsed.data.email,
    loginUrl: appLoginUrl(parsed.data.email),
    trialEndsAt: trialEndsAt.toISOString(),
  }
}
