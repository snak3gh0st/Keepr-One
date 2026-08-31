'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import {
  NATIONAL_LIFE_DISCOVERY_PAGE_KEYS,
  NATIONAL_LIFE_PRIORITY_GRID_KEYS,
  nationalLifeReadCoverageSummary,
} from '@/lib/national-life/read-coverage'
import { NATIONAL_LIFE_PERSONAL_GRID_KEYS } from '@/lib/national-life/plan-access-catalog'
import type { NationalLifeSyncStatus } from '@/lib/national-life/sync-run-service'
import { KBotActivity, type KBotState } from '@/components/kbot/KBotAvatar'
import { useI18n } from '@/components/i18n/LanguageProvider'

type Copy = ReturnType<typeof useI18n>['copy']

const POLL_INTERVAL_MS = 1_500
const PORTAL_COVERAGE = nationalLifeReadCoverageSummary()
const DISCOVERY_PAGE_KEYS = new Set<string>(NATIONAL_LIFE_DISCOVERY_PAGE_KEYS)
const STRUCTURED_PRIORITY_GRID_KEYS = NATIONAL_LIFE_PRIORITY_GRID_KEYS.filter(
  (gridKey) => !DISCOVERY_PAGE_KEYS.has(gridKey),
)
const PERSONAL_GRID_KEYS = new Set<string>(NATIONAL_LIFE_PERSONAL_GRID_KEYS)
const PERSONAL_PRIORITY_GRID_KEYS = NATIONAL_LIFE_PRIORITY_GRID_KEYS.filter(
  (gridKey) => PERSONAL_GRID_KEYS.has(gridKey),
)
const PERSONAL_STRUCTURED_PRIORITY_GRID_KEYS = STRUCTURED_PRIORITY_GRID_KEYS.filter(
  (gridKey) => PERSONAL_GRID_KEYS.has(gridKey),
)
export const NATIONAL_LIFE_SYNC_STARTED_EVENT = 'national-life-sync-started'
export const NATIONAL_LIFE_RETRY_REMAINING_EVENT = 'national-life-retry-remaining'

function safeStatus(value: unknown): NationalLifeSyncStatus | null {
  if (!value || typeof value !== 'object') return null
  return value as NationalLifeSyncStatus
}

function friendlyState(status: NationalLifeSyncStatus, copy: Copy) {
  if (status.state === 'PAUSED') return copy('Entre na National Life para continuar.', 'Sign in to National Life to keep going.')
  if (status.state === 'PARTIAL' || status.state === 'FAILED') {
    return copy('Algumas áreas foram atualizadas. Conecte novamente para concluir o restante.', 'Some areas were updated. Connect again to finish the rest.')
  }
  return null
}

function formatMoment(value: NationalLifeSyncStatus['completedAt'], locale: string): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString(locale, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function estimateLine(status: NationalLifeSyncStatus, copy: Copy): string | null {
  if (!status.shouldPoll || !status.estimate) return null
  const { lowerMinutes, upperMinutes } = status.estimate
  return lowerMinutes === upperMinutes
    ? copy('Cerca de {minutes} min restantes', 'About {minutes} min remaining', { minutes: lowerMinutes })
    : copy('Cerca de {lower}–{upper} min restantes', 'About {lower}–{upper} min remaining', { lower: lowerMinutes, upper: upperMinutes })
}

function money(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(value)
}

/// O que realmente entrou. `writtenRecords` nulo é "não sei" (um run remoto não
/// gera recibo), e nesse caso não se afirma nada. Zero, sim, é uma afirmação: o
/// sync terminou sem trazer nada, e chamar isso de sucesso seria mentir.
function outcomeLine(status: NationalLifeSyncStatus, snapshotRecords: number, copy: Copy, locale: string): string | null {
  if (status.writtenRecords === null) return null
  if (status.writtenRecords === 0) {
    if (snapshotRecords > 0) {
      return copy('{count} registros de snapshot foram preservados para mapear a origem.', '{count} snapshot records were preserved for source mapping.', { count: snapshotRecords.toLocaleString(locale) })
    }
    return status.receivedRecords && status.receivedRecords > 0
      ? copy('A National Life retornou registros, mas nenhum pôde ser salvo. Tente sincronizar novamente; se isso se repetir, contate o suporte.', 'National Life returned records, but none of them could be saved. Try syncing again; if it repeats, contact support.')
      : copy('A National Life não tinha nada novo para enviar desta vez.', 'National Life had nothing new to send this time.')
  }
  const plural = status.writtenRecords === 1 ? copy('registro salvo', 'record saved') : copy('registros salvos', 'records saved')
  return copy('{count} {plural} na Keepr One.', '{count} {plural} to Keepr One.', { count: status.writtenRecords.toLocaleString(locale), plural })
}

/// The gap between what arrived and what was saved has two causes that mean
/// opposite things. Repeats are how the portal lists a policy once per coverage
/// — merging them loses nothing. Rows without a policy number cannot be keyed
/// and are the only real loss. Printing the difference alone would read as 165
/// missing policies and send the agent to support over routine housekeeping.
function discardLine(status: NationalLifeSyncStatus, snapshotRecords: number, copy: Copy, locale: string): string | null {
  const repeated = status.duplicateRecords ?? 0
  const dropped = status.rejectedRecords ?? 0
  if (repeated === 0 && dropped === 0 && snapshotRecords === 0) return null
  const sentences: string[] = []
  if (repeated > 0) {
    sentences.push(
      copy('{count} repetiam uma apólice já listada e foram mesclados.', '{count} repeated a policy already listed and were merged.', { count: repeated.toLocaleString(locale) }),
    )
  }
  if (dropped > 0) {
    sentences.push(
      copy('{count} não puderam ser salvos porque chegaram sem número de apólice.', '{count} could not be saved because they arrived without a policy number.', { count: dropped.toLocaleString(locale) }),
    )
  }
  if (snapshotRecords > 0) {
    sentences.push(
      copy('{count} registros de snapshot foram preservados separadamente e não entram na contagem de linhas operacionais.', '{count} snapshot records were preserved separately and are not counted as operational rows.', { count: snapshotRecords.toLocaleString(locale) }),
    )
  }
  return sentences.join(' ')
}

function snapshotRecordCount(status: NationalLifeSyncStatus): number {
  return status.stageCoverage?.reduce((total, stage) => (
    DISCOVERY_PAGE_KEYS.has(stage.gridKey) ? total + (stage.verifiedRecords ?? 0) : total
  ), 0) ?? 0
}

function isCurrentPriorityPlan(status: NationalLifeSyncStatus): boolean {
  const coverageKeys = status.stageCoverage?.map((stage) => stage.gridKey) ?? []
  const knownPlans = [
    NATIONAL_LIFE_PRIORITY_GRID_KEYS,
    STRUCTURED_PRIORITY_GRID_KEYS,
    PERSONAL_PRIORITY_GRID_KEYS,
    PERSONAL_STRUCTURED_PRIORITY_GRID_KEYS,
  ]
  const expected = knownPlans.find((plan) => plan.length === status.total) ?? null
  if (!expected) return false
  // Older non-local status payloads may not include coverage. For current local
  // runs, require the same exact ordered plan used by run reuse.
  if (coverageKeys.length === 0) return true
  return coverageKeys.length === expected.length && coverageKeys.every(
    (gridKey, index) => gridKey === expected[index],
  )
}

function formatCount(value: number | null, locale: string): string {
  return value === null ? '—' : value.toLocaleString(locale)
}

function activeLine(status: NationalLifeSyncStatus, reused: number, copy: Copy, locale: string): string {
  const checked = status.completed + status.failed
  const reusePrefix = reused > 0
    ? copy(
        '{count} {areas} verificadas anteriormente foram reutilizadas. ',
        '{count} previously verified {areas} reused. ',
        { count: reused, areas: reused === 1 ? copy('área', 'area was') : copy('áreas', 'areas were') },
      )
    : ''
  if (!status.currentGridLabel) return `${reusePrefix}${copy('{checked} de {total} áreas verificadas.', '{checked} of {total} areas checked.', { checked, total: status.total })}`
  if (status.receivedRecords !== null && status.receivedRecords > 0) {
    return `${reusePrefix}${copy('Lendo e salvando {area}. {count} linhas recebidas até agora.', 'Reading and saving {area}. {count} rows received so far.', { area: status.currentGridLabel, count: formatCount(status.receivedRecords, locale) })}`
  }
  return `${reusePrefix}${copy('Lendo e salvando {area}.', 'Reading and saving {area}.', { area: status.currentGridLabel })}`
}

function coverageTone(state: NonNullable<NationalLifeSyncStatus['stageCoverage']>[number]['state']) {
  if (state === 'VERIFIED') return 'border-teal/30 bg-teal-pale/45 text-teal-deep'
  if (state === 'REUSED') return 'border-teal/30 bg-teal-pale/25 text-teal-deep'
  if (state === 'CAPTURED') return 'border-blue-200 bg-blue-50 text-blue-800'
  if (state === 'READING') return 'border-gold/40 bg-gold-pale text-gold-ink'
  if (state === 'FAILED') return 'border-red-300 bg-red-50 text-red-700'
  return 'border-border-steel bg-panel/55 text-ink-muted'
}

function coverageLabel(state: NonNullable<NationalLifeSyncStatus['stageCoverage']>[number]['state'], copy: Copy) {
  if (state === 'VERIFIED') return copy('Verificado', 'Verified')
  if (state === 'REUSED') return copy('Reutilizado', 'Reused')
  if (state === 'CAPTURED') return copy('Capturado', 'Captured')
  if (state === 'READING') return copy('Lendo', 'Reading')
  if (state === 'FAILED') return copy('Precisa tentar novamente', 'Needs retry')
  return copy('Aguardando', 'Waiting')
}

export function NationalLifeSyncProgress({
  initialStatus,
}: {
  initialStatus: NationalLifeSyncStatus | null
}) {
  const { copy, locale } = useI18n()
  const [status, setStatus] = useState<NationalLifeSyncStatus | null>(initialStatus)
  const [pollingEnabled, setPollingEnabled] = useState(Boolean(initialStatus?.shouldPoll))

  useEffect(() => {
    let alive = true
    const refresh = async () => {
      try {
        const response = await fetch('/api/agent/integrations/national-life/sync', {
          cache: 'no-store',
        })
        if (!response.ok) return
        const body = (await response.json()) as { run?: unknown }
        const next = safeStatus(body.run)
        if (alive && next) {
          setStatus(next)
          if (!next.shouldPoll) setPollingEnabled(false)
        }
      } catch {
        // Keep the last known progress. A transient status request must not
        // turn a real bar into an empty state.
      }
    }

    const onSyncStarted = () => {
      setPollingEnabled(true)
      void refresh()
    }
    window.addEventListener(NATIONAL_LIFE_SYNC_STARTED_EVENT, onSyncStarted)

    if (!pollingEnabled) {
      return () => window.removeEventListener(NATIONAL_LIFE_SYNC_STARTED_EVENT, onSyncStarted)
    }

    void refresh()
    const timer = window.setInterval(refresh, POLL_INTERVAL_MS)
    return () => {
      alive = false
      window.clearInterval(timer)
      window.removeEventListener(NATIONAL_LIFE_SYNC_STARTED_EVENT, onSyncStarted)
    }
  }, [pollingEnabled])

  if (!status) {
    return (
      <section
        aria-label={copy('Progresso da sincronização da National Life', 'National Life sync progress')}
        className="mb-6 rounded-xl border border-border-steel bg-paper p-5 sm:p-6"
      >
        <KBotActivity
          state="idle"
          title={copy('O K-Bot está pronto para a primeira sincronização', 'K-Bot is ready for the first sync')}
          detail={copy('Inicie acima. Este painel mostrará cada área da National Life conforme ela for recebida e salva.', 'Start it above. This panel will show each National Life area only as it is received and saved.')}
        />
        <div className="mt-5 flex items-center justify-between rounded-xl border border-border-steel bg-panel/55 px-4 py-3 text-sm">
          <span className="font-medium text-ink">{copy('Nenhuma sincronização foi iniciada nesta conta.', 'No sync has started on this account yet.')}</span>
          <span className="text-ink-muted">{copy('Aguardando a primeira execução', 'Waiting for your first run')}</span>
        </div>
      </section>
    )
  }

  const message = friendlyState(status, copy)
  const terminal = status.state === 'COMPLETED' || status.state === 'PARTIAL' || status.state === 'FAILED'
  const active = status.shouldPoll
  const checked = Math.min(status.total, status.completed + status.failed)
  const reused = status.stageCoverage?.filter((stage) => stage.state === 'REUSED').length ?? 0
  const snapshotRecords = snapshotRecordCount(status)
  const plannedSnapshotSources = status.stageCoverage?.filter((stage) =>
    DISCOVERY_PAGE_KEYS.has(stage.gridKey),
  ).length ?? 0
  const plannedStructuredSources = Math.max(0, (status.stageCoverage?.length ?? 0) - plannedSnapshotSources)
  const currentPriorityPlan = isCurrentPriorityPlan(status)
  const historicalCompletedPlan = status.state === 'COMPLETED' && !currentPriorityPlan
  const lastSynced = formatMoment(status.completedAt, locale)
  // Só depois do fim. No meio do run, "nada novo desta vez" ou "120 gravados"
  // seriam a mesma mentira do "concluído" eterno, apontada para o outro lado.
  const outcome = terminal ? outcomeLine(status, snapshotRecords, copy, locale) : null
  const discards = terminal ? discardLine(status, snapshotRecords, copy, locale) : null
  const estimate = estimateLine(status, copy)
  const botState: KBotState = status.state === 'COMPLETED'
    ? 'success'
    : status.state === 'PAUSED' || status.state === 'PARTIAL'
      ? 'waiting'
      : status.state === 'FAILED'
        ? 'error'
        : active
          ? 'working'
          : 'idle'
  const botTitle = status.state === 'COMPLETED'
    ? currentPriorityPlan
      ? copy('O K-Bot terminou de atualizar seus dados prioritários', 'K-Bot finished updating your priority data')
      : copy('O K-Bot preservou sua sincronização anterior da National Life', 'K-Bot preserved your previous National Life sync')
    : status.state === 'PAUSED'
      ? copy('O K-Bot precisa do seu login da National Life', 'K-Bot needs your National Life login')
      : terminal
        ? copy('O K-Bot salvou as áreas disponíveis', 'K-Bot saved the available areas')
        : copy('O K-Bot está atualizando seus dados da National Life', 'K-Bot is updating your National Life data')
  const botDetail = status.state === 'PAUSED'
    ? copy('Entre uma vez e a mesma tarefa continuará do último ponto salvo.', 'Sign in once and the same task continues from its last saved checkpoint.')
    : active
      ? status.currentGridLabel
        ? copy('O K-Bot está coletando suas informações de {area} na National Life. Tudo que já foi coletado está seguro.', 'K-Bot is collecting your {area} information from National Life. Everything already collected is safe.', { area: status.currentGridLabel })
        : copy('O K-Bot está abrindo a próxima área necessária na National Life.', 'K-Bot is opening the next place it needs in National Life.')
      : status.state === 'COMPLETED'
        ? copy('Os dados verificados estão disponíveis em toda a Keepr One.', 'Verified data is ready throughout Keepr One.')
        : copy('Você pode tentar novamente apenas as áreas que a National Life não retornou.', 'You can retry only the areas National Life did not return.')

  return (
    <section
      aria-label={copy('Progresso da sincronização da National Life', 'National Life sync progress')}
      aria-busy={active}
      className="mb-6 rounded-xl border border-border-steel bg-paper p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <KBotActivity
            state={botState}
            title={botTitle}
            detail={botDetail}
            estimate={estimate}
          />
          {terminal && lastSynced && (
            <p className="ml-[60px] mt-1 text-xs text-ink-muted">{copy('Última sincronização: {date}', 'Last synced {date}', { date: lastSynced })}</p>
          )}
          {historicalCompletedPlan && (
            <p className="ml-[60px] mt-1 max-w-2xl text-xs text-ink-muted">
              {copy('Esta foi uma execução mais ampla do portal. Inicie uma sincronização para atualizar as fontes prioritárias atuais.', 'This was a broader portal run. Start a sync to refresh the current priority sources.')}
            </p>
          )}
        </div>
        <div className="text-right">
          <span className="block font-mono text-sm font-semibold tabular-nums text-teal">
            {copy('{checked} de {total} áreas do portal verificadas', '{checked} of {total} portal areas checked', { checked, total: status.total })}
          </span>
          {status.estimate && (
            <span className="mt-1 block text-xs text-ink-muted">
              <span className="block">
                {copy(
                  'Com base em {count} {runs} recentes desta conta',
                  'Based on {count} recent {runs} from this account',
                  { count: status.estimate.basisRuns, runs: status.estimate.basisRuns === 1 ? copy('sincronização', 'sync') : copy('sincronizações', 'syncs') },
                )}
              </span>
            </span>
          )}
        </div>
      </div>

      <progress
        aria-label={copy('Progresso da atualização', 'Update progress')}
        className="mt-5 h-2 w-full overflow-hidden rounded-full accent-teal"
        max={status.total}
        value={checked}
      />

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-ink-muted">
        <span>
          {outcome ?? activeLine(status, reused, copy, locale)}
          {discards && <span className="block text-xs text-ink-muted">{discards}</span>}
        </span>
        {message && (
          <span className="font-semibold text-gold">
            {message}
            {status.state === 'PAUSED' && (
              <Link className="ml-2 underline" href="/agent/integrations/national-life">
                {copy('Conectar', 'Connect')}
              </Link>
            )}
          </span>
        )}
      </div>

      {active && status.failed > 0 && (
        <div className="mt-4 rounded-xl border border-gold/35 bg-gold-pale px-4 py-3 text-sm text-gold-ink">
          {copy(
            '{count} {areas} não puderam ser lidas. A sincronização continua com as áreas restantes.',
            '{count} {areas} not be read. The sync is continuing with the remaining areas.',
            { count: status.failed, areas: status.failed === 1 ? copy('área', 'area could') : copy('áreas', 'areas could') },
          )}
        </div>
      )}

      {terminal && status.delta && (
        <div className="mt-5 rounded-xl border border-teal/20 bg-teal-pale/30 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-teal-deep">{copy('O que mudou na Keepr One', 'What changed in Keepr One')}</p>
          <div className="mt-3 flex flex-wrap gap-2 text-sm">
            <span className="rounded-full bg-paper px-3 py-1.5 font-semibold text-ink shadow-sm">
              {copy('{count} novos na Keepr One', '{count} new to Keepr One', { count: status.delta.addedRecords.toLocaleString(locale) })}
            </span>
            <span className="rounded-full bg-paper px-3 py-1.5 font-semibold text-ink shadow-sm">
              {copy('{count} reconfirmados', '{count} reconfirmed', { count: status.delta.refreshedRecords.toLocaleString(locale) })}
            </span>
            {status.delta.newCommissionAmount !== null && (
              <span className="rounded-full bg-paper px-3 py-1.5 font-semibold text-ink shadow-sm">
                {copy('{amount} em novos lançamentos de comissão recebidos', '{amount} in newly received commission entries', { amount: money(status.delta.newCommissionAmount, locale) })}
              </span>
            )}
          </div>
        </div>
      )}

      {terminal && status.failed > 0 && (
        <button
          type="button"
          className="mt-4 inline-flex min-h-10 items-center justify-center rounded-full bg-rail-strong px-4 py-2 text-sm font-semibold text-paper transition-colors hover:bg-rail"
          onClick={() => window.dispatchEvent(new Event(NATIONAL_LIFE_RETRY_REMAINING_EVENT))}
        >
          {copy(
            'Tentar novamente {sources} restante(s)',
            'Retry remaining {sources}',
            { sources: status.failed === 1 ? copy('fonte', 'source') : copy('fontes', 'sources') },
          )}
        </button>
      )}

      <div className={`mt-5 grid overflow-hidden rounded-lg border border-border-steel bg-panel/55 divide-y divide-border-steel sm:divide-x sm:divide-y-0 ${snapshotRecords > 0 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
        <div className="p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-muted">{copy('Recebido da National Life', 'Received from National Life')}</p>
          <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-ink">{formatCount(status.receivedRecords, locale)}</p>
          <p className="mt-1 text-xs text-ink-muted">{copy('Linhas entregues pelo portal', 'Rows delivered by the portal')}</p>
        </div>
        <div className="bg-teal-pale/45 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-teal-deep">{copy('Estruturado na Keepr One', 'Structured in Keepr One')}</p>
          <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-ink">{formatCount(status.writtenRecords, locale)}</p>
          <p className="mt-1 text-xs text-ink-muted">{copy('Linhas gravadas nos seus dados da National Life', 'Rows written to your National Life data')}</p>
        </div>
        {snapshotRecords > 0 && (
          <div className="bg-blue-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-blue-800">{copy('Snapshots de origem preservados', 'Source snapshots preserved')}</p>
            <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-ink">
              {snapshotRecords.toLocaleString(locale)}
            </p>
            <p className="mt-1 text-xs text-ink-muted">{copy('Mantidos para mapeamento, sem aparecer como linhas operacionais', 'Kept for mapping, not shown as operational rows')}</p>
          </div>
        )}
      </div>

      {status.stageCoverage && status.stageCoverage.length > 0 && (
        <div className="mt-5 border-t border-border-steel pt-4">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-muted">{copy('Cobertura das fontes do portal', 'Portal source coverage')}</p>
            {reused > 0 && (
              <p className="text-xs text-ink-muted">
                {copy('As áreas reutilizadas já haviam sido verificadas na tentativa anterior.', 'Reused areas were already verified in the previous attempt.')}
              </p>
            )}
          </div>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {status.stageCoverage.map((stage) => (
              <li key={stage.gridKey} className={`rounded-lg border px-3 py-2 text-xs ${coverageTone(stage.state)}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold capitalize">{stage.label ?? stage.gridKey.replace(/_/g, ' ').toLowerCase()}</span>
                  <span className="font-mono text-[10px] uppercase">{coverageLabel(stage.state, copy)}</span>
                </div>
                {stage.verifiedRecords !== null && (
                  <p className="mt-1 font-mono tabular-nums">
                    {stage.verifiedRecords.toLocaleString(locale)}{' '}
                    {stage.state === 'CAPTURED'
                      ? copy('registros de snapshot capturados', 'snapshot records captured')
                      : copy('linhas verificadas', 'rows verified')}
                  </p>
                )}
                {stage.verifiedAt && (
                  <p className="mt-1 text-[10px] opacity-80">
                    {copy('Confirmado pela National Life em {date}', 'Confirmed by National Life {date}', { date: formatMoment(stage.verifiedAt, locale) ?? '—' })}
                  </p>
                )}
                {stage.state === 'FAILED' && (
                  <p className="mt-1 text-[10px] font-semibold">{copy('A última tentativa precisa ser refeita', 'Last attempt needs retry')}</p>
                )}
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border-steel bg-panel/45 px-3 py-2 text-xs text-ink-muted">
            <span>
              {currentPriorityPlan ? copy('Plano atual', 'Current plan') : copy('Plano da execução anterior', 'Previous run plan')}: {plannedStructuredSources} {copy('estruturadas', 'structured')}
              {plannedSnapshotSources > 0
                ? copy(' + {count} fontes de snapshot', ' + {count} snapshot sources', { count: plannedSnapshotSources })
                : ''}
            </span>
            <span className="font-mono font-semibold tabular-nums text-ink">
              {copy(
                '{automatic} de {required} fontes conhecidas estão estruturadas operacionalmente',
                '{automatic} of {required} known sources are operationally structured',
                { automatic: PORTAL_COVERAGE.automatic, required: PORTAL_COVERAGE.required },
              )}
            </span>
          </div>
        </div>
      )}

      {active && (
        <p className="mt-4 text-xs leading-5 text-ink-muted">
          {copy(
            'Os dados são salvos em lotes conforme cada área termina. Você pode continuar trabalhando em qualquer parte da Keepr One durante a leitura da National Life.',
            'Data is saved in batches as each area finishes. You can keep working anywhere in Keepr One while National Life is being read.',
          )}
        </p>
      )}
    </section>
  )
}
