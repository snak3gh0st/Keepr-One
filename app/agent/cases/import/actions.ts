'use server'

import { headers } from 'next/headers'
import { getServerI18n } from '@/lib/i18n/server'
import { getCurrentAgent } from '@/lib/agent-context'
import { requireAgentModule } from '@/lib/require-agent-module'
import { assertSameOriginAction } from '@/lib/security/same-origin-action'
import { importCrmLeads, CRM_LEAD_IMPORT_MAX_BYTES, type CrmLeadImportResult } from '@/lib/crm/lead-import'
import { revalidatePath } from 'next/cache'

export async function submitAgentLeadImport(formData: FormData): Promise<CrmLeadImportResult> {
  const session = await requireAgentModule('CRM')
  const requestHeaders = await headers()
  assertSameOriginAction({
    origin: requestHeaders.get('origin'),
    host: requestHeaders.get('host'),
    forwardedHost: requestHeaders.get('x-forwarded-host'),
    forwardedProto: requestHeaders.get('x-forwarded-proto'),
  })
  const { copy } = await getServerI18n()
  const file = formData.get('file')
  if (!(file instanceof File) || !file.name.toLowerCase().endsWith('.csv')) {
    return { status: 'FAILED', successCount: 0, skippedCount: 0, errors: [{ row: 0, message: copy('Selecione um arquivo CSV.', 'Select a CSV file.') }], warnings: [] }
  }
  if (file.size > CRM_LEAD_IMPORT_MAX_BYTES) {
    return { status: 'FAILED', successCount: 0, skippedCount: 0, errors: [{ row: 0, message: copy('O arquivo excede o limite de 5 MB.', 'The file exceeds the 5 MB limit.') }], warnings: [] }
  }
  const agent = await getCurrentAgent()
  const result = await importCrmLeads({
    content: await file.text(),
    filename: file.name,
    targetAgentId: agent.id,
    uploadedById: session.user.id,
  })
  revalidatePath('/agent/cases')
  revalidatePath('/agent/cases/import')
  return result
}
