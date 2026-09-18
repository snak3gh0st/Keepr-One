import { requireRole } from '@/lib/require-role'
import { Shell } from '@/components/Shell'
import { PageHeader } from '@/components/PageHeader'
import { ImportForms } from './ImportForms'
import { getServerI18n } from '@/lib/i18n/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export default async function ImportPage() {
  const session = await requireRole('ADMIN')
  const { copy } = await getServerI18n()
  const agents = await prisma.agent.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, user: { select: { name: true, email: true } } },
    orderBy: { user: { name: 'asc' } },
  })

  return (
    <Shell role="ADMIN" userName={session.user.name}>
      <PageHeader
        title={copy('Importar dados', 'Import data')}
        eyebrow={copy('Entrada de dados', 'Data input')}
        description={copy(
          'Envie apólices, comissões ou leads CRM em CSV. O resultado de cada linha ficará registrado para conferência.',
          'Upload policies, commissions, or CRM leads as CSV files. Each row result will be recorded for review.',
        )}
      />
      <div className="mt-8"><ImportForms agents={agents.map((agent) => ({ id: agent.id, name: agent.user.name, email: agent.user.email }))} /></div>
    </Shell>
  )
}
