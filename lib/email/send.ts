import 'server-only'
import type { CreateEmailOptions, CreateEmailRequestOptions } from 'resend'
import {
  AGENCY_INVITATION_DISCOUNT_CENTS,
  formatPlanPrice,
} from '@/lib/plans'
import { getResendClient, EMAIL_FROM } from './client'
import { renderEmailLayout } from './layout'
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
}): Promise<void> {
  const html = renderEmailLayout({
    preheader: 'Redefina sua senha do Keepr One',
    heading: 'Redefinir sua senha',
    bodyHtml: `
      <p style="margin:0 0 16px;">Recebemos um pedido para redefinir a senha da sua conta Keepr One.</p>
      <p style="margin:0;">Se foi você, clique no botão abaixo. Este link expira em breve e só pode ser usado uma vez.</p>
    `,
    ctaLabel: 'Redefinir senha',
    ctaUrl: options.resetUrl,
  })

  await deliverEmail({
    from: EMAIL_FROM,
    to: options.to,
    subject: 'Redefinir sua senha — Keepr One',
    html,
  })
}

export async function sendVerificationEmail(options: {
  to: string
  verificationUrl: string
}): Promise<void> {
  const html = renderEmailLayout({
    preheader: 'Confirme seu novo e-mail no Keepr One',
    heading: 'Confirme seu endereço de e-mail',
    bodyHtml: `
      <p style="margin:0 0 16px;">Recebemos uma solicitação para usar este endereço na sua conta Keepr One.</p>
      <p style="margin:0;">Confirme pelo botão abaixo. Seu e-mail de acesso só será alterado depois desta verificação.</p>
    `,
    ctaLabel: 'Confirmar novo e-mail',
    ctaUrl: options.verificationUrl,
  })

  await deliverEmail({
    from: EMAIL_FROM,
    to: options.to,
    subject: 'Confirme seu e-mail — Keepr One',
    html,
  })
}

export async function sendWelcomeEmail(options: { to: string; agentName: string }): Promise<void> {
  const html = renderEmailLayout({
    preheader: 'Sua conta Keepr One está pronta',
    heading: `Bem-vindo, ${options.agentName}`,
    bodyHtml: `
      <p style="margin:0;">Sua conta no Keepr One foi criada com sucesso. Você já pode acessar a plataforma e conectar suas integrações de carrier.</p>
    `,
    ctaLabel: 'Acessar o Keepr One',
    ctaUrl: 'https://app.keeprone.com',
  })

  await deliverEmail({
    from: EMAIL_FROM,
    to: options.to,
    subject: 'Bem-vindo ao Keepr One',
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
}): Promise<void> {
  const safeNewEmail = escapeEmailText(options.newEmail)
  const html = renderEmailLayout({
    preheader: 'Autorize a alteração do e-mail da sua conta',
    heading: 'Você solicitou esta alteração?',
    bodyHtml: `
      <p style="margin:0 0 16px;">Foi solicitada a troca do e-mail da sua conta para <strong style="color:#ffffff;">${safeNewEmail}</strong>.</p>
      <p style="margin:0;">Autorize pelo botão abaixo. Depois disso, também confirmaremos o novo endereço antes de concluir a mudança.</p>
    `,
    ctaLabel: 'Autorizar alteração',
    ctaUrl: options.confirmationUrl,
  })

  await deliverEmail({
    from: EMAIL_FROM,
    to: options.to,
    subject: 'Autorize a alteração do seu e-mail — Keepr One',
    html,
  })
}

export async function sendFounderWelcomeEmail(options: {
  to: string
  founderName: string
  accountType: 'AGENT' | 'AGENCY'
  trialEndsAt: Date
  loginUrl: string
}): Promise<void> {
  const safeName = escapeEmailText(options.founderName)
  const planLabel = options.accountType === 'AGENCY' ? 'Agência' : 'Agente'
  const trialEndLabel = new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'long',
    timeZone: 'UTC',
  }).format(options.trialEndsAt)
  const html = renderEmailLayout({
    preheader: 'Seu acesso Founder de 30 dias está pronto',
    heading: `Bem-vindo ao programa Founders, ${safeName}`,
    bodyHtml: `
      <p style="margin:0 0 16px;">Seu acesso ao plano ${planLabel} já está ativo por 30 dias, com término em <strong style="color:#ffffff;">${trialEndLabel}</strong>.</p>
      <p style="margin:0;">Você não será cobrado agora. Para manter o acesso depois desse período, será necessário ativar uma assinatura.</p>
    `,
    ctaLabel: 'Acessar a plataforma',
    ctaUrl: options.loginUrl,
  })

  await deliverEmail({
    from: EMAIL_FROM,
    to: options.to,
    subject: 'Seu acesso Founder está pronto — Keepr One',
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
}): Promise<void> {
  const safeInviteeName = options.inviteeName?.trim()
    ? escapeEmailText(options.inviteeName.trim())
    : 'Olá'
  const safeAgencyName = escapeEmailText(options.agencyName)
  const safeAgencyHeader = sanitizeEmailHeader(options.agencyName)
  const accountTypeLabel = options.intendedType === 'AGENCY' ? 'Agência' : 'Agente'
  const accountTypeArticle = options.intendedType === 'AGENCY' ? 'uma agência' : 'um agente'
  const monthlyPriceLabel = escapeEmailText(formatPlanPrice(options.monthlyPriceCents))
  const discountLabel = escapeEmailText(formatPlanPrice(AGENCY_INVITATION_DISCOUNT_CENTS))
  const expiresLabel = new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'long',
    timeZone: 'UTC',
  }).format(options.expiresAt)
  const html = renderEmailLayout({
    preheader: `${safeAgencyName} convidou você para o Keepr One`,
    heading: safeInviteeName,
    bodyHtml: `
      <p style="margin:0 0 16px;">A <strong style="color:#ffffff;">${safeAgencyName}</strong> convidou você para fazer parte da estrutura no Keepr One como <strong style="color:#ffffff;">${accountTypeArticle}</strong>.</p>
      <p style="margin:0 0 16px;">A mensalidade pelo convite é <strong style="color:#ffffff;">${monthlyPriceLabel}/mês</strong>, já com <strong style="color:#ffffff;">${discountLabel} de desconto</strong>.</p>
      <p style="margin:0;">O tipo de acesso ${accountTypeLabel} já foi definido pela agência convidante. O link é individual e fica disponível até <strong style="color:#ffffff;">${expiresLabel}</strong>.</p>
    `,
    ctaLabel: 'Ver e aceitar o convite',
    ctaUrl: options.invitationUrl,
  })

  await deliverEmail({
    from: EMAIL_FROM,
    to: options.to,
    subject: `${safeAgencyHeader} convidou você — Keepr One`,
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
}): Promise<void> {
  const html = renderEmailLayout({
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
