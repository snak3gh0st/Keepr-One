import { describe, expect, it } from 'vitest'
import { renderSchedulingConfirmationEmail } from './scheduling-confirmation'

const input = {
  bookingId: 'booking-1',
  inviteeName: '<Ana & João>',
  ownerName: 'Maria; Silva',
  title: 'Conversa, proteção & renda',
  startsAt: new Date('2026-08-29T13:00:00.000Z'),
  endsAt: new Date('2026-08-29T13:30:00.000Z'),
  generatedAt: new Date('2026-08-28T17:00:00.000Z'),
  inviteeTimeZone: 'America/New_York',
}

describe('scheduling confirmation email', () => {
  it('renders escaped booking details in the invitee timezone', () => {
    const content = renderSchedulingConfirmationEmail(input)

    expect(content.subject).toBe('Agendamento confirmado: Conversa, proteção & renda')
    expect(content.html).toContain('&lt;Ana &amp; João&gt;')
    expect(content.html).not.toContain('<Ana & João>')
    expect(content.html).toContain('sábado, 29 de agosto de 2026')
    expect(content.html).toContain('09:00 – 09:30')
    expect(content.html).toContain('America/New York (GMT-4)')
    expect(content.html).toContain('Microsoft Outlook')
    expect(content.html).toContain('não importe o anexo novamente')
    expect(content.text).toContain('Adicionar ao Google Agenda: https://calendar.google.com')
  })

  it('keeps the message and ICS byte-identical across retries', () => {
    const first = renderSchedulingConfirmationEmail(input)
    const retry = renderSchedulingConfirmationEmail(input)

    expect(retry).toEqual(first)
    expect(first.calendarAttachment).toContain('DTSTAMP:20260828T170000Z\r\n')
    expect(first.calendarAttachment).toContain('UID:booking-1@calendar.keeprone.com\r\n')
    expect(first.calendarAttachment).toMatch(/END:VCALENDAR\r\n$/)
  })

  it('includes only a valid HTTPS meeting URL', () => {
    const withMeet = renderSchedulingConfirmationEmail({
      ...input,
      meetingUrl: 'https://meet.google.com/abc-defg-hij',
    })
    expect(withMeet.html).toContain('https://meet.google.com/abc-defg-hij')
    expect(withMeet.calendarAttachment).toContain('URL:https://meet.google.com/abc-defg-hij')

    const unsafe = renderSchedulingConfirmationEmail({
      ...input,
      meetingUrl: 'javascript:alert(1)',
    })
    expect(unsafe.html).not.toContain('javascript:')
    expect(unsafe.calendarAttachment).not.toContain('javascript:')
  })

  it('does not promise a Google invitation after terminal calendar failure', () => {
    const failed = renderSchedulingConfirmationEmail({
      ...input,
      meetingUrl: null,
      calendarSyncFailed: true,
    })

    expect(failed.html).toContain('enquanto o convite do Google Agenda é revisado')
    expect(failed.text).not.toContain('será enviado pelo convite oficial')
    expect(failed.calendarAttachment).not.toContain('URL:https://meet.google.com')
  })
})
