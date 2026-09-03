import { PageHeader } from '@/components/PageHeader'
import { Shell } from '@/components/Shell'
import { EmptyState } from '@/components/Table'
import { listAgentSessionHealthForAdmin } from '@/lib/national-life/interactive-connection-service'
import { requireRole } from '@/lib/require-role'
import { localeFor, type UserLanguage } from '@/lib/i18n/config'
import { getServerI18n } from '@/lib/i18n/server'

export const dynamic = 'force-dynamic'

function formatDateTime(value: Date | null, language: UserLanguage) {
  if (!value) {
    return '—'
  }
  return new Intl.DateTimeFormat(localeFor(language), {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(value)
}

export default async function NationalLifeAdminPage() {
  const { language, copy } = await getServerI18n()
  const session = await requireRole('ADMIN')
  const agents = await listAgentSessionHealthForAdmin()

  return (
    <Shell role="ADMIN" userName={session.user.name}>
      <PageHeader
        title={copy('Integração National Life', 'National Life integration')}
        eyebrow={copy('Backoffice Keepr One', 'Keepr One back office')}
        description={copy(
          'Monitore as conexões dos agentes e identifique contas que precisam de suporte antes de acessar o painel do usuário.',
          'Monitor agent connections and identify accounts that need support before opening the user’s panel.',
        )}
      />

      <section className="mt-8 overflow-hidden rounded-2xl border border-border-steel bg-paper">
        <div className="flex items-baseline justify-between gap-4 border-b border-border-steel px-5 py-4 sm:px-6">
          <div>
            <h2 className="text-base font-semibold text-ink">{copy('Sessões por agente', 'Sessions by agent')}</h2>
            <p className="mt-1 text-sm text-ink-muted">
              {copy('Status, uso recente e validade do contexto autenticado.', 'Status, recent usage, and validity of the authenticated context.')}
            </p>
          </div>
          <span className="font-mono text-xs text-ink-muted">
            {agents.length === 1
              ? copy('1 agente', '1 agent')
              : copy(`${agents.length} agentes`, `${agents.length} agents`)}
          </span>
        </div>

        {agents.length === 0 ? (
          <div className="p-5 sm:p-6">
            <EmptyState>{copy('Nenhuma sessão National Life foi conectada ainda.', 'No National Life session has been connected yet.')}</EmptyState>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[780px] text-left text-sm">
              <thead className="bg-panel text-xs uppercase tracking-[0.08em] text-ink-muted">
                <tr>
                  <th className="px-6 py-3 font-semibold">{copy('Agente', 'Agent')}</th>
                  <th className="px-6 py-3 font-semibold">{copy('Status', 'Status')}</th>
                  <th className="px-6 py-3 font-semibold">{copy('Última conexão', 'Last connection')}</th>
                  <th className="px-6 py-3 font-semibold">{copy('Última verificação', 'Last check')}</th>
                  {/* "Expira em" mostrava o menor prazo de cookie, que é o
                      cookie de bot da Cloudflare — o portal respondeu
                      autenticado depois dele. No lugar vai o que o último salto
                      SSO encontrou, que é o que decide se a ilustração sai. */}
                  <th className="px-6 py-3 font-semibold">{copy('Ilustração', 'Illustration')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-steel">
                {agents.map((agent) => (
                  <tr key={agent.agentId} className="transition-colors hover:bg-panel/55">
                    <td className="px-6 py-4 font-medium text-ink">{agent.agentName}</td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
                          agent.status === 'CONNECTED'
                            ? 'bg-success/10 text-success'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {agent.status === 'CONNECTED'
                          ? copy('Conectada', 'Connected')
                          : copy('Sessão expirada', 'Session expired')}
                      </span>
                    </td>
                    <td className="px-6 py-4 font-mono text-xs text-ink">
                      {formatDateTime(agent.lastConnectedAt, language)}
                    </td>
                    <td className="px-6 py-4 font-mono text-xs text-ink">
                      {formatDateTime(agent.lastUsedAt, language)}
                    </td>
                    <td className="px-6 py-4 font-mono text-xs text-ink">
                      {agent.illustrationSsoReachable === null
                        ? '—'
                        : agent.illustrationSsoReachable
                          ? copy('Disponível', 'Available')
                          : copy('Requer novo login', 'New sign-in required')}
                      {agent.illustrationSsoCheckedAt && (
                        <span className="block text-ink-muted">
                          {formatDateTime(agent.illustrationSsoCheckedAt, language)}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </Shell>
  )
}
