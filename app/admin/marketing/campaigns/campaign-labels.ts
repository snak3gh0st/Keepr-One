import type { CampaignChannel, CampaignStatus } from '@/lib/marketing/types'
import type { UserLanguage } from '@/lib/i18n/config'
import { formatDate } from '@/lib/i18n/format'

type Copy = (portuguese: string, english: string) => string

export function campaignChannelLabel(channel: CampaignChannel, copy: Copy) {
  const labels: Record<CampaignChannel, string> = {
    ORGANIC: copy('Orgânico', 'Organic'),
    META_ADS: 'Meta Ads',
    GOOGLE_ADS: 'Google Ads',
    EMAIL: copy('E-mail', 'Email'),
    WHATSAPP: 'WhatsApp',
    OTHER: copy('Outro', 'Other'),
  }
  return labels[channel]
}

export function campaignStatusLabel(status: CampaignStatus, copy: Copy) {
  const labels: Record<CampaignStatus, string> = {
    DRAFT: copy('Rascunho', 'Draft'),
    ACTIVE: copy('Ativa', 'Active'),
    PAUSED: copy('Pausada', 'Paused'),
    COMPLETED: copy('Concluída', 'Completed'),
  }
  return labels[status]
}

export function campaignPeriod(startsAt: string | null, endsAt: string | null, language: UserLanguage, copy: Copy) {
  const date = (value: string) => formatDate(value, language, { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
  if (startsAt && endsAt) return `${date(startsAt)} – ${date(endsAt)}`
  if (startsAt) return copy(`A partir de ${date(startsAt)}`, `From ${date(startsAt)}`)
  if (endsAt) return copy(`Até ${date(endsAt)}`, `Until ${date(endsAt)}`)
  return copy('Sem período definido', 'No dates set')
}

export function campaignCapturePath(slug: string, channel: CampaignChannel) {
  const medium: Record<CampaignChannel, string> = {
    ORGANIC: 'organic',
    META_ADS: 'paid_social',
    GOOGLE_ADS: 'cpc',
    EMAIL: 'email',
    WHATSAPP: 'messaging',
    OTHER: 'referral',
  }
  const params = new URLSearchParams({
    marketing_campaign: slug,
    utm_source: channel.toLowerCase(),
    utm_medium: medium[channel],
    utm_campaign: slug,
  })
  return `/founders?${params.toString()}`
}
