'use client'

import Link from 'next/link'
import { useEffect, useState, useSyncExternalStore } from 'react'
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
const subscribeToBrowserMount = () => () => {}
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
    ? copy(
        'Normalmente, cerca de {minutes} min para as áreas restantes',
        'Typically about {minutes} min for the remaining areas',
        { minutes: lowerMinutes },
      )
    : copy(
        'Normalmente, cerca de {lower}–{upper} min para as áreas restantes',
        'Typically about {lower}–{upper} min for the remaining areas',
        { lower: lowerMinutes, upper: upperMinutes },
      )
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

type StageState = NonNullable<NationalLifeSyncStatus['stageCoverage']>[number]['state']
type SegmentState = StageState | 'DONE'

function segmentTone(state: SegmentState) {
  if (state === 'VERIFIED' || state === 'REUSED' || state === 'DONE') return 'bg-teal'
  if (state === 'CAPTURED') return 'bg-blue-600'
  if (state === 'READING') return 'bg-gold animate-pulse motion-reduce:animate-none'
  if (state === 'FAILED') return 'bg-danger'
  return 'bg-border-steel'
}

/// One segment per stage of the plan, so a run at "0 of 6" still shows where
/// K-Bot is instead of an empty gray bar. The native <progress> stays for
/// assistive tech; this is its visual twin.
function stageSegments(status: NationalLifeSyncStatus, checked: number): SegmentState[] {
  if (status.stageCoverage && status.stageCoverage.length === status.total) {
    return status.stageCoverage.map((stage) => stage.state)
  }
  return Array.from({ length: status.total }, (_, index): SegmentState => {
    if (index < status.completed) return 'DONE'
    if (index < checked) return 'FAILED'
    if (index === checked && status.shouldPoll) return 'READING'
    return 'PENDING'
  })
}

function StageIcon({ state }: { state: StageState }) {
  const base = 'mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full'
  if (state === 'VERIFIED' || state === 'REUSED') {
    return (
      <span aria-hidden="true" className={`${base} ${state === 'VERIFIED' ? 'bg-teal text-paper' : 'border border-teal text-teal'}`}>
        <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 6.2 5 8.5l4.5-5" /></svg>
      </span>
    )
  }
  if (state === 'CAPTURED') {
    return (
      <span aria-hidden="true" className={`${base} bg-blue-50 text-blue-700`}>
        <span className="h-2 w-2 rounded-[2px] bg-current" />
      </span>
    )
  }
  if (state === 'READING') {
    return (
      <span aria-hidden="true" className={base}>
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-gold/25 border-t-gold motion-reduce:animate-none" />
      </span>
    )
  }
  if (state === 'FAILED') {
    return (
      <span aria-hidden="true" className={`${base} bg-danger text-[11px] font-bold leading-none text-paper`}>!</span>
    )
  }
  return (
    <span aria-hidden="true" className={base}>
      <span className="h-3.5 w-3.5 rounded-full border-[1.5px] border-dashed border-ink-muted/50" />
    </span>
  )
}

function coverageLabel(state: StageState, copy: Copy) {
  if (state === 'VERIFIED') return copy('Verificado', 'Verified')
  if (state === 'REUSED') return copy('Reutilizado', 'Reused')
  if (state === 'CAPTURED') return copy('Capturado', 'Captured')
  if (state === 'READING') return copy('Lendo', 'Reading')
  if (state === 'FAILED') return copy('Falhou', 'Failed')
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
  const hydrated = useSyncExternalStore(
    subscribeToBrowserMount,
    () => true,
    () => false,
  )

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
        <div className="mt-5 flex gap-1" aria-hidden="true">
          {Array.from({ length: 6 }, (_, index) => (
            <span key={index} className="h-1.5 flex-1 rounded-full bg-border-steel/70" />
          ))}
        </div>
        <p className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="text-ink">{copy('Nenhuma sincronização foi iniciada nesta conta.', 'No sync has started on this account yet.')}</span>
          <span className="text-ink-muted">{copy('Aguardando a primeira execução', 'Waiting for your first run')}</span>
        </p>
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
  const lastSynced = hydrated ? formatMoment(status.completedAt, locale) : null
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
        ? copy('Tudo que já foi coletado está salvo. Você pode continuar usando a Keepr One enquanto isso.', 'Everything already collected is saved. You can keep using Keepr One meanwhile.')
        : copy('O K-Bot está abrindo a próxima área necessária na National Life.', 'K-Bot is opening the next place it needs in National Life.')
      : status.state === 'COMPLETED'
        ? copy('O plano desta execução terminou. Confira abaixo os dados estruturados e as fontes apenas capturadas.', 'This run’s plan is complete. Review the structured data and capture-only sources below.')
        : copy('Você pode tentar novamente apenas as áreas que a National Life não retornou.', 'You can retry only the areas National Life did not return.')

  const segments = stageSegments(status, checked)
  const pillClass = 'rounded-full border border-border-steel bg-paper px-3 py-1 text-sm font-medium text-ink'

  return (
    <section
      aria-label={copy('Progresso da sincronização da National Life', 'National Life sync progress')}
      aria-busy={active}
      className="mb-6 rounded-xl border border-border-steel bg-paper p-5 sm:p-6"
    >
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1">
          <KBotActivity state={botState} title={botTitle} detail={botDetail} />
          {terminal && lastSynced && (
            <p className="ml-[60px] mt-1 text-xs text-ink-muted">{copy('Última sincronização: {date}', 'Last synced {date}', { date: lastSynced })}</p>
          )}
          {historicalCompletedPlan && (
            <p className="ml-[60px] mt-1 max-w-2xl text-xs text-ink-muted">
              {copy('Esta foi uma execução mais ampla do portal. Inicie uma sincronização para atualizar as fontes prioritárias atuais.', 'This was a broader portal run. Start a sync to refresh the current priority sources.')}
            </p>
          )}
        </div>
        {status.estimate && estimate && (
          <div className="sm:max-w-[16rem] sm:text-right">
            <p className="text-sm font-medium text-ink">{estimate}</p>
            <p className="mt-0.5 text-xs text-ink-muted">
              {copy(
                'Com base em {count} {runs} recentes desta conta',
                'Based on {count} recent {runs} from this account',
                { count: status.estimate.basisRuns, runs: status.estimate.basisRuns === 1 ? copy('sincronização', 'sync') : copy('sincronizações', 'syncs') },
              )}
            </p>
          </div>
        )}
      </header>

      <div className="mt-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="min-w-0 text-sm text-ink">{outcome ?? activeLine(status, reused, copy, locale)}</p>
          <p className="text-sm tabular-nums text-ink-muted">
            <span>{copy('{checked} de {total} etapas concluídas', '{checked} of {total} plan stages finished', { checked, total: status.total })}</span>
            {status.failed > 0 && (
              <span className="ml-2 font-medium text-danger">{copy('{count} etapas com falha; precisam de nova tentativa.', '{count} failed stages need another attempt.', { count: status.failed })}</span>
            )}
          </p>
        </div>
        <progress
          aria-label={copy('Progresso da atualização', 'Update progress')}
          className="sr-only"
          max={status.total}
          value={checked}
        />
        {segments.length > 0 && (
          <div aria-hidden="true" className="mt-3 flex gap-1">
            {segments.map((segment, index) => (
              <span key={index} className={`h-1.5 flex-1 rounded-full transition-colors duration-200 ${segmentTone(segment)}`} />
            ))}
          </div>
        )}
        {discards && <p className="mt-3 max-w-3xl text-xs leading-5 text-ink-muted">{discards}</p>}
      </div>

      {message && (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gold/40 bg-gold-pale px-4 py-3 text-sm text-gold-ink">
          <span className="font-medium">{message}</span>
          {status.state === 'PAUSED' && (
            <Link className="inline-flex min-h-9 items-center rounded-full bg-rail-strong px-4 text-sm font-semibold text-paper transition-colors hover:bg-rail" href="/agent/integrations/national-life">
              {copy('Conectar', 'Connect')}
            </Link>
          )}
        </div>
      )}

      {active && status.failed > 0 && (
        <p className="mt-5 rounded-lg border border-gold/40 bg-gold-pale px-4 py-3 text-sm text-gold-ink">
          {copy(
            '{count} {areas} não puderam ser lidas. A sincronização continua com as áreas restantes.',
            '{count} {areas} not be read. The sync is continuing with the remaining areas.',
            { count: status.failed, areas: status.failed === 1 ? copy('área', 'area could') : copy('áreas', 'areas could') },
          )}
        </p>
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

      <dl className={`mt-6 grid gap-y-4 border-y border-border-steel py-4 sm:divide-x sm:divide-border-steel ${snapshotRecords > 0 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
        <div className="sm:pr-6">
          <dt className="text-sm text-ink-muted">{copy('Recebido da National Life', 'Received from National Life')}</dt>
          <dd className="mt-1 font-mono text-2xl font-semibold tabular-nums tracking-tight text-ink">{formatCount(status.receivedRecords, locale)}</dd>
        </div>
        <div className="sm:px-6">
          <dt className="text-sm text-ink-muted">{copy('Estruturado na Keepr One', 'Structured in Keepr One')}</dt>
          <dd className="mt-1 font-mono text-2xl font-semibold tabular-nums tracking-tight text-teal">{formatCount(status.writtenRecords, locale)}</dd>
        </div>
        {snapshotRecords > 0 && (
          <div className="sm:pl-6">
            <dt className="text-sm text-ink-muted">{copy('Snapshots de origem preservados', 'Source snapshots preserved')}</dt>
            <dd className="mt-1 font-mono text-2xl font-semibold tabular-nums tracking-tight text-ink">{snapshotRecords.toLocaleString(locale)}</dd>
          </div>
        )}
      </dl>

      {terminal && status.delta && (
        <div className="mt-5">
          <p className="text-sm font-semibold text-ink">{copy('O que mudou na Keepr One', 'What changed in Keepr One')}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <span className={pillClass}>
              {copy('{count} novos na Keepr One', '{count} new to Keepr One', { count: status.delta.addedRecords.toLocaleString(locale) })}
            </span>
            <span className={pillClass}>
              {copy('{count} reconfirmados', '{count} reconfirmed', { count: status.delta.refreshedRecords.toLocaleString(locale) })}
            </span>
            {status.delta.newCommissionAmount !== null && (
              <span className={pillClass}>
                {copy('{amount} em novos lançamentos de comissão recebidos', '{amount} in newly received commission entries', { amount: money(status.delta.newCommissionAmount, locale) })}
              </span>
            )}
          </div>
        </div>
      )}

      {status.stageCoverage && status.stageCoverage.length > 0 && (
        <div className="mt-5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p className="text-sm font-semibold text-ink">{copy('Áreas desta atualização', 'Areas in this update')}</p>
            {reused > 0 && (
              <p className="text-xs text-ink-muted">
                {copy('As áreas reutilizadas já haviam sido verificadas na tentativa anterior.', 'Reused areas were already verified in the previous attempt.')}
              </p>
            )}
          </div>
          <ul className="mt-2 grid items-start gap-x-6 sm:grid-cols-2 lg:grid-cols-3">
            {status.stageCoverage.map((stage) => {
              const reading = stage.state === 'READING'
              const failed = stage.state === 'FAILED'
              return (
                <li
                  key={stage.gridKey}
                  className={`-mx-2 flex gap-2.5 rounded-lg px-2 py-2.5 ${reading ? 'bg-gold-pale/70' : failed ? 'bg-danger-pale/70' : ''}`}
                >
                  <StageIcon state={stage.state} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className={`truncate text-sm font-medium capitalize ${stage.state === 'PENDING' ? 'text-ink-muted' : 'text-ink'}`}>
                        {stage.label ?? stage.gridKey.replace(/_/g, ' ').toLowerCase()}
                      </span>
                      <span className={`shrink-0 text-xs ${reading ? 'font-medium text-gold-ink' : failed ? 'font-medium text-danger' : 'text-ink-muted'}`}>
                        {coverageLabel(stage.state, copy)}
                      </span>
                    </div>
                    {stage.verifiedRecords !== null && (
                      <p className="mt-0.5 text-xs tabular-nums text-ink-muted">
                        {stage.verifiedRecords.toLocaleString(locale)}{' '}
                        {stage.state === 'CAPTURED'
                          ? copy('registros de snapshot capturados', 'snapshot records captured')
                          : copy('linhas verificadas', 'rows verified')}
                      </p>
                    )}
                    {hydrated && stage.verifiedAt && (
                      <p className="mt-0.5 text-xs text-ink-muted">
                        {copy('Confirmado pela National Life em {date}', 'Confirmed by National Life {date}', { date: formatMoment(stage.verifiedAt, locale) ?? '—' })}
                      </p>
                    )}
                    {failed && (
                      <p className="mt-0.5 text-xs font-medium text-danger">{copy('A última tentativa precisa ser refeita', 'Last attempt needs retry')}</p>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>

          <details className="group mt-3 border-t border-border-steel pt-3 text-xs text-ink-muted">
            <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 font-medium text-ink-muted hover:text-ink [&::-webkit-details-marker]:hidden">
              <svg aria-hidden="true" viewBox="0 0 12 12" className="h-3 w-3 transition-transform duration-200 group-open:rotate-90 motion-reduce:transition-none" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="m4.5 2.5 3.5 3.5-3.5 3.5" /></svg>
              {copy('Detalhes do plano', 'Plan details')}
            </summary>
            <dl className="mt-2 grid gap-1.5 pl-[18px] leading-5">
              <div>
                {currentPriorityPlan ? copy('Plano atual', 'Current plan') : copy('Plano da execução anterior', 'Previous run plan')}: {plannedStructuredSources} {copy('estruturadas', 'structured')}
                {plannedSnapshotSources > 0
                  ? copy(' + {count} fontes de snapshot', ' + {count} snapshot sources', { count: plannedSnapshotSources })
                  : ''}
              </div>
              {status.state === 'COMPLETED' && (
                <div>{copy('Plano concluído: {structured} fontes estruturadas + {captured} fontes apenas capturadas.', 'Plan complete: {structured} structured sources + {captured} capture-only sources.', { structured: plannedStructuredSources, captured: plannedSnapshotSources })}</div>
              )}
              <div>
                {copy(
                  '{automatic} de {required} fontes conhecidas estão estruturadas operacionalmente',
                  '{automatic} of {required} known sources are operationally structured',
                  { automatic: PORTAL_COVERAGE.automatic, required: PORTAL_COVERAGE.required },
                )}
              </div>
            </dl>
          </details>
        </div>
      )}
    </section>
  )
}
