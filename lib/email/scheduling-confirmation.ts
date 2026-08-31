import 'server-only'

import {
  buildGoogleCalendarUrl,
  buildIcsCalendar,
  buildOutlookCalendarUrl,
  calendarExportFilename,
  type CalendarEventDetails,
} from '@/lib/scheduling/calendar-export'
import { renderEmailLayout } from './layout'

export type SchedulingConfirmationEmailContentInput = {
  bookingId: string
  inviteeName: string
  ownerName: string
  title: string
  startsAt: Date
  endsAt: Date
  generatedAt: Date
  inviteeTimeZone: string
  meetingUrl?: string | null
  calendarSyncFailed?: boolean
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function sanitizeHeader(value: string) {
  return value.replace(/[\r\n]+/g, ' ').trim()
}

function validMeetingUrl(value: string | null | undefined) {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

function scheduleLabels(startsAt: Date, endsAt: Date, timeZone: string) {
  const date = new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone,
  }).format(startsAt)
  const timeFormatter = new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  })
  const offset = new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    timeZoneName: 'shortOffset',
  }).formatToParts(startsAt).find((part) => part.type === 'timeZoneName')?.value
  const zoneName = timeZone.replaceAll('_', ' ')
  return {
    date,
    time: `${timeFormatter.format(startsAt)} – ${timeFormatter.format(endsAt)}`,
    timeZone: offset ? `${zoneName} (${offset})` : zoneName,
  }
}

function detailsRow(label: string, value: string) {
  return `
    <tr>
      <td style="padding:10px 12px; border-top:1px solid rgba(255,255,255,0.12); color:rgba(255,255,255,0.52); font-size:12px; vertical-align:top; width:76px;">${label}</td>
      <td style="padding:10px 12px; border-top:1px solid rgba(255,255,255,0.12); color:#ffffff; font-size:15px; font-weight:600; vertical-align:top;">${value}</td>
    </tr>`
}

export function renderSchedulingConfirmationEmail(
  input: SchedulingConfirmationEmailContentInput,
) {
  const event: CalendarEventDetails = {
    id: input.bookingId,
    title: input.title,
    ownerName: input.ownerName,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    timeZone: input.inviteeTimeZone,
    meetingUrl: input.meetingUrl,
  }
  const labels = scheduleLabels(input.startsAt, input.endsAt, input.inviteeTimeZone)
  const googleUrl = buildGoogleCalendarUrl(event)
  const outlookUrl = buildOutlookCalendarUrl(event)
  const meetingUrl = validMeetingUrl(input.meetingUrl)
  const safeName = escapeHtml(input.inviteeName)
  const safeTitle = escapeHtml(input.title)
  const safeOwner = escapeHtml(input.ownerName)
  const safeGoogleUrl = escapeHtml(googleUrl)
  const safeOutlookUrl = escapeHtml(outlookUrl)
  const meetingBlock = meetingUrl
    ? `<p style="margin:16px 0 0;">A reunião será pelo Google Meet: <a href="${escapeHtml(meetingUrl)}" style="color:#ffffff; font-weight:600; text-decoration:underline;">abrir sala da reunião</a>.</p>`
    : input.calendarSyncFailed
      ? '<p style="margin:16px 0 0;">Seu horário está reservado na Keepr One. Use o arquivo .ics ou os links acima para salvar o compromisso enquanto o convite do Google Agenda é revisado.</p>'
      : '<p style="margin:16px 0 0;">O link do Google Meet também será enviado pelo convite oficial do Google Agenda.</p>'
  const bodyHtml = `
    <p style="margin:0 0 16px;">Olá, <strong style="color:#ffffff;">${safeName}</strong>. Seu horário está reservado.</p>
    <p style="margin:0 0 18px; color:#ffffff; font-size:15px; font-weight:600;">${safeTitle}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px; border-bottom:1px solid rgba(255,255,255,0.12);">
      ${detailsRow('Com', safeOwner)}
      ${detailsRow('Data', escapeHtml(labels.date))}
      ${detailsRow('Horário', escapeHtml(labels.time))}
      ${detailsRow('Fuso', escapeHtml(labels.timeZone))}
    </table>
    <p style="margin:0;">Para salvar o compromisso, use o botão abaixo, abra no <a href="${safeOutlookUrl}" style="color:#ffffff; font-weight:600; text-decoration:underline;">Microsoft Outlook</a> ou importe o arquivo <strong style="color:#ffffff;">.ics</strong> anexado no Apple Calendar e em outros calendários compatíveis.</p>
    <p style="margin:12px 0 0;">Se o compromisso já apareceu na sua agenda pelo convite do Google, não importe o anexo novamente.</p>
    ${meetingBlock}
  `
  const html = renderEmailLayout({
    preheader: `Agendamento confirmado: ${escapeHtml(input.title)}`,
    heading: 'Agendamento confirmado',
    bodyHtml,
    ctaLabel: 'Adicionar ao Google Agenda',
    ctaUrl: safeGoogleUrl,
    copyrightYear: input.generatedAt.getUTCFullYear(),
  })
  const text = [
    `Olá, ${input.inviteeName}. Seu agendamento está confirmado.`,
    '',
    input.title,
    `Com: ${input.ownerName}`,
    `Data: ${labels.date}`,
    `Horário: ${labels.time}`,
    `Fuso: ${labels.timeZone}`,
    meetingUrl
      ? `Google Meet: ${meetingUrl}`
      : input.calendarSyncFailed
        ? 'Use o arquivo .ics ou os links deste e-mail para salvar o compromisso enquanto o convite do Google Agenda é revisado.'
        : 'O link do Google Meet será enviado pelo convite oficial do Google Agenda.',
    '',
    `Adicionar ao Google Agenda: ${googleUrl}`,
    `Adicionar ao Microsoft Outlook: ${outlookUrl}`,
    'Também anexamos um arquivo .ics compatível com Apple Calendar e outros calendários.',
    'Se o compromisso já apareceu na sua agenda pelo convite do Google, não importe o anexo novamente.',
  ].join('\n')

  return {
    subject: sanitizeHeader(`Agendamento confirmado: ${input.title}`),
    html,
    text,
    calendarAttachment: buildIcsCalendar(event, input.generatedAt),
    calendarFilename: calendarExportFilename(input.title),
    googleUrl,
    outlookUrl,
  }
}
