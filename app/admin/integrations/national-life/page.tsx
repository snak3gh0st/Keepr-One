import { PageHeader } from '@/components/PageHeader'
import { Shell } from '@/components/Shell'
import { EmptyState } from '@/components/Table'
import { listAgentSessionHealthForAdmin } from '@/lib/national-life/interactive-connection-service'
import { requireRole } from '@/lib/require-role'

export const dynamic = 'force-dynamic'

function formatDateTime(value: Date | null) {
  if (!value) {
    return '—'
  }
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(value)
}

export default async function NationalLifeAdminPage() {
  const session = await requireRole('ADMIN')
  const agents = await listAgentSessionHealthForAdmin()

  return (
    <Shell role="ADMIN" userName={session.user.name}>
      <PageHeader
        title="Saúde da integração National Life"
        eyebrow="Integrações"
        description="Visão operacional das sessões dos agentes. Administradores acompanham o estado, sem acesso ao portal ou à sessão individual."
      />

      <section className="mt-8 overflow-hidden rounded-2xl border border-border-steel bg-paper">
        <div className="flex items-baseline justify-between gap-4 border-b border-border-steel px-5 py-4 sm:px-6">
          <div>
            <h2 className="text-base font-semibold text-ink">Sessões por agente</h2>
            <p className="mt-1 text-sm text-ink-muted">
              Status, uso recente e validade do contexto autenticado.
            </p>
          </div>
          <span className="font-mono text-xs text-ink-muted">{agents.length} agentes</span>
        </div>

        {agents.length === 0 ? (
          <div className="p-5 sm:p-6">
            <EmptyState>Nenhuma sessão National Life foi conectada ainda.</EmptyState>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[780px] text-left text-sm">
              <thead className="bg-panel text-xs uppercase tracking-[0.08em] text-ink-muted">
                <tr>
                  <th className="px-6 py-3 font-semibold">Agente</th>
                  <th className="px-6 py-3 font-semibold">Status</th>
                  <th className="px-6 py-3 font-semibold">Última conexão</th>
                  <th className="px-6 py-3 font-semibold">Última verificação</th>
                  {/* "Expira em" mostrava o menor prazo de cookie, que é o
                      cookie de bot da Cloudflare — o portal respondeu
                      autenticado depois dele. No lugar vai o que o último salto
                      SSO encontrou, que é o que decide se a ilustração sai. */}
                  <th className="px-6 py-3 font-semibold">Ilustração</th>
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
                        {agent.status === 'CONNECTED' ? 'Conectada' : 'Sessão expirada'}
                      </span>
                    </td>
                    <td className="px-6 py-4 font-mono text-xs text-ink">
                      {formatDateTime(agent.lastConnectedAt)}
                    </td>
                    <td className="px-6 py-4 font-mono text-xs text-ink">
                      {formatDateTime(agent.lastUsedAt)}
                    </td>
                    <td className="px-6 py-4 font-mono text-xs text-ink">
                      {agent.illustrationSsoReachable === null
                        ? '—'
                        : agent.illustrationSsoReachable
                          ? 'Disponível'
                          : 'Requer novo login'}
                      {agent.illustrationSsoCheckedAt && (
                        <span className="block text-ink-muted">
                          {formatDateTime(agent.illustrationSsoCheckedAt)}
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
