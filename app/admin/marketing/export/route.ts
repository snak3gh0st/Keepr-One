import { Prisma } from '@prisma/client'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/require-role'
import { MARKETING_EXPORT_LIMIT, marketingLeadWhere, parseLeadFilters } from '@/lib/marketing/filters'
import { marketingLeadsCsv } from '@/lib/marketing/csv'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    await requireRole('ADMIN')
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    const status = message === 'Not authenticated' ? 401 : message.startsWith('Forbidden') ? 403 : 500
    return NextResponse.json({ error: status === 500 ? 'Não foi possível validar o acesso.' : 'Acesso restrito a administradores.' }, { status, headers: { 'Cache-Control': 'no-store' } })
  }

  const filters = parseLeadFilters(new URL(request.url).searchParams)
  const where = marketingLeadWhere(filters)
  try {
    const leads = await prisma.$transaction(async (tx) => {
      const count = await tx.marketingLead.count({ where })
      if (count > MARKETING_EXPORT_LIMIT) throw new Error('EXPORT_LIMIT')
      return tx.marketingLead.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: MARKETING_EXPORT_LIMIT + 1,
        select: {
          id: true, name: true, email: true, phone: true, status: true, source: true,
          createdAt: true, nextContactAt: true,
          campaign: { select: { id: true, name: true } }, owner: { select: { id: true, name: true } },
          utmSource: true, utmMedium: true, utmCampaign: true, utmContent: true, utmTerm: true,
        },
      })
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
    if (leads.length > MARKETING_EXPORT_LIMIT) throw new Error('EXPORT_LIMIT')
    const csv = marketingLeadsCsv(leads.map((lead) => ({
      ...lead,
      createdAt: lead.createdAt.toISOString(), nextContactAt: lead.nextContactAt?.toISOString() ?? null,
    })))
    const date = new Date().toISOString().slice(0, 10)
    return new Response(csv, { headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="keepr-one-marketing-leads-${date}.csv"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    } })
  } catch (error) {
    const limit = error instanceof Error && error.message === 'EXPORT_LIMIT'
    return NextResponse.json({ error: limit
      ? `A exportação permite até ${MARKETING_EXPORT_LIMIT.toLocaleString('pt-BR')} leads. Refine os filtros e tente novamente.`
      : 'Não foi possível exportar os leads agora.' }, { status: limit ? 422 : 500, headers: { 'Cache-Control': 'no-store' } })
  }
}
