import { requireRole } from '@/lib/require-role'
import { Shell } from '@/components/Shell'
import { PageHeader } from '@/components/PageHeader'
import { ImportForms } from './ImportForms'
import { getServerI18n } from '@/lib/i18n/server'

export const dynamic = 'force-dynamic'

export default async function ImportPage() {
  const session = await requireRole('ADMIN')
  const { copy } = await getServerI18n()

  return (
    <Shell role="ADMIN" userName={session.user.name}>
      <PageHeader
        title={copy('Importar dados', 'Import data')}
        eyebrow={copy('Entrada de dados', 'Data input')}
        description={copy(
          'Envie apólices e comissões em CSV. O resultado de cada linha ficará registrado para conferência.',
          'Upload policies and commissions as CSV files. The result of each row will be recorded for review.',
        )}
      />
      <div className="mt-8"><ImportForms /></div>
    </Shell>
  )
}
