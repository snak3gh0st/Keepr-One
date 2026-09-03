export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { PageHeader } from '@/components/PageHeader'
import { Shell } from '@/components/Shell'
import { getServerI18n } from '@/lib/i18n/server'
import { requireRole } from '@/lib/require-role'
import { CreateManagedUserForm } from './CreateManagedUserForm'

export default async function NewManagedUserPage() {
  const session = await requireRole('ADMIN')
  const { copy } = await getServerI18n()

  return (
    <Shell role="ADMIN" userName={session.user.name}>
      <PageHeader
        title={copy('Cadastrar usuário', 'Create user')}
        eyebrow={copy('Backoffice Keepr One', 'Keepr One back office')}
        description={copy(
          'Crie um acesso avulso, defina o plano, os módulos e a regra inicial de pagamento.',
          'Create a standalone account and define its plan, modules, and initial payment rule.',
        )}
      >
        <Link
          href="/admin/users"
          className="inline-flex min-h-11 items-center justify-center rounded-full border border-border-steel bg-paper px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:border-teal hover:bg-panel focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-teal-pale"
        >
          <span aria-hidden>←</span>
          {copy('Voltar para usuários', 'Back to users')}
        </Link>
      </PageHeader>

      <CreateManagedUserForm />
    </Shell>
  )
}
