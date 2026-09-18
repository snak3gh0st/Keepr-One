'use server'

import { importPolicies, importCommissions } from '@/lib/csv/import-service'
import { requireRole } from '@/lib/require-role'
import { getServerI18n } from '@/lib/i18n/server'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { assertSameOriginAction } from '@/lib/security/same-origin-action'
import { CRM_LEAD_IMPORT_MAX_BYTES, importCrmLeads } from '@/lib/crm/lead-import'

type Copy = Awaited<ReturnType<typeof getServerI18n>>['copy']

function localizeImportMessage(message: string, copy: Copy) {
  const csvPrefix = 'Não foi possível ler o arquivo como CSV:'
  if (message.startsWith(csvPrefix)) {
    const reason = message.slice(csvPrefix.length).trim()
    return copy(
      `Não foi possível ler o arquivo como CSV: ${reason}`,
      `We couldn't read the file as CSV: ${reason}`,
    )
  }

  const agentMatch = message.match(/^Nenhum agente encontrado com NPN (.+)$/)
  if (agentMatch) {
    return copy(message, `No agent was found with NPN ${agentMatch[1]}`)
  }

  const policyMatch = message.match(/^Nenhuma apólice encontrada com número (.+)$/)
  if (policyMatch) {
    return copy(message, `No policy was found with number ${policyMatch[1]}`)
  }

  const numberMatch = message.match(/^"(.+)" não é um número válido$/)
  if (numberMatch) {
    return copy(message, `"${numberMatch[1]}" is not a valid number`)
  }

  if (message === 'o valor não pode ficar vazio') {
    return copy(message, 'the value cannot be empty')
  }
  if (message === 'período deve estar no formato AAAA-MM') {
    return copy(message, 'period must use the YYYY-MM format')
  }
  return message
}

function localizeImportResult<T extends { errors: { row: number; message: string }[] }>(result: T, copy: Copy): T {
  return {
    ...result,
    errors: result.errors.map((error) => ({
      ...error,
      message: localizeImportMessage(error.message, copy),
    })),
  }
}

export async function submitPolicyImport(formData: FormData) {
  const session = await requireRole('ADMIN')
  const { copy } = await getServerI18n()
  const file = formData.get('file') as File
  const content = await file.text()
  return localizeImportResult(await importPolicies(content, session.user.id, file.name), copy)
}

export async function submitCommissionImport(formData: FormData) {
  const session = await requireRole('ADMIN')
  const { copy } = await getServerI18n()
  const file = formData.get('file') as File
  const content = await file.text()
  return localizeImportResult(await importCommissions(content, session.user.id, file.name), copy)
}

export async function submitCrmLeadImport(formData: FormData) {
  const session = await requireRole('ADMIN')
  const requestHeaders = await headers()
  assertSameOriginAction({
    origin: requestHeaders.get('origin'),
    host: requestHeaders.get('host'),
    forwardedHost: requestHeaders.get('x-forwarded-host'),
    forwardedProto: requestHeaders.get('x-forwarded-proto'),
  })
  const { copy } = await getServerI18n()
  const agentId = typeof formData.get('agentId') === 'string' ? String(formData.get('agentId')) : ''
  const file = formData.get('file')
  if (!agentId) return { status: 'FAILED' as const, successCount: 0, skippedCount: 0, errors: [{ row: 0, message: copy('Selecione um agente.', 'Select an agent.') }], warnings: [] }
  if (!(file instanceof File) || !file.name.toLowerCase().endsWith('.csv')) {
    return { status: 'FAILED' as const, successCount: 0, skippedCount: 0, errors: [{ row: 0, message: copy('Selecione um arquivo CSV.', 'Select a CSV file.') }], warnings: [] }
  }
  if (file.size > CRM_LEAD_IMPORT_MAX_BYTES) {
    return { status: 'FAILED' as const, successCount: 0, skippedCount: 0, errors: [{ row: 0, message: copy('O arquivo excede o limite de 5 MB.', 'The file exceeds the 5 MB limit.') }], warnings: [] }
  }
  const result = await importCrmLeads({
    content: await file.text(),
    filename: file.name,
    targetAgentId: agentId,
    uploadedById: session.user.id,
  })
  revalidatePath('/admin/import')
  revalidatePath('/admin/audit')
  revalidatePath(`/admin/users`)
  return result
}
