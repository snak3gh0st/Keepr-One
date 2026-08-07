import 'server-only'
import { getResendClient, EMAIL_FROM } from './client'
import { renderEmailLayout } from './layout'

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

  await getResendClient().emails.send({
    from: EMAIL_FROM,
    to: options.to,
    subject: 'Redefinir sua senha — Keepr One',
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

  await getResendClient().emails.send({
    from: EMAIL_FROM,
    to: options.to,
    subject: 'Bem-vindo ao Keepr One',
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

  await getResendClient().emails.send({
    from: EMAIL_FROM,
    to: options.to,
    subject: options.subject,
    html,
  })
}
