"use server";

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getCurrentAgent } from '@/lib/agent-context'
import { revalidatePath } from 'next/cache'
import { getOrCreateNewLeadStageId } from '@/lib/crm'
import { getServerI18n } from '@/lib/i18n/server'

const newCaseSchema = (copy: (pt: string, en: string) => string) => z.object({
  firstName: z.string().trim().min(1, copy('Informe o nome.', 'Enter the first name.')),
  lastName: z.string().trim().min(1, copy('Informe o sobrenome.', 'Enter the last name.')),
  email: z.union([z.literal(''), z.string().trim().email(copy('Informe um e-mail válido.', 'Enter a valid email address.'))]),
  phone: z.string().trim().optional(),
  dateOfBirth: z.union([z.literal(''), z.iso.date()]),
  state: z.string().trim().length(2, copy('Selecione o estado.', 'Select the state.')),
  tobaccoStatus: z.enum(['NO', 'FORMER', 'YES']),
  objective: z.enum(['PROTECTION', 'ACCUMULATION', 'RETIREMENT', 'LEGACY']),
  productType: z.enum(['TERM', 'IUL', 'UNDECIDED']),
  targetCoverage: z.coerce.number().positive().optional(),
  monthlyBudget: z.coerce.number().positive().optional(),
})

export type CreateCaseResult =
  | { ok: true; caseId: string }
  | { ok: false; message: string }

export async function createInsuranceCase(formData: FormData): Promise<CreateCaseResult> {
  const { copy } = await getServerI18n()
  const agent = await getCurrentAgent()

  const parsed = newCaseSchema(copy).safeParse({
    firstName: formData.get('firstName'),
    lastName: formData.get('lastName'),
    email: formData.get('email') ?? '',
    phone: formData.get('phone') ?? undefined,
    dateOfBirth: formData.get('dateOfBirth') ?? '',
    state: formData.get('state'),
    tobaccoStatus: formData.get('tobaccoStatus'),
    objective: formData.get('objective'),
    productType: formData.get('productType'),
    targetCoverage: formData.get('targetCoverage') || undefined,
    monthlyBudget: formData.get('monthlyBudget') || undefined,
  })

  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? copy('Dados inválidos.', 'Invalid data.') }
  }

  const data = parsed.data

  const insuranceCase = await prisma.$transaction(async (tx) => {
    const crmStageId = await getOrCreateNewLeadStageId(tx, agent.id)
    const prospect = await tx.prospect.create({
      data: {
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email || null,
        phone: data.phone || null,
        dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : null,
        state: data.state.toUpperCase(),
        tobaccoStatus: data.tobaccoStatus,
        assignedAgentId: agent.id,
      },
      select: { id: true, firstName: true, lastName: true },
    })

    const created = await tx.insuranceCase.create({
      data: {
        prospectId: prospect.id,
        assignedAgentId: agent.id,
        crmStageId,
        objective: data.objective,
        productType: data.productType,
        targetCoverage: data.targetCoverage ?? null,
        monthlyBudget: data.monthlyBudget ?? null,
        carrier: 'National Life Group',
        timelineEvents: {
          create: {
            type: 'CASE_CREATED',
            title: 'Caso criado',
            body: `Prospect ${prospect.firstName} ${prospect.lastName} registrado.`,
          },
        },
      },
      select: { id: true },
    })

    return created
  })

  revalidatePath('/agent/cases')
  return { ok: true, caseId: insuranceCase.id }
}
