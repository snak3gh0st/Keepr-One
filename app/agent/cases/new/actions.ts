"use server";

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getCurrentAgent } from '@/lib/agent-context'
import { revalidatePath } from 'next/cache'
import { getOrCreateNewLeadStageId } from '@/lib/crm'

const NewCaseSchema = z.object({
  firstName: z.string().trim().min(1, 'Informe o nome.'),
  lastName: z.string().trim().min(1, 'Informe o sobrenome.'),
  email: z.union([z.literal(''), z.string().trim().email('Informe um e-mail válido.')]),
  phone: z.string().trim().optional(),
  dateOfBirth: z.union([z.literal(''), z.iso.date()]),
  state: z.string().trim().length(2, 'Selecione o estado.'),
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
  const agent = await getCurrentAgent()

  const parsed = NewCaseSchema.safeParse({
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
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Dados inválidos.' }
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
