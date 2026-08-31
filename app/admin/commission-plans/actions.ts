'use server'

import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/require-role'
import { revalidatePath } from 'next/cache'
import { Prisma } from '@prisma/client'
import { getServerI18n } from '@/lib/i18n/server'

export type CreatePlanResult = { ok: true } | { ok: false; message: string }

export async function createCommissionPlan(formData: FormData): Promise<CreatePlanResult> {
  const session = await requireRole('ADMIN')
  const { copy } = await getServerI18n()

  const rank = formData.get('rank') as string
  const downlineLevel = Number(formData.get('downlineLevel'))
  const overridePercent = Number(formData.get('overridePercent'))

  if (!Number.isFinite(overridePercent) || overridePercent < 0 || overridePercent > 100) {
    return { ok: false, message: copy('% de sobrecomissão deve ser um número entre 0 e 100.', 'Override percentage must be a number between 0 and 100.') }
  }
  if (!Number.isFinite(downlineLevel) || downlineLevel < 1) {
    return { ok: false, message: copy('Nível da rede deve ser 1 ou maior.', 'Downline level must be 1 or greater.') }
  }

  const before = await prisma.commissionPlan.findUnique({
    where: { rank_downlineLevel: { rank, downlineLevel } },
  })

  const after = await prisma.commissionPlan.upsert({
    where: { rank_downlineLevel: { rank, downlineLevel } },
    create: { rank, downlineLevel, overridePercent },
    update: { overridePercent },
  })

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: 'UPSERT_COMMISSION_PLAN',
      entity: 'CommissionPlan',
      entityId: after.id,
      before: before ? { overridePercent: before.overridePercent.toNumber() } : Prisma.JsonNull,
      after: { overridePercent: after.overridePercent.toNumber() },
    },
  })

  revalidatePath('/admin/commission-plans')
  return { ok: true }
}
