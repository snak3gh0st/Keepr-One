import 'server-only'

import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getOrCreateNewLeadStageId } from '@/lib/crm'
import { safeParseCsv, type ImportStatus } from '@/lib/csv/import-service'

export const CRM_LEAD_IMPORT_MAX_BYTES = 5 * 1024 * 1024
export const CRM_LEAD_IMPORT_MAX_ROWS = 2_000

export type CrmLeadImportError = { row: number; message: string }

export type CrmLeadImportResult = {
  status: ImportStatus
  successCount: number
  skippedCount: number
  errors: CrmLeadImportError[]
  warnings: string[]
}

export type CrmLeadImportRow = {
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
  dateOfBirth: Date | null
  state: string | null
  tobaccoStatus: string
  objective: string
  productType: string
  targetCoverage: number | null
  monthlyBudget: number | null
}

const rowSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  email: z.union([z.literal(''), z.email()]).transform((value) => value || null),
  phone: z.string().trim().max(40),
  dateOfBirth: z.date().nullable(),
  state: z.union([z.literal(''), z.string().regex(/^[A-Z]{2}$/)]).transform((value) => value || null),
  tobaccoStatus: z.enum(['NO', 'FORMER', 'YES']),
  objective: z.enum(['PROTECTION', 'ACCUMULATION', 'RETIREMENT', 'LEGACY']),
  productType: z.enum(['TERM', 'IUL', 'UNDECIDED']),
  targetCoverage: z.number().positive().nullable(),
  monthlyBudget: z.number().positive().nullable(),
})

function field(row: Record<string, string>, ...keys: string[]) {
  for (const key of keys) {
    const value = row[key] ?? row[`\uFEFF${key}`]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function splitName(row: Record<string, string>) {
  const firstName = field(row, 'firstName', 'first_name', 'nome')
  const lastName = field(row, 'lastName', 'last_name', 'sobrenome')
  if (firstName && lastName) return { firstName, lastName }
  const fullName = field(row, 'name', 'fullName', 'full_name', 'nome_completo')
  const parts = fullName.split(/\s+/).filter(Boolean)
  if (parts.length < 1) {
    return {
      firstName: firstName || lastName || '',
      lastName: lastName && firstName ? lastName : 'Lead',
    }
  }
  return {
    firstName: firstName || parts[0] || '',
    lastName: lastName || parts.slice(1).join(' ') || 'Lead',
  }
}

function parseDate(value: string): Date | null | 'INVALID' {
  if (!value) return null
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00.000Z`)
    : /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(value)
      ? (() => {
          const [month, day, year] = value.split('/').map(Number)
          return new Date(Date.UTC(year, month - 1, day))
        })()
      : new Date(value)
  return Number.isNaN(iso.getTime()) ? 'INVALID' : iso
}

function parseAmount(value: string): number | null | 'INVALID' {
  if (!value) return null
  const normalized = value.replace(/[$,\s]/g, '')
  const amount = Number(normalized)
  return Number.isFinite(amount) && amount > 0 ? amount : 'INVALID'
}

export function normalizeLeadPhone(value: string): string | null {
  if (!value) return null
  const digits = value.replace(/\D/g, '')
  if (digits.length < 7 || digits.length > 15) return null
  return digits
}

export function parseCrmLeadRows(content: string): { rows: CrmLeadImportRow[]; errors: CrmLeadImportError[] } | { error: string } {
  const parsed = safeParseCsv(content)
  if ('error' in parsed) return parsed
  if (parsed.rows.length > CRM_LEAD_IMPORT_MAX_ROWS) {
    return { error: `O arquivo excede o limite de ${CRM_LEAD_IMPORT_MAX_ROWS} linhas.` }
  }

  const rows: CrmLeadImportRow[] = []
  const errors: CrmLeadImportError[] = []
  for (const [index, raw] of parsed.rows.entries()) {
    const rowNumber = index + 2
    const names = splitName(raw)
    const dateOfBirth = parseDate(field(raw, 'dateOfBirth', 'date_of_birth', 'birthDate', 'data_nascimento'))
    const targetCoverage = parseAmount(field(raw, 'targetCoverage', 'target_coverage', 'coverage', 'cobertura'))
    const monthlyBudget = parseAmount(field(raw, 'monthlyBudget', 'monthly_budget', 'budget', 'orcamento'))
    const phoneValue = field(raw, 'phone', 'telefone')
    const normalizedPhone = normalizeLeadPhone(phoneValue)
    const candidate = {
      ...names,
      email: field(raw, 'email', 'e-mail').toLowerCase(),
      phone: phoneValue,
      dateOfBirth: dateOfBirth === 'INVALID' ? null : dateOfBirth,
      state: field(raw, 'state', 'estado').toUpperCase(),
      tobaccoStatus: field(raw, 'tobaccoStatus', 'tobacco_status', 'tabaco').toUpperCase() || 'NO',
      objective: field(raw, 'objective', 'objetivo').toUpperCase() || 'PROTECTION',
      productType: field(raw, 'productType', 'product_type', 'produto').toUpperCase() || 'UNDECIDED',
      targetCoverage: targetCoverage === 'INVALID' ? null : targetCoverage,
      monthlyBudget: monthlyBudget === 'INVALID' ? null : monthlyBudget,
    }
    const result = rowSchema.safeParse(candidate)
    const rowErrors: string[] = []
    if (dateOfBirth === 'INVALID') rowErrors.push('data de nascimento inválida')
    if (targetCoverage === 'INVALID') rowErrors.push('cobertura alvo inválida')
    if (monthlyBudget === 'INVALID') rowErrors.push('orçamento mensal inválido')
    if (phoneValue && !normalizedPhone) rowErrors.push('telefone inválido')
    if (!result.success) {
      rowErrors.push(...result.error.issues.map((issue) => issue.message))
      errors.push({ row: rowNumber, message: rowErrors.join('; ') })
      continue
    }
    if (rowErrors.length) {
      errors.push({ row: rowNumber, message: rowErrors.join('; ') })
      continue
    }
    const data = result.data
    rows.push({
      ...data,
      phone: normalizedPhone,
      dateOfBirth: data.dateOfBirth,
      targetCoverage: data.targetCoverage,
      monthlyBudget: data.monthlyBudget,
    })
  }
  return { rows, errors }
}

function duplicateWhere(agentId: string, row: CrmLeadImportRow) {
  const clauses: Prisma.ProspectWhereInput[] = []
  if (row.email) clauses.push({ email: row.email })
  if (row.phone) clauses.push({ phone: row.phone })
  return clauses.length ? { assignedAgentId: agentId, OR: clauses } : null
}

export async function importCrmLeads(input: {
  content: string
  filename: string
  targetAgentId: string
  uploadedById: string
}): Promise<CrmLeadImportResult> {
  if (Buffer.byteLength(input.content, 'utf8') > CRM_LEAD_IMPORT_MAX_BYTES) {
    return { status: 'FAILED', successCount: 0, skippedCount: 0, errors: [{ row: 0, message: 'O arquivo excede o limite de 5 MB.' }], warnings: [] }
  }

  const parsed = parseCrmLeadRows(input.content)
  if ('error' in parsed) {
    return { status: 'FAILED', successCount: 0, skippedCount: 0, errors: [{ row: 0, message: parsed.error }], warnings: [] }
  }

  let successCount = 0
  let skippedCount = 0
  const warnings = [...(parsed.errors.length ? ['Algumas linhas não foram importadas.'] : [])]
  const seen = new Set<string>()

  try {
    await prisma.$transaction(async (tx) => {
      const agent = await tx.agent.findUnique({ where: { id: input.targetAgentId }, select: { id: true, status: true } })
      if (!agent || agent.status !== 'ACTIVE') throw new Error('IMPORT_AGENT_NOT_FOUND')
      const crmStageId = await getOrCreateNewLeadStageId(tx, agent.id)

      for (const row of parsed.rows) {
        const identity = row.email ? `email:${row.email}` : row.phone ? `phone:${row.phone}` : null
        if (identity && seen.has(identity)) {
          skippedCount += 1
          continue
        }
        const where = duplicateWhere(agent.id, row)
        if (where) {
          const existing = await tx.prospect.findFirst({ where, select: { id: true } })
          if (existing) {
            skippedCount += 1
            if (identity) seen.add(identity)
            continue
          }
        }
        const prospect = await tx.prospect.create({
          data: {
            firstName: row.firstName,
            lastName: row.lastName,
            email: row.email,
            phone: row.phone,
            dateOfBirth: row.dateOfBirth,
            state: row.state,
            tobaccoStatus: row.tobaccoStatus,
            assignedAgentId: agent.id,
          },
          select: { id: true },
        })
        await tx.insuranceCase.create({
          data: {
            prospectId: prospect.id,
            assignedAgentId: agent.id,
            crmStageId,
            objective: row.objective,
            productType: row.productType,
            targetCoverage: row.targetCoverage,
            monthlyBudget: row.monthlyBudget,
            carrier: 'National Life Group',
            timelineEvents: {
              create: {
                type: 'CASE_CREATED',
                title: 'Lead importado',
                body: `Prospect ${row.firstName} ${row.lastName} importado por CSV.`,
              },
            },
          },
        })
        successCount += 1
        if (identity) seen.add(identity)
      }

      await tx.auditLog.create({
        data: {
          userId: input.uploadedById,
          action: 'CRM_LEADS_IMPORTED',
          entity: 'Agent',
          entityId: agent.id,
          after: {
            filename: input.filename,
            targetAgentId: agent.id,
            successCount,
            skippedCount,
            errorCount: parsed.errors.length,
          },
        },
      })
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  } catch (error) {
    if (error instanceof Error && error.message === 'IMPORT_AGENT_NOT_FOUND') {
      return { status: 'FAILED', successCount: 0, skippedCount: 0, errors: [{ row: 0, message: 'Agente não encontrado ou inativo.' }], warnings: [] }
    }
    console.error('CRM lead import failed', error)
    return { status: 'FAILED', successCount: 0, skippedCount: 0, errors: [{ row: 0, message: 'Não foi possível importar os leads agora.' }], warnings: [] }
  }

  const status: ImportStatus = parsed.errors.length && successCount === 0 && skippedCount === 0
    ? 'FAILED'
    : parsed.errors.length ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED'
  if (skippedCount) warnings.push(`${skippedCount} lead(s) duplicado(s) foram ignorado(s).`)
  return { status, successCount, skippedCount, errors: parsed.errors, warnings }
}
