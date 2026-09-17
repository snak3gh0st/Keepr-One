import { localize } from '@/lib/i18n/catalog'
import type { UserLanguage } from '@/lib/i18n/config'
import type { RetentionEmailStepKey } from '@/lib/billing/retention-email-schedule'

export type RetentionOfferEmailContent = {
  subject: string
  preheader: string
  heading: string
  bodyHtml: string
  ctaLabel: string
}

export type RetentionOfferEmailInput = {
  step: RetentionEmailStepKey
  agentName: string
  percentOff: number
  durationInMonths: number | null
  fullPriceLabel: string
  discountedPriceLabel: string
  accessEndsLabel: string
  language?: UserLanguage
}

/**
 * Escapes interpolated values before they reach an HTML email body.
 *
 * Names and plan labels come from user-controlled or administrative input, and
 * an email client renders this markup without any framework escaping it first.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Builds the message for one step of the nurture sequence.
 *
 * Separated from delivery so the wording is testable without a mail provider,
 * and so a step can never be sent with another step's subject line.
 */
export function renderRetentionOfferEmail(
  input: RetentionOfferEmailInput,
): RetentionOfferEmailContent {
  const language = input.language ?? 'PT'
  const copy = (portuguese: string, english: string) => localize(language, portuguese, english)
  const name = escapeHtml(input.agentName)
  const full = escapeHtml(input.fullPriceLabel)
  const discounted = escapeHtml(input.discountedPriceLabel)
  const endsAt = escapeHtml(input.accessEndsLabel)

  const priceLine = `
    <p style="margin:0 0 16px;">
      ${copy(
        `<strong style="color:#ffffff;">${discounted}/mês</strong> em vez de ${full}/mês.`,
        `<strong style="color:#ffffff;">${discounted}/month</strong> instead of ${full}/month.`,
      )}
    </p>`

  const durationLine = input.durationInMonths
    ? `<p style="margin:0; font-size:13px; opacity:0.75;">${copy(
        `Desconto de ${input.percentOff}% nos primeiros ${input.durationInMonths} meses. Depois, ${full}/mês.`,
        `${input.percentOff}% off for the first ${input.durationInMonths} months. After that, ${full}/month.`,
      )}</p>`
    : `<p style="margin:0; font-size:13px; opacity:0.75;">${copy(
        `Desconto de ${input.percentOff}% enquanto a assinatura estiver ativa.`,
        `${input.percentOff}% off while the subscription stays active.`,
      )}</p>`

  if (input.step === 'ACCESS_LAPSED') {
    return {
      subject: copy(
        'Sua conta Keepr One continua guardada — 50% para voltar',
        'Your Keepr One account is still saved — 50% off to come back',
      ),
      preheader: copy(
        'Seus clientes e sua carteira seguem exatamente como você deixou.',
        'Your clients and your book are exactly as you left them.',
      ),
      heading: copy(`${name}, seus dados continuam aqui`, `${name}, your data is still here`),
      bodyHtml: `
        <p style="margin:0 0 16px;">${copy(
          `Seu acesso terminou em ${endsAt}, mas nada foi apagado: sua carteira, seus clientes e seu histórico continuam guardados.`,
          `Your access ended on ${endsAt}, but nothing was deleted: your book, your clients, and your history are still saved.`,
        )}</p>
        ${priceLine}
        ${durationLine}
      `,
      ctaLabel: copy('Reativar com 50% de desconto', 'Reactivate with 50% off'),
    }
  }

  const urgency = input.step === 'TRIAL_ENDING_1D'
    ? copy('termina amanhã', 'ends tomorrow')
    : input.step === 'TRIAL_ENDING_3D'
      ? copy('termina em 3 dias', 'ends in 3 days')
      : copy('termina em uma semana', 'ends in a week')

  return {
    subject: copy(
      `Seu acesso ${urgency} — continue com 50% de desconto`,
      `Your access ${urgency} — continue with 50% off`,
    ),
    preheader: copy(
      'Ative a assinatura sem perder nada do que você já construiu.',
      'Activate your subscription without losing anything you have built.',
    ),
    heading: copy(`${name}, seu acesso ${urgency}`, `${name}, your access ${urgency}`),
    bodyHtml: `
      <p style="margin:0 0 16px;">${copy(
        `Seu período de teste vai até ${endsAt}. Para continuar sem interrupção, ative a assinatura com desconto.`,
        `Your trial runs until ${endsAt}. To continue without interruption, activate your subscription at a discount.`,
      )}</p>
      ${priceLine}
      ${durationLine}
    `,
    ctaLabel: copy('Ativar com 50% de desconto', 'Activate with 50% off'),
  }
}
