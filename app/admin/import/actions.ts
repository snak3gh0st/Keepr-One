'use server'

import { importPolicies, importCommissions } from '@/lib/csv/import-service'
import { requireRole } from '@/lib/require-role'
import { getServerI18n } from '@/lib/i18n/server'

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
