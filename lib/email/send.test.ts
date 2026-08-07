import { beforeEach, describe, expect, it, vi } from 'vitest'

const emailsSend = vi.hoisted(() => vi.fn().mockResolvedValue({ data: { id: 'email-1' }, error: null }))

vi.mock('./client', () => ({
  getResendClient: () => ({ emails: { send: emailsSend } }),
  EMAIL_FROM: 'Keepr One <notificacoes@keeprone.com>',
}))

import { sendNoticeEmail, sendResetPasswordEmail, sendWelcomeEmail } from './send'

describe('email send functions', () => {
  beforeEach(() => {
    emailsSend.mockClear()
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

  it('sends a welcome email addressed to the agent by name', async () => {
    await sendWelcomeEmail({ to: 'agent@example.com', agentName: 'Maria' })

    const call = emailsSend.mock.calls[0][0]
    expect(call.to).toBe('agent@example.com')
    expect(call.html).toContain('Maria')
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
