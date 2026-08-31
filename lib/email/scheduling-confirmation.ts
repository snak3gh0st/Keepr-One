import 'server-only'

import {
  buildGoogleCalendarUrl,
  buildIcsCalendar,
  buildOutlookCalendarUrl,
  calendarExportFilename,
  type CalendarEventDetails,
} from '@/lib/scheduling/calendar-export'
import { renderEmailLayout } from './layout'
import { localize } from '@/lib/i18n/catalog'
import { localeFor, type UserLanguage } from '@/lib/i18n/config'

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
  language?: UserLanguage
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

function scheduleLabels(startsAt: Date, endsAt: Date, timeZone: string, language: UserLanguage) {
  const locale = localeFor(language)
  const date = new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone,
  }).format(startsAt)
  const timeFormatter = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  })
  const offset = new Intl.DateTimeFormat(locale, {
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
  const language = input.language ?? 'PT'
  const event: CalendarEventDetails = {
    id: input.bookingId,
    title: input.title,
    ownerName: input.ownerName,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    timeZone: input.inviteeTimeZone,
    meetingUrl: input.meetingUrl,
  }
  const labels = scheduleLabels(input.startsAt, input.endsAt, input.inviteeTimeZone, language)
  const googleUrl = buildGoogleCalendarUrl(event)
  const outlookUrl = buildOutlookCalendarUrl(event)
  const meetingUrl = validMeetingUrl(input.meetingUrl)
  const safeName = escapeHtml(input.inviteeName)
  const safeTitle = escapeHtml(input.title)
  const safeOwner = escapeHtml(input.ownerName)
  const safeGoogleUrl = escapeHtml(googleUrl)
  const safeOutlookUrl = escapeHtml(outlookUrl)
  const meetingBlock = meetingUrl
    ? `<p style="margin:16px 0 0;">${localize(language, `A reunião será pelo Google Meet: <a href="${escapeHtml(meetingUrl)}" style="color:#ffffff; font-weight:600; text-decoration:underline;">abrir sala da reunião</a>.`, `The meeting will be on Google Meet: <a href="${escapeHtml(meetingUrl)}" style="color:#ffffff; font-weight:600; text-decoration:underline;">open the meeting room</a>.`)}</p>`
    : input.calendarSyncFailed
      ? `<p style="margin:16px 0 0;">${localize(language, 'Seu horário está reservado na Keepr One. Use o arquivo .ics ou os links acima para salvar o compromisso enquanto o convite do Google Agenda é revisado.', 'Your time is reserved in Keepr One. Use the .ics file or the links above to save the event while the Google Calendar invitation is reviewed.')}</p>`
      : `<p style="margin:16px 0 0;">${localize(language, 'O link do Google Meet também será enviado pelo convite oficial do Google Agenda.', 'The Google Meet link will also be sent in the official Google Calendar invitation.')}</p>`
  const bodyHtml = `
    <p style="margin:0 0 16px;">${localize(language, `Olá, <strong style="color:#ffffff;">${safeName}</strong>. Seu horário está reservado.`, `Hello, <strong style="color:#ffffff;">${safeName}</strong>. Your time is reserved.`)}</p>
    <p style="margin:0 0 18px; color:#ffffff; font-size:15px; font-weight:600;">${safeTitle}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px; border-bottom:1px solid rgba(255,255,255,0.12);">
      ${detailsRow(localize(language, 'Com', 'With'), safeOwner)}
      ${detailsRow(localize(language, 'Data', 'Date'), escapeHtml(labels.date))}
      ${detailsRow(localize(language, 'Horário', 'Time'), escapeHtml(labels.time))}
      ${detailsRow(localize(language, 'Fuso', 'Time zone'), escapeHtml(labels.timeZone))}
    </table>
    <p style="margin:0;">${localize(language, `Para salvar o compromisso, use o botão abaixo, abra no <a href="${safeOutlookUrl}" style="color:#ffffff; font-weight:600; text-decoration:underline;">Microsoft Outlook</a> ou importe o arquivo <strong style="color:#ffffff;">.ics</strong> anexado no Apple Calendar e em outros calendários compatíveis.`, `To save the event, use the button below, open it in <a href="${safeOutlookUrl}" style="color:#ffffff; font-weight:600; text-decoration:underline;">Microsoft Outlook</a>, or import the attached <strong style="color:#ffffff;">.ics</strong> file into Apple Calendar or another compatible calendar.`)}</p>
    <p style="margin:12px 0 0;">${localize(language, 'Se o compromisso já apareceu na sua agenda pelo convite do Google, não importe o anexo novamente.', 'If the event already appeared in your calendar through the Google invitation, do not import the attachment again.')}</p>
    ${meetingBlock}
  `
  const html = renderEmailLayout({
    language,
    preheader: localize(language, 'Agendamento confirmado: {title}', 'Booking confirmed: {title}', { title: escapeHtml(input.title) }),
    heading: localize(language, 'Agendamento confirmado', 'Booking confirmed'),
    bodyHtml,
    ctaLabel: localize(language, 'Adicionar ao Google Agenda', 'Add to Google Calendar'),
    ctaUrl: safeGoogleUrl,
    copyrightYear: input.generatedAt.getUTCFullYear(),
  })
  const text = [
    localize(language, 'Olá, {name}. Seu agendamento está confirmado.', 'Hello, {name}. Your booking is confirmed.', { name: input.inviteeName }),
    '',
    input.title,
    `${localize(language, 'Com', 'With')}: ${input.ownerName}`,
    `${localize(language, 'Data', 'Date')}: ${labels.date}`,
    `${localize(language, 'Horário', 'Time')}: ${labels.time}`,
    `${localize(language, 'Fuso', 'Time zone')}: ${labels.timeZone}`,
    meetingUrl
      ? `Google Meet: ${meetingUrl}`
      : input.calendarSyncFailed
        ? localize(language, 'Use o arquivo .ics ou os links deste e-mail para salvar o compromisso enquanto o convite do Google Agenda é revisado.', 'Use the .ics file or the links in this email to save the event while the Google Calendar invitation is reviewed.')
        : localize(language, 'O link do Google Meet será enviado pelo convite oficial do Google Agenda.', 'The Google Meet link will be sent in the official Google Calendar invitation.'),
    '',
    `${localize(language, 'Adicionar ao Google Agenda', 'Add to Google Calendar')}: ${googleUrl}`,
    `${localize(language, 'Adicionar ao Microsoft Outlook', 'Add to Microsoft Outlook')}: ${outlookUrl}`,
    localize(language, 'Também anexamos um arquivo .ics compatível com Apple Calendar e outros calendários.', 'We also attached an .ics file compatible with Apple Calendar and other calendars.'),
    localize(language, 'Se o compromisso já apareceu na sua agenda pelo convite do Google, não importe o anexo novamente.', 'If the event already appeared in your calendar through the Google invitation, do not import the attachment again.'),
  ].join('\n')

  return {
    subject: sanitizeHeader(localize(language, 'Agendamento confirmado: {title}', 'Booking confirmed: {title}', { title: input.title })),
    html,
    text,
    calendarAttachment: buildIcsCalendar(event, input.generatedAt),
    calendarFilename: calendarExportFilename(input.title),
    googleUrl,
    outlookUrl,
  }
}
