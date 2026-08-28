import { beforeEach, describe, expect, it, vi } from 'vitest'

const emailsSend = vi.hoisted(() => vi.fn().mockResolvedValue({ data: { id: 'email-1' }, error: null }))

vi.mock('./client', () => ({
  getResendClient: () => ({ emails: { send: emailsSend } }),
  EMAIL_FROM: 'Keepr One <notificacoes@keeprone.com>',
}))

import {
  sendAgencyInvitationEmail,
  sendChangeEmailConfirmationEmail,
  sendFounderWelcomeEmail,
  sendNoticeEmail,
  sendResetPasswordEmail,
  sendVerificationEmail,
  sendWelcomeEmail,
} from './send'

describe('email send functions', () => {
  beforeEach(() => {
    emailsSend.mockReset()
    emailsSend.mockResolvedValue({ data: { id: 'email-1' }, error: null })
  })

  it('sends a reset-password email with the reset link in the body', async () => {
    await sendResetPasswordEmail({
      to: 'agent@example.com',
      resetUrl: 'https://app.keeprone.com/reset-password?token=xyz',
    })

    expect(emailsSend).toHaveBeenCalledTimes(1)
    const call = emailsSend.mock.calls[0][0]
    expect(call.to).toBe('agent@example.com')
    expect(call.from).toBe('Keepr One <notificacoes@keeprone.com>')
    expect(call.html).toContain('https://app.keeprone.com/reset-password?token=xyz')
  })

  it('sends verification only to the new inbox with the Better Auth URL', async () => {
    await sendVerificationEmail({
      to: 'novo@example.com',
      verificationUrl: 'https://app.keeprone.com/api/auth/verify-email?token=safe',
    })

    const call = emailsSend.mock.calls[0][0]
    expect(call.to).toBe('novo@example.com')
    expect(call.subject).toContain('Confirme seu e-mail')
    expect(call.html).toContain('https://app.keeprone.com/api/auth/verify-email?token=safe')
    expect(call.html).toContain('só será alterado depois desta verificação')
  })

  it('asks the current inbox to approve an escaped new address', async () => {
    await sendChangeEmailConfirmationEmail({
      to: 'atual@example.com',
      newEmail: '<novo&seguro@example.com>',
      confirmationUrl: 'https://app.keeprone.com/api/auth/verify-email?token=approve',
    })

    const call = emailsSend.mock.calls[0][0]
    expect(call.to).toBe('atual@example.com')
    expect(call.html).toContain('&lt;novo&amp;seguro@example.com&gt;')
    expect(call.html).not.toContain('<novo&seguro@example.com>')
    expect(call.html).toContain('https://app.keeprone.com/api/auth/verify-email?token=approve')
  })

  it('fails closed when the provider returns an error without throwing', async () => {
    emailsSend.mockResolvedValueOnce({
      data: null,
      error: { name: 'validation_error', message: 'rejected' },
    })

    await expect(sendVerificationEmail({
      to: 'novo@example.com',
      verificationUrl: 'https://app.keeprone.com/api/auth/verify-email?token=safe',
    })).rejects.toThrow('Email provider rejected the message')
  })

  it('sends a welcome email addressed to the agent by name', async () => {
    await sendWelcomeEmail({ to: 'agent@example.com', agentName: 'Maria' })

    const call = emailsSend.mock.calls[0][0]
    expect(call.to).toBe('agent@example.com')
    expect(call.html).toContain('Maria')
  })

  it('sends the founder plan, trial end and login link without trusting HTML in the name', async () => {
    await sendFounderWelcomeEmail({
      to: 'founder@example.com',
      founderName: '<Maria & João>',
      accountType: 'AGENCY',
      trialEndsAt: new Date('2026-09-25T14:30:00.000Z'),
      loginUrl: 'https://app.keeprone.com/login?founder=created',
    })

    const call = emailsSend.mock.calls[0][0]
    expect(call.to).toBe('founder@example.com')
    expect(call.subject).toContain('Founder')
    expect(call.html).toContain('&lt;Maria &amp; João&gt;')
    expect(call.html).not.toContain('<Maria & João>')
    expect(call.html).toContain('plano Agência')
    expect(call.html).toContain('25 de setembro de 2026')
    expect(call.html).toContain('https://app.keeprone.com/login?founder=created')
  })

  it('sends the one-time agency invitation link without trusting HTML or header breaks', async () => {
    await sendAgencyInvitationEmail({
      to: 'invitee@example.com',
      inviteeName: '<Maria>',
      agencyName: 'North & South\r\nBcc: attacker@example.com',
      intendedType: 'AGENCY',
      monthlyPriceCents: 8_990,
      invitationUrl: 'https://app.keeprone.com/convites/agencia/safe-token',
      expiresAt: new Date('2026-09-09T12:00:00.000Z'),
    })

    const call = emailsSend.mock.calls[0][0]
    expect(call.to).toBe('invitee@example.com')
    expect(call.subject).not.toContain('\r')
    expect(call.subject).not.toContain('\n')
    expect(call.html).toContain('&lt;Maria&gt;')
    expect(call.html).toContain('North &amp; South')
    expect(call.html).toContain('como <strong style="color:#ffffff;">uma agência</strong>')
    expect(call.html).toMatch(/US\$\s*89,90\/mês/)
    expect(call.html).toMatch(/US\$\s*10,00 de desconto/)
    expect(call.html).not.toContain('escolha entre o plano')
    expect(call.html).toContain('https://app.keeprone.com/convites/agencia/safe-token')
    expect(call.html).toContain('9 de setembro de 2026')
  })

  it('sends a generic notice email with the given subject and heading', async () => {
    await sendNoticeEmail({
      to: 'agent@example.com',
      subject: 'Aviso de manutenção',
      heading: 'Manutenção programada',
      bodyHtml: '<p>O sistema ficará indisponível às 22h.</p>',
    })

    const call = emailsSend.mock.calls[0][0]
    expect(call.subject).toBe('Aviso de manutenção')
    expect(call.html).toContain('Manutenção programada')
    expect(call.html).toContain('O sistema ficará indisponível às 22h.')
  })
})
