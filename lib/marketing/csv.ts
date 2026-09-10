import type { MarketingLeadRow } from './types'

/** Quoting alone does not stop spreadsheet formulas; neutralize their prefixes. */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value)
  if (/^[\s\u0000-\u001f\u007f\ufeff]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}

export type ExportLead = MarketingLeadRow & {
  utmSource: string | null; utmMedium: string | null; utmCampaign: string | null
  utmContent: string | null; utmTerm: string | null
}

export function marketingLeadsCsv(leads: ExportLead[]): string {
  const header = ['ID', 'Nome', 'Email', 'Telefone', 'Status', 'Campanha', 'Origem', 'Responsável', 'Cadastrado em (UTC)', 'Próximo contato (UTC)', 'UTM Source', 'UTM Medium', 'UTM Campaign', 'UTM Content', 'UTM Term']
  const rows = leads.map((lead) => [
    lead.id, lead.name, lead.email, lead.phone, lead.status, lead.campaign.name, lead.source,
    lead.owner?.name ?? '', lead.createdAt, lead.nextContactAt,
    lead.utmSource, lead.utmMedium, lead.utmCampaign, lead.utmContent, lead.utmTerm,
  ])
  return '\ufeff' + [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
}
