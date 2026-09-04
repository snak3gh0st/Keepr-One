import Link from 'next/link'
import { getCurrentAgent } from '@/lib/agent-context'
import { getNationalLifeSyncStatus } from '@/lib/national-life/sync-run-service'
import { sanitizeNationalLifeSyncStatusForAgent } from '@/lib/national-life/plan-access'
import {
  getNationalLifeLocalConnectorConfig,
  LOCAL_CONNECTOR_DEPLOYMENT_SCOPE,
} from '@/lib/national-life/local-connector/config'
import { prisma } from '@/lib/prisma'
import { Shell } from '@/components/Shell'
import { EmptyState } from '@/components/Table'
import { NationalLifeLocalConnectorCard } from './NationalLifeLocalConnectorCard'
import { NationalLifeSyncProgress } from './NationalLifeSyncProgress'
import { KBotAvatar } from '@/components/kbot/KBotAvatar'
import { getServerI18n } from '@/lib/i18n/server'

export const dynamic = 'force-dynamic'

export default async function NationalLifeConnectionPage() {
  const { copy } = await getServerI18n()
  const agent = await getCurrentAgent()
  const localConfig = getNationalLifeLocalConnectorConfig()
  const syncStatus = localConfig.enabled
    ? await sanitizeNationalLifeSyncStatusForAgent(
        agent.id,
        await getNationalLifeSyncStatus(agent.id, LOCAL_CONNECTOR_DEPLOYMENT_SCOPE),
      )
    : null
  const [user] = await Promise.all([
    prisma.user.findUnique({
      where: { id: agent.userId },
      select: { name: true, role: true },
    }),
  ])

  const role = user?.role === 'ADMIN' ? 'ADMIN' : 'AGENT'
  const backHref = role === 'ADMIN' ? '/admin' : '/agent'

  return (
    <Shell role={role} userName={user?.name ?? ''}>
      <header className="flex flex-wrap items-end justify-between gap-4 py-5">
        <div><p className="text-xs font-semibold uppercase tracking-widest text-teal-deep">K-Bot · National Life</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">{copy('Conexão e atualizações', 'Connection and updates')}</h1>
          <p className="mt-2 text-sm text-ink-muted">{copy('Confira este computador, inicie uma atualização e acompanhe o resultado.', 'Check this computer, start an update and track the result.')}</p>
        </div>
        <Link href={role === 'AGENT' ? '/agent/kbot?view=activities' : backHref} className="inline-flex min-h-11 items-center rounded-xl border border-border-steel bg-panel px-4 text-sm font-semibold text-teal-deep">{copy('Ver atividades', 'View activities')}</Link>
      </header>

      {localConfig.enabled ? (
        <div className="mt-4 max-w-6xl space-y-5">


          {localConfig.enabled && (
            <NationalLifeLocalConnectorCard
              extensionId={localConfig.extensionTarget}
              storeUrl={localConfig.storeUrl}
              installMode={localConfig.installMode}
              baseUrl={localConfig.baseUrl}
              showCornerPresence={false}
              hideDuringActiveSync
              latestRun={syncStatus ? { runId: syncStatus.runId, state: syncStatus.state } : null}
            />
          )}

          <NationalLifeSyncProgress initialStatus={syncStatus} />

          <details className="relative overflow-hidden rounded-[28px] border border-border-steel bg-paper shadow-[var(--shadow-card)]">
            <summary className="cursor-pointer px-6 py-4 text-sm font-semibold text-ink">{copy('Como o K-Bot trabalha', 'How K-Bot works')}</summary>
            <div
              aria-hidden="true"
              className="absolute -right-24 -top-28 h-72 w-72 rounded-full bg-teal-pale/75 blur-3xl"
            />
            <div className="relative grid gap-8 p-6 sm:p-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(300px,0.85fr)] lg:p-10">
              <div>
                <div className="flex items-center gap-3">
                  <KBotAvatar state="idle" />
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-teal-deep">
                      K-Bot · {copy('operações National Life', 'National Life operations')}
                    </p>
                    <p className="mt-1 text-sm text-ink-muted">{copy('Sua sessão no navegador. Dados verificados na Keepr One.', 'Your browser session. Verified data in Keepr One.')}</p>
                  </div>
                </div>
                <h2 className="mt-8 max-w-xl text-balance text-3xl font-semibold tracking-[-0.045em] text-ink sm:text-4xl">
                  {copy('Um bot para o trabalho repetitivo. Você mantém o controle.', 'One bot for the repetitive work. You stay in control.')}
                </h2>
                <p className="mt-4 max-w-xl text-base leading-7 text-ink-muted">
                  {copy('Inicie sincronizações e ilustrações oficiais pela Keepr One. O K-Bot percorre as páginas da operadora e avisa apenas quando a National Life precisar do seu login.', 'Start syncs and official illustrations from Keepr One. K-Bot works through the carrier pages and tells you only when National Life needs your login.')}
                </p>
                <div className="mt-7 flex flex-wrap gap-2">
                  <span className="inline-flex items-center gap-2 rounded-full bg-teal-pale px-3 py-2 text-xs font-semibold text-teal-deep">
                    <span className="h-1.5 w-1.5 rounded-full bg-teal" aria-hidden="true" />
                    {copy('O login protegido é opcional', 'Protected sign-in is optional')}
                  </span>
                  <span className="inline-flex items-center gap-2 rounded-full bg-panel px-3 py-2 text-xs font-semibold text-ink-muted">
                    {copy('Sincronização e ilustração permanecem independentes', 'Sync and illustration stay independent')}
                  </span>
                </div>
              </div>

              <ol aria-label={copy('Etapas da conexão', 'Connection steps')} className="grid content-center gap-3">
                {[
                  ['01', copy('Você escolhe o trabalho', 'You choose the work'), copy('Inicie uma sincronização ou ilustração oficial pela Keepr One.', 'Start a sync or an official illustration from Keepr One.')],
                  ['02', copy('O K-Bot começa a trabalhar', 'K-Bot gets to work'), copy('O K-Bot abre os locais necessários na National Life e segue as mesmas etapas que você seguiria.', 'K-Bot opens the places it needs in National Life and follows the same steps you would.')],
                  ['03', copy('O login permanece sob seu controle', 'Sign-in stays under your control'), copy('Você pode entrar por conta própria ou permitir uma tentativa de login protegido do K-Bot. MFA e CAPTCHA permanecem sempre com você.', 'You can sign in yourself or opt in to one protected K-Bot login attempt. MFA and CAPTCHA always stay with you.')],
                  ['04', copy('O K-Bot confere o resultado', 'K-Bot checks the result'), copy('As informações são verificadas e organizadas antes de aparecerem na Keepr One.', 'The information is checked and organized before it appears in Keepr One.')],
                  ['05', copy('Tudo fica pronto aqui', 'Everything is ready here'), copy('Veja as informações atualizadas ou abra o PDF oficial da ilustração.', 'See your updated information or open the official illustration PDF.')],
                ].map(([number, title, description]) => (
                  <li
                    key={number}
                    className="grid grid-cols-[2.25rem_1fr] gap-3 rounded-2xl border border-border-steel bg-panel/55 p-4"
                  >
                    <span className="font-mono text-sm font-semibold tabular-nums text-teal">{number}</span>
                    <span>
                      <strong className="block text-sm font-semibold text-ink">{title}</strong>
                      <span className="mt-1 block text-sm leading-5 text-ink-muted">{description}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </details>

          <p className="border-t border-border-steel pt-5 text-sm leading-6 text-ink-muted">
            {copy('Os dados da National Life são copiados para a Keepr One como um snapshot somente para leitura.', 'National Life data is copied into Keepr One as a read-only snapshot.')}{' '}
            <Link href="/agent/integrations/national-life/data" className="font-semibold text-teal underline-offset-4 hover:underline">
              {copy('Ver dados salvos', 'View saved data')}
            </Link>
          </p>
          </div>
      ) : (
        <div className="mt-8 max-w-5xl">
          <EmptyState>
            {copy('Esta integração ainda não está habilitada. Fale com o suporte da Keepr One antes de tentar conectar uma conta National Life.', 'This integration is not enabled yet. Contact Keepr One support before trying to connect a National Life account.')}
          </EmptyState>
        </div>
      )}
    </Shell>
  )
}
