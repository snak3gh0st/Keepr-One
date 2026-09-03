import { beforeEach, describe, expect, it, vi } from 'vitest'

const emailsSend = vi.hoisted(() => vi.fn().mockResolvedValue({ data: { id: 'email-1' }, error: null }))

vi.mock('./client', () => ({
  getResendClient: () => ({ emails: { send: emailsSend } }),
  EMAIL_FROM: 'Keepr One <notificacoes@keeprone.com>',
}))

import {
  EmailDeliveryError,
  sendAdminEmailChangeAuthorizationEmail,
  sendAdminEmailChangeVerificationEmail,
  sendAgencyInvitationEmail,
  sendChangeEmailConfirmationEmail,
  sendFounderWelcomeEmail,
  sendNoticeEmail,
  sendResetPasswordEmail,
  sendSchedulingConfirmationEmail,
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

  it('starts an admin change at the current inbox and requires both approvals', async () => {
    await sendAdminEmailChangeAuthorizationEmail({
      to: 'atual@example.com',
      accountName: '<Maria>',
      newEmail: '<novo&seguro@example.com>',
      authorizationUrl: 'https://app.keeprone.com/confirm-email-change?token=current-safe',
      expiresAt: new Date('2026-09-01T20:00:00.000Z'),
      idempotencyKey: 'admin-email-change-current-request-1',
    })

    const [payload, requestOptions] = emailsSend.mock.calls[0]
    expect(payload.to).toBe('atual@example.com')
    expect(payload.html).toContain('&lt;novo&amp;seguro@example.com&gt;')
    expect(payload.html).toContain('primeira de duas confirmações')
    expect(payload.html).toContain('token=current-safe')
    expect(requestOptions).toEqual({ idempotencyKey: 'admin-email-change-current-request-1' })
  })

  it('sends the second approval only to the new inbox', async () => {
    await sendAdminEmailChangeVerificationEmail({
      to: 'novo@example.com',
      accountName: 'Maria',
      confirmationUrl: 'https://app.keeprone.com/confirm-email-change?token=new-safe',
      expiresAt: new Date('2026-09-01T21:00:00.000Z'),
      idempotencyKey: 'admin-email-change-new-request-1-v2',
    })

    const [payload, requestOptions] = emailsSend.mock.calls[0]
    expect(payload.to).toBe('novo@example.com')
    expect(payload.html).toContain('endereço atual da sua conta já autorizou')
    expect(payload.html).toContain('token=new-safe')
    expect(requestOptions).toEqual({ idempotencyKey: 'admin-email-change-new-request-1-v2' })
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

  it('sends an idempotent scheduling confirmation with a universal calendar attachment', async () => {
    await sendSchedulingConfirmationEmail({
      bookingId: 'booking-1',
      to: 'cliente@example.com',
      inviteeName: 'Ana Cliente',
      ownerName: 'Maria Silva',
      title: 'Conversa de 30 minutos',
      startsAt: new Date('2026-08-29T13:00:00.000Z'),
      endsAt: new Date('2026-08-29T13:30:00.000Z'),
      generatedAt: new Date('2026-08-28T17:00:00.000Z'),
      inviteeTimeZone: 'America/New_York',
      idempotencyKey: 'scheduling-confirmation-booking-1-v1',
    })

    expect(emailsSend).toHaveBeenCalledOnce()
    const [payload, requestOptions] = emailsSend.mock.calls[0]
    expect(payload).toMatchObject({
      from: 'Keepr One <notificacoes@keeprone.com>',
      to: 'cliente@example.com',
      subject: 'Agendamento confirmado: Conversa de 30 minutos',
      attachments: [{
        filename: 'conversa-de-30-minutos.ics',
        contentType: 'text/calendar; charset=utf-8; method=PUBLISH',
      }],
    })
    expect(requestOptions).toEqual({
      idempotencyKey: 'scheduling-confirmation-booking-1-v1',
    })
    const encodedCalendar = payload.attachments?.[0]?.content
    expect(typeof encodedCalendar).toBe('string')
    const calendar = Buffer.from(String(encodedCalendar), 'base64').toString('utf8')
    expect(calendar).toContain('UID:booking-1@calendar.keeprone.com')
    expect(calendar).toContain('DTSTAMP:20260828T170000Z')
    expect(payload.html).toContain('Adicionar ao Google Agenda')
    expect(payload.text).toContain('Microsoft Outlook')
  })

  it('keeps a concurrent Resend idempotency request eligible for retry', async () => {
    emailsSend.mockResolvedValueOnce({
      data: null,
      error: {
        name: 'concurrent_idempotent_requests',
        message: 'Another request with this key is still being processed',
        statusCode: 409,
      },
    })

    const delivery = sendSchedulingConfirmationEmail({
      bookingId: 'booking-1',
      to: 'cliente@example.com',
      inviteeName: 'Ana Cliente',
      ownerName: 'Maria Silva',
      title: 'Conversa de 30 minutos',
      startsAt: new Date('2026-08-29T13:00:00.000Z'),
      endsAt: new Date('2026-08-29T13:30:00.000Z'),
      generatedAt: new Date('2026-08-28T17:00:00.000Z'),
      inviteeTimeZone: 'America/New_York',
      idempotencyKey: 'scheduling-confirmation-booking-1-v1',
    })

    await expect(delivery).rejects.toEqual(expect.objectContaining<Partial<EmailDeliveryError>>({
      code: 'concurrent_idempotent_requests',
      retryable: true,
    }))
  })
})
