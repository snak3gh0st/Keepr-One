import type { LeadStatus } from '@/lib/marketing/types'

export type MarketingCopy = (portuguese: string, english: string) => string

export function leadStatusLabel(status: LeadStatus, copy: MarketingCopy) {
  const labels: Record<LeadStatus, string> = {
    NEW: copy('Novo', 'New'),
    CONTACTED: copy('Em contato', 'Contacted'),
    QUALIFIED: copy('Qualificado', 'Qualified'),
    CONVERTED: copy('Convertido', 'Converted'),
    LOST: copy('Sem interesse', 'Not interested'),
  }
  return labels[status]
}

export function displayPhone(phone: string) {
  const match = phone.match(/^\+1(\d{3})(\d{3})(\d{4})$/)
  return match ? `+1 (${match[1]}) ${match[2]}-${match[3]}` : phone
}

export function isLeadOverdue(lead: { nextContactAt: string | null; status: LeadStatus }, now = Date.now()) {
  return Boolean(lead.nextContactAt && Date.parse(lead.nextContactAt) < now
    && lead.status !== 'CONVERTED' && lead.status !== 'LOST')
}
