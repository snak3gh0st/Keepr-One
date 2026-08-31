import 'server-only'
import type { CreateEmailOptions, CreateEmailRequestOptions } from 'resend'
import {
  AGENCY_INVITATION_DISCOUNT_CENTS,
  formatPlanPrice,
} from '@/lib/plans'
import { getResendClient, EMAIL_FROM } from './client'
import { renderEmailLayout } from './layout'
import { localize } from '@/lib/i18n/catalog'
import { localeFor, type UserLanguage } from '@/lib/i18n/config'
import {
  renderSchedulingConfirmationEmail,
  type SchedulingConfirmationEmailContentInput,
} from './scheduling-confirmation'

export class EmailDeliveryError extends Error {
  readonly code: string
  readonly retryable: boolean

  constructor(code: string, retryable: boolean, cause?: unknown) {
    super(`Email provider rejected the message: ${code}`, { cause })
    this.name = 'EmailDeliveryError'
    this.code = code
    this.retryable = retryable
  }
}

async function deliverEmail(
  payload: CreateEmailOptions,
  requestOptions?: CreateEmailRequestOptions,
): Promise<string> {
  const client = getResendClient()
  const result = requestOptions
    ? await client.emails.send(payload, requestOptions)
    : await client.emails.send(payload)
  if (result.error) {
    const statusCode = result.error.statusCode
    const retryable = result.error.name === 'concurrent_idempotent_requests' ||
      statusCode === null || statusCode === 429 || statusCode >= 500
    throw new EmailDeliveryError(result.error.name, retryable, result.error)
  }
  if (!result.data?.id) throw new EmailDeliveryError('missing_message_id', true)
  return result.data.id
}

export async function sendSchedulingConfirmationEmail(
  options: SchedulingConfirmationEmailContentInput & { to: string; idempotencyKey: string },
) {
  const content = renderSchedulingConfirmationEmail(options)
  const providerMessageId = await deliverEmail({
    from: EMAIL_FROM,
    to: options.to,
    subject: content.subject,
    html: content.html,
    text: content.text,
    attachments: [{
      filename: content.calendarFilename,
      content: Buffer.from(content.calendarAttachment, 'utf8').toString('base64'),
      contentType: 'text/calendar; charset=utf-8; method=PUBLISH',
    }],
    tags: [{ name: 'category', value: 'scheduling-confirmation' }],
  }, { idempotencyKey: options.idempotencyKey })
  return { providerMessageId }
}

export async function sendResetPasswordEmail(options: {
  to: string
  resetUrl: string
  language?: UserLanguage
}): Promise<void> {
  const language = options.language ?? 'PT'
  const html = renderEmailLayout({
    language,
    preheader: localize(language, 'Redefina sua senha do Keepr One', 'Reset your Keepr One password'),
    heading: localize(language, 'Redefinir sua senha', 'Reset your password'),
    bodyHtml: `
      <p style="margin:0 0 16px;">${localize(language, 'Recebemos um pedido para redefinir a senha da sua conta Keepr One.', 'We received a request to reset your Keepr One account password.')}</p>
      <p style="margin:0;">${localize(language, 'Se foi você, clique no botão abaixo. Este link expira em breve e só pode ser usado uma vez.', 'If this was you, use the button below. This link expires soon and can only be used once.')}</p>
    `,
    ctaLabel: localize(language, 'Redefinir senha', 'Reset password'),
    ctaUrl: options.resetUrl,
  })

  await deliverEmail({
    from: EMAIL_FROM,
    to: options.to,
    subject: localize(language, 'Redefinir sua senha — Keepr One', 'Reset your password — Keepr One'),
    html,
  })
}

export async function sendVerificationEmail(options: {
  to: string
  verificationUrl: string
  language?: UserLanguage
}): Promise<void> {
  const language = options.language ?? 'PT'
  const html = renderEmailLayout({
    language,
    preheader: localize(language, 'Confirme seu novo e-mail no Keepr One', 'Confirm your new Keepr One email'),
    heading: localize(language, 'Confirme seu endereço de e-mail', 'Confirm your email address'),
    bodyHtml: `
      <p style="margin:0 0 16px;">${localize(language, 'Recebemos uma solicitação para usar este endereço na sua conta Keepr One.', 'We received a request to use this address for your Keepr One account.')}</p>
      <p style="margin:0;">${localize(language, 'Confirme pelo botão abaixo. Seu e-mail de acesso só será alterado depois desta verificação.', 'Confirm with the button below. Your sign-in email will change only after this verification.')}</p>
    `,
    ctaLabel: localize(language, 'Confirmar novo e-mail', 'Confirm new email'),
    ctaUrl: options.verificationUrl,
  })

  await deliverEmail({
    from: EMAIL_FROM,
    to: options.to,
    subject: localize(language, 'Confirme seu e-mail — Keepr One', 'Confirm your email — Keepr One'),
    html,
  })
}

export async function sendWelcomeEmail(options: { to: string; agentName: string; language?: UserLanguage }): Promise<void> {
  const language = options.language ?? 'PT'
  const html = renderEmailLayout({
    language,
    preheader: localize(language, 'Sua conta Keepr One está pronta', 'Your Keepr One account is ready'),
    heading: localize(language, 'Bem-vindo, {name}', 'Welcome, {name}', { name: options.agentName }),
    bodyHtml: `
      <p style="margin:0;">${localize(language, 'Sua conta no Keepr One foi criada com sucesso. Você já pode acessar a plataforma e conectar suas integrações de carrier.', 'Your Keepr One account was created successfully. You can now access the platform and connect your carrier integrations.')}</p>
    `,
    ctaLabel: localize(language, 'Acessar o Keepr One', 'Open Keepr One'),
    ctaUrl: 'https://app.keeprone.com',
  })

  await deliverEmail({
    from: EMAIL_FROM,
    to: options.to,
    subject: localize(language, 'Bem-vindo ao Keepr One', 'Welcome to Keepr One'),
    html,
  })
}

function escapeEmailText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function sanitizeEmailHeader(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim()
}

export async function sendChangeEmailConfirmationEmail(options: {
  to: string
  newEmail: string
  confirmationUrl: string
  language?: UserLanguage
}): Promise<void> {
  const language = options.language ?? 'PT'
  const safeNewEmail = escapeEmailText(options.newEmail)
  const html = renderEmailLayout({
    language,
    preheader: localize(language, 'Autorize a alteração do e-mail da sua conta', 'Authorize your account email change'),
    heading: localize(language, 'Você solicitou esta alteração?', 'Did you request this change?'),
    bodyHtml: `
      <p style="margin:0 0 16px;">${localize(language, `Foi solicitada a troca do e-mail da sua conta para <strong style="color:#ffffff;">${safeNewEmail}</strong>.`, `A request was made to change your account email to <strong style="color:#ffffff;">${safeNewEmail}</strong>.`)}</p>
      <p style="margin:0;">${localize(language, 'Autorize pelo botão abaixo. Depois disso, também confirmaremos o novo endereço antes de concluir a mudança.', 'Authorize it with the button below. We will then confirm the new address before completing the change.')}</p>
    `,
    ctaLabel: localize(language, 'Autorizar alteração', 'Authorize change'),
    ctaUrl: options.confirmationUrl,
  })

  await deliverEmail({
    from: EMAIL_FROM,
    to: options.to,
    subject: localize(language, 'Autorize a alteração do seu e-mail — Keepr One', 'Authorize your email change — Keepr One'),
    html,
  })
}

export async function sendFounderWelcomeEmail(options: {
  to: string
  founderName: string
  accountType: 'AGENT' | 'AGENCY'
  trialEndsAt: Date
  loginUrl: string
  language?: UserLanguage
}): Promise<void> {
  const language = options.language ?? 'PT'
  const safeName = escapeEmailText(options.founderName)
  const planLabel = options.accountType === 'AGENCY'
    ? localize(language, 'Agência', 'Agency')
    : localize(language, 'Agente', 'Agent')
  const trialEndLabel = new Intl.DateTimeFormat(localeFor(language), {
    dateStyle: 'long',
    timeZone: 'UTC',
  }).format(options.trialEndsAt)
  const html = renderEmailLayout({
    language,
    preheader: localize(language, 'Seu acesso Founder de 30 dias está pronto', 'Your 30-day Founder access is ready'),
    heading: localize(language, 'Bem-vindo ao programa Founders, {name}', 'Welcome to the Founders program, {name}', { name: safeName }),
    bodyHtml: `
      <p style="margin:0 0 16px;">${localize(language, `Seu acesso ao plano ${planLabel} já está ativo por 30 dias, com término em <strong style="color:#ffffff;">${trialEndLabel}</strong>.`, `Your ${planLabel} plan access is active for 30 days and ends on <strong style="color:#ffffff;">${trialEndLabel}</strong>.`)}</p>
      <p style="margin:0;">${localize(language, 'Você não será cobrado agora. Para manter o acesso depois desse período, será necessário ativar uma assinatura.', 'You will not be charged now. To keep access after this period, you will need to activate a subscription.')}</p>
    `,
    ctaLabel: localize(language, 'Acessar a plataforma', 'Open the platform'),
    ctaUrl: options.loginUrl,
  })

  await deliverEmail({
    from: EMAIL_FROM,
    to: options.to,
    subject: localize(language, 'Seu acesso Founder está pronto — Keepr One', 'Your Founder access is ready — Keepr One'),
    html,
  })
}

export async function sendAgencyInvitationEmail(options: {
  to: string
  inviteeName?: string | null
  agencyName: string
  intendedType: 'AGENT' | 'AGENCY'
  monthlyPriceCents: number
  invitationUrl: string
  expiresAt: Date
  language?: UserLanguage
}): Promise<void> {
  const language = options.language ?? 'PT'
  const safeInviteeName = options.inviteeName?.trim()
    ? escapeEmailText(options.inviteeName.trim())
    : localize(language, 'Olá', 'Hello')
  const safeAgencyName = escapeEmailText(options.agencyName)
  const safeAgencyHeader = sanitizeEmailHeader(options.agencyName)
  const accountTypeLabel = options.intendedType === 'AGENCY'
    ? localize(language, 'Agência', 'Agency')
    : localize(language, 'Agente', 'Agent')
  const accountTypeArticle = options.intendedType === 'AGENCY'
    ? localize(language, 'uma agência', 'an agency')
    : localize(language, 'um agente', 'an agent')
  const monthlyPriceLabel = escapeEmailText(formatPlanPrice(options.monthlyPriceCents, localeFor(language)))
  const discountLabel = escapeEmailText(formatPlanPrice(AGENCY_INVITATION_DISCOUNT_CENTS, localeFor(language)))
  const expiresLabel = new Intl.DateTimeFormat(localeFor(language), {
    dateStyle: 'long',
    timeZone: 'UTC',
  }).format(options.expiresAt)
  const html = renderEmailLayout({
    language,
    preheader: localize(language, '{agency} convidou você para o Keepr One', '{agency} invited you to Keepr One', { agency: safeAgencyName }),
    heading: safeInviteeName,
    bodyHtml: `
      <p style="margin:0 0 16px;">${localize(language, `A <strong style="color:#ffffff;">${safeAgencyName}</strong> convidou você para fazer parte da estrutura no Keepr One como <strong style="color:#ffffff;">${accountTypeArticle}</strong>.`, `<strong style="color:#ffffff;">${safeAgencyName}</strong> invited you to join its Keepr One structure as <strong style="color:#ffffff;">${accountTypeArticle}</strong>.`)}</p>
      <p style="margin:0 0 16px;">${localize(language, `A mensalidade pelo convite é <strong style="color:#ffffff;">${monthlyPriceLabel}/mês</strong>, já com <strong style="color:#ffffff;">${discountLabel} de desconto</strong>.`, `The invitation price is <strong style="color:#ffffff;">${monthlyPriceLabel}/month</strong>, including a <strong style="color:#ffffff;">${discountLabel} discount</strong>.`)}</p>
      <p style="margin:0;">${localize(language, `O tipo de acesso ${accountTypeLabel} já foi definido pela agência convidante. O link é individual e fica disponível até <strong style="color:#ffffff;">${expiresLabel}</strong>.`, `The inviting agency has already selected ${accountTypeLabel} access. This personal link is available until <strong style="color:#ffffff;">${expiresLabel}</strong>.`)}</p>
    `,
    ctaLabel: localize(language, 'Ver e aceitar o convite', 'View and accept invitation'),
    ctaUrl: options.invitationUrl,
  })

  await deliverEmail({
    from: EMAIL_FROM,
    to: options.to,
    subject: localize(language, '{agency} convidou você — Keepr One', '{agency} invited you — Keepr One', { agency: safeAgencyHeader }),
    html,
  })
}

export async function sendNoticeEmail(options: {
  to: string
  subject: string
  heading: string
  bodyHtml: string
  ctaLabel?: string
  ctaUrl?: string
  language?: UserLanguage
}): Promise<void> {
  const html = renderEmailLayout({
    language: options.language,
    heading: options.heading,
    bodyHtml: options.bodyHtml,
    ctaLabel: options.ctaLabel,
    ctaUrl: options.ctaUrl,
  })

  await deliverEmail({
    from: EMAIL_FROM,
    to: options.to,
    subject: options.subject,
    html,
  })
}
