export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentAgent } from '@/lib/agent-context'
import { flexLifeProductLabel } from '@/lib/national-life/flex-life'
import {
  buildForesightIllustrationSnapshot,
  isForesightQuickReview,
  type ForesightQuickReview,
} from '@/lib/national-life/foresight-illustration-contract'
import { resolveForesightTermDurationResult } from '@/lib/national-life/foresight-term-contract'
import { IllustrationPdfButton } from '../IllustrationPdfButton'
import { getNationalLifeLocalConnectorConfig } from '@/lib/national-life/local-connector/config'
import { getIllustrationCommandStatuses } from '@/lib/national-life/illustration-command-status'
import {
  describeIllustrationDelivery,
  illustrationPdfMessage,
} from '@/lib/national-life/illustration-pdf-status'
import { Shell } from '@/components/Shell'
import { PageHeader } from '@/components/PageHeader'
import { ForesightActivityIndicator } from '../ForesightActivityIndicator'
import { getServerI18n } from '@/lib/i18n/server'
import { localeFor } from '@/lib/i18n/config'
import { StartApplicationFromIllustrationButton } from '../StartApplicationFromIllustrationButton'
import { TermPdfReconciliationButton } from '../TermPdfReconciliationButton'

const currency = (value: number, locale: string) =>
  new Intl.NumberFormat(locale, {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
  }).format(value)

const premiumCurrency = (value: number, locale: string) =>
  new Intl.NumberFormat(locale, {
    style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(value)

type ForesightResult = {
  solveBasis: 'DEATH_BENEFIT' | 'PREMIUM'
  requestedAmount: number
  confirmedFaceAmount: number
  confirmedMonthlyPremium: number
  confirmedAnnualPremium: number
}

function foresightResultFrom(rawPayload: unknown): ForesightResult | null {
  if (!rawPayload || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) return null
  if ('foresightTermResult' in rawPayload) {
    const result = rawPayload.foresightTermResult
    if (!result || typeof result !== 'object' || Array.isArray(result)) return null
    const candidate = result as Record<string, unknown>
    if (candidate.source !== 'OFFICIAL_PDF' || candidate.premiumMode !== 'Monthly' ||
      !['confirmedFaceAmount', 'confirmedMonthlyPremium', 'confirmedAnnualPremium']
        .every((key) => typeof candidate[key] === 'number' && Number.isFinite(candidate[key]) && Number(candidate[key]) > 0)) {
      return null
    }
    return {
      solveBasis: 'DEATH_BENEFIT',
      requestedAmount: candidate.confirmedFaceAmount as number,
      confirmedFaceAmount: candidate.confirmedFaceAmount as number,
      confirmedMonthlyPremium: candidate.confirmedMonthlyPremium as number,
      confirmedAnnualPremium: candidate.confirmedAnnualPremium as number,
    }
  }
  if (!('foresightResult' in rawPayload)) return null
  const result = rawPayload.foresightResult
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null
  const candidate = result as Record<string, unknown>
  if (!['DEATH_BENEFIT', 'PREMIUM'].includes(String(candidate.solveBasis)) ||
    !['requestedAmount', 'confirmedFaceAmount', 'confirmedMonthlyPremium', 'confirmedAnnualPremium']
      .every((key) => typeof candidate[key] === 'number' && Number.isFinite(candidate[key]) && Number(candidate[key]) > 0)) {
    return null
  }
  return candidate as ForesightResult
}

function quickReviewFrom(rawPayload: unknown): ForesightQuickReview | null {
  if (!rawPayload || typeof rawPayload !== 'object' || Array.isArray(rawPayload) ||
    !('foresightResult' in rawPayload)) return null
  const result = rawPayload.foresightResult
  if (!result || typeof result !== 'object' || Array.isArray(result) ||
    !('quickReview' in result)) return null
  return isForesightQuickReview(result.quickReview) ? result.quickReview : null
}

function strategyLabel(method: string, copy: (pt: string, en: string) => string): string {
  const labels: Record<string, string> = {
    Minimum_DB_Max_Cash_Value: copy('Máximo Cash Value', 'Maximum Cash Value'),
    Balanced_DB: copy('Benefício balanceado', 'Balanced death benefit'),
    Based_on_Target_Premium: 'Target Premium',
    Protection_Focus: copy('Foco em proteção', 'Protection focus'),
    Retirement_Focus: copy('Foco em aposentadoria', 'Retirement focus'),
  }
  return labels[method] ?? method.replaceAll('_', ' ')
}

const day = (value: Date, locale: string) =>
  new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeZone: 'UTC' }).format(value)

const instant = (value: Date, locale: string) =>
  new Intl.DateTimeFormat(locale, { dateStyle: 'short' }).format(value)

function englishIllustrationPdfMessage(
  status: Parameters<typeof illustrationPdfMessage>[0],
): string {
  if (status.state === 'WAITING_FOR_KBOT') {
    return 'K-Bot is waiting to connect on this computer before starting the same request.'
  }
  if (status.state === 'WORKING') {
    return 'K-Bot is doing in Foresight what you would do: entering the scenario, waiting for the calculation, and preparing the PDF. Typical estimate: 2–5 minutes.'
  }
  if (status.state === 'BLOCKED') {
    return 'K-Bot is waiting for you to sign in to National Life before continuing the same request.'
  }

  switch (status.safeErrorCode) {
    case 'FORESIGHT_SSO_EXPIRED':
      return 'The carrier requested a new sign-in. Reconnect the integration and request it again.'
    case 'CARRIER_BROWSER_BUSY':
      return 'The carrier was busy. You can request it again.'
    case 'FORESIGHT_REPORT_FAILED':
      return 'The carrier did not finish generating the document. You can request it again.'
    case 'FORESIGHT_REPORT_TIMEOUT':
      return 'The carrier took longer than expected. You can request it again.'
    case 'FORESIGHT_ARTIFACT_MISSING':
      return 'The case was completed without a verifiable PDF. Generate it again.'
    case 'COMMAND_EXPIRED':
      return 'The attempt expired before it finished. You can request it again.'
    case 'FORESIGHT_PREMIUM_WRITE_MISMATCH':
      return 'Foresight did not accept the monthly premium entered for this scenario. Review the premium and generate a new illustration; no PDF was issued.'
    case 'FORESIGHT_CALCULATION_UNAVAILABLE':
      return 'Foresight could not calculate a valid scenario with this source amount. Review the face amount or premium and generate a new illustration; no PDF was issued.'
    case 'FORESIGHT_CLIENT_READBACK_TIMEOUT':
      return 'Foresight did not confirm the insured data. Review the date of birth, state, and risk profile before trying again; no PDF was issued.'
    case 'FORESIGHT_TERM_CLIENT_JURISDICTION_WRITE_MISMATCH':
    case 'FORESIGHT_TERM_CLIENT_NAME_WRITE_MISMATCH':
    case 'FORESIGHT_TERM_CLIENT_INFORMATION_WRITE_MISMATCH':
    case 'FORESIGHT_TERM_CLIENT_RISK_WRITE_MISMATCH':
    case 'FORESIGHT_TERM_CLIENT_OWNER_WRITE_MISMATCH':
      return 'Foresight did not confirm a Term client-data step after one safe retry. No PDF was issued, and K-Bot will not keep trying on its own.'
    case 'FORESIGHT_TERM_FUNDING_TIMEOUT':
      return 'Foresight was still updating the Term scenario and did not confirm the values in time. Generate it again; no PDF was issued.'
    case 'FORESIGHT_TERM_DURATION_READBACK_MISMATCH':
      return 'Foresight changed the Term duration during the update. Review the duration and generate it again; no PDF was issued.'
    case 'FORESIGHT_TERM_PREMIUM_MISSING':
    case 'FORESIGHT_TERM_PREMIUM_MISMATCH':
    case 'FORESIGHT_TERM_PDF_INVALID':
      return 'The Term PDF was received, but the premiums could not be verified. Try verifying this PDF again; if the issue persists, generate a new illustration.'
    case 'FORESIGHT_TERM_CLIENT_READBACK_MISMATCH':
      return 'Foresight returned insured data that differs from the Term request. Review the scenario and generate it again; no PDF was issued.'
    case 'FORESIGHT_TERM_FACE_AMOUNT_READBACK_MISMATCH':
    case 'FORESIGHT_TERM_FUNDING_READBACK_MISMATCH':
      return 'Foresight returned a face amount or billing value that differs from the Term request. Review the scenario and generate it again; no PDF was issued.'
    case 'FORESIGHT_SOLVE_READBACK_TIMEOUT':
    case 'FORESIGHT_SOLVE_READBACK_MISMATCH':
    case 'FORESIGHT_RESPONSE_INVALID':
      return 'Foresight did not return a verifiable result for this scenario. Review the source amount and generate a new illustration; no PDF was issued.'
    case 'FORESIGHT_QUICK_VIEW_READBACK_MISMATCH':
      return 'The National Life Quick Review was incomplete or differed from the calculated values. No PDF was issued, and no number was accepted as official.'
    case null:
      return 'The PDF could not be generated.'
    default:
      return `The PDF could not be generated (${status.safeErrorCode}).`
  }
}

function Fact({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="border-t border-white/10 py-3">
      <dt className="text-xs uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd className="mt-1 text-sm text-ink">{value ?? '—'}</dd>
    </div>
  )
}

export default async function IllustrationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { copy, language } = await getServerI18n()
  const locale = localeFor(language)
  const { id } = await params
  const agent = await getCurrentAgent()
  const localConnector = getNationalLifeLocalConnectorConfig()
  const user = await prisma.user.findUnique({
    where: { id: agent.userId }, select: { name: true },
  })
  const illustration = await prisma.illustration.findFirst({
    where: { id, agentId: agent.id },
    select: {
      id: true, createdAt: true, insuredName: true, insuredDateOfBirth: true,
      productName: true, faceAmount: true, premium: true, targetPremium: true, targetPremiumSource: true,
      documentFetchedAt: true, documentMimeType: true, caseId: true, rawPayload: true,
    },
  })
  if (!illustration) notFound()
  const foresightSnapshot = (() => {
    try {
      return buildForesightIllustrationSnapshot(illustration)
    } catch {
      // Older rows are still useful history, even when they pre-date the
      // sealed Foresight request shape and cannot safely be regenerated.
      return null
    }
  })()
  const commandStatus = (await getIllustrationCommandStatuses(agent.id, [illustration.id])).get(illustration.id)
  const documentReady = illustration.documentFetchedAt && illustration.documentMimeType === 'application/pdf'
  const foresightResult = documentReady ? foresightResultFrom(illustration.rawPayload) : null
  const quickReview = quickReviewFrom(illustration.rawPayload)
  const isTermProduct = illustration.productName === 'NL Term' || illustration.productName === 'LSW Term'
  const termDurationResult = isTermProduct ? (() => {
    try {
      return resolveForesightTermDurationResult(illustration)
    } catch {
      return null
    }
  })() : null
  const resultVerified = Boolean(documentReady && foresightResult)
  const needsTermReconciliation = Boolean(isTermProduct && documentReady && !foresightResult)
  const hasCarrierPremium = Boolean(foresightResult && illustration.premium)
  const premiumValue = hasCarrierPremium ? illustration.premium : illustration.targetPremium
  const carrierAdjustedPremium = foresightResult?.solveBasis === 'PREMIUM' &&
    Math.abs(foresightResult.requestedAmount - foresightResult.confirmedMonthlyPremium) > 0.005
  const carrierAdjustedFace = foresightResult?.solveBasis === 'DEATH_BENEFIT' &&
    Math.abs(foresightResult.requestedAmount - foresightResult.confirmedFaceAmount) > 0.005
  const deliveryPt = describeIllustrationDelivery({
    documentReady: Boolean(documentReady),
    verified: resultVerified,
    status: commandStatus,
  })
  const termVerificationFailed = commandStatus?.state === 'FAILED' && [
    'FORESIGHT_TERM_PREMIUM_MISSING',
    'FORESIGHT_TERM_PREMIUM_MISMATCH',
    'FORESIGHT_TERM_PDF_INVALID',
  ].includes(commandStatus.safeErrorCode ?? '')
  const delivery = language === 'PT'
    ? deliveryPt
    : termVerificationFailed && commandStatus?.state === 'FAILED'
      ? {
          eyebrow: 'Review required',
          title: 'The Term PDF could not be verified',
          detail: englishIllustrationPdfMessage(commandStatus),
        }
      : documentReady && !resultVerified
        ? commandStatus?.state === 'FAILED'
          ? {
              eyebrow: 'Review required',
              title: 'The PDF was received, but verification did not finish',
              detail: `The file was received, but K-Bot did not finish verifying the result. No value was accepted as official. ${englishIllustrationPdfMessage(commandStatus)}`,
            }
          : {
              eyebrow: 'Document received',
              title: 'K-Bot is verifying the official PDF',
              detail: 'The file was received from National Life, but its values have not yet been accepted as the official result.',
            }
        : resultVerified
          ? {
              eyebrow: 'Document ready',
              title: 'Official PDF verified',
              detail: 'The file was received from Foresight and verified before becoming available here.',
            }
          : commandStatus?.state === 'BLOCKED'
            ? {
                eyebrow: 'K-Bot · action required',
                title: 'Connect National Life to continue',
                detail: 'The browser session expired. After you sign in, K-Bot resumes the same request.',
              }
            : commandStatus?.state === 'WAITING_FOR_KBOT'
              ? {
                  eyebrow: 'K-Bot · connection required',
                  title: 'Reconnect K-Bot to start',
                  detail: 'The official request is saved. Reconnect K-Bot on this computer so it can open Foresight and continue the same illustration.',
                }
              : commandStatus?.state === 'WORKING'
                ? {
                    eyebrow: 'K-Bot at work',
                    title: 'K-Bot is generating the official illustration',
                    detail: 'K-Bot is entering the case, checking the National Life calculation, and preparing the PDF. Typical estimate: 2–5 minutes; you can keep working.',
                  }
                : commandStatus?.state === 'FAILED'
                  ? {
                      eyebrow: 'Review required',
                      title: 'Foresight did not accept this scenario',
                      detail: englishIllustrationPdfMessage(commandStatus),
                    }
                  : {
                      eyebrow: 'Request prepared',
                      title: 'Ready to send to Foresight',
                      detail: 'Review the instructions below and start official generation when you are ready.',
                    }
  const isGenerating = commandStatus?.state === 'WORKING'
  const foresightStep = resultVerified
    ? copy('Caso salvo', 'Case saved')
    : documentReady
      ? copy('Conferência do PDF pendente', 'PDF verification pending')
    : commandStatus?.state === 'BLOCKED'
      ? copy('Aguardando login', 'Waiting for sign-in')
      : commandStatus?.state === 'WAITING_FOR_KBOT'
        ? copy('Aguardando K-Bot neste computador', 'Waiting for K-Bot on this computer')
      : commandStatus?.state === 'FAILED'
        ? copy('Revisão do cenário necessária', 'Scenario review required')
        : commandStatus?.state === 'WORKING'
          ? copy('Preenchendo, calculando e emitindo', 'Filling in, calculating, and issuing')
          : copy('Aguardando início', 'Waiting to start')
  const commandMessage = commandStatus
    ? language === 'PT' ? illustrationPdfMessage(commandStatus) : englishIllustrationPdfMessage(commandStatus)
    : null

  return (
    <Shell role="AGENT" userName={user?.name ?? ''}>
      <PageHeader
        title={copy('Ilustração {product}', '{product} illustration', { product: flexLifeProductLabel(illustration.productName) })}
        eyebrow={copy('Carteira', 'Book')}
        description={copy('Pedido oficial preparado para o Foresight da National Life.', 'Official request prepared for National Life Foresight.')}
      >
        <Link
          href="/agent/illustrations"
          className="inline-flex items-center border border-white/15 px-4 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-white/[0.06]"
        >
          {copy('Voltar', 'Back')}
        </Link>
      </PageHeader>

      <section className="relative overflow-hidden rounded-[1.55rem] border border-border-steel bg-paper p-5 shadow-[0_20px_58px_rgba(15,29,19,0.058)] sm:p-7" aria-live={resultVerified ? 'off' : 'polite'}>
        <div className="absolute -right-12 -top-12 h-40 w-40 rounded-full border border-teal/15 shadow-[0_0_0_28px_rgba(31,128,86,0.035),0_0_0_56px_rgba(31,128,86,0.02)]" aria-hidden="true" />
        <div className="relative grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-teal">
              {isGenerating
                ? <ForesightActivityIndicator label={delivery.eyebrow} />
                : delivery.eyebrow}
            </p>
            <h2 className="mt-2 text-2xl font-medium tracking-[-0.04em] text-ink">{delivery.title}</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-muted">{delivery.detail}</p>
          </div>
          {documentReady ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <a
                href={`/api/illustrations/${illustration.id}/document`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-11 items-center justify-center rounded-md border border-border-steel bg-paper px-5 py-2.5 text-sm font-semibold text-teal-deep transition-colors hover:border-teal hover:bg-teal-pale"
              >
                {resultVerified
                  ? copy('Abrir PDF oficial', 'Open official PDF')
                  : copy('Abrir PDF recebido', 'Open received PDF')}
              </a>
              {needsTermReconciliation ? (
                <TermPdfReconciliationButton illustrationId={illustration.id} />
              ) : null}
              {foresightResult ? (
                <StartApplicationFromIllustrationButton illustrationId={illustration.id} />
              ) : null}
            </div>
          ) : (
            <IllustrationPdfButton
              illustrationId={illustration.id}
              extensionId={localConnector.enabled ? localConnector.extensionTarget : undefined}
              disabled={commandStatus?.state === 'WORKING'}
              status={commandStatus?.state}
              safeErrorCode={commandStatus?.state === 'FAILED' ? commandStatus.safeErrorCode : undefined}
            />
          )}
        </div>
        <ol className="relative mt-6 grid gap-3 border-t border-border-steel pt-5 sm:grid-cols-3" aria-label={copy('Progresso da ilustração', 'Illustration progress')}>
          {[
            [copy('Dados revisados', 'Data reviewed'), copy('Cenário aprovado na Keepr One', 'Scenario approved in Keepr One'), 'complete'],
            ['K-Bot no Foresight', foresightStep, resultVerified ? 'complete' : commandStatus?.state === 'WORKING' || commandStatus?.state === 'BLOCKED' || commandStatus?.state === 'WAITING_FOR_KBOT' ? 'current' : 'waiting'],
            [
              copy('PDF oficial', 'Official PDF'),
              resultVerified
                ? copy('Recebido e verificado', 'Received and verified')
                : documentReady
                  ? copy('Recebido; conferência pendente', 'Received; verification pending')
                  : copy('Aguardando a National Life', 'Waiting for National Life'),
              resultVerified ? 'complete' : 'waiting',
            ],
          ].map(([title, detail, stepState], index) => (
            <li key={title as string} className="flex items-start gap-3">
              <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-mono font-semibold ${stepState === 'complete' ? 'bg-teal text-paper' : stepState === 'current' ? 'bg-gold text-ink' : 'bg-panel text-ink-muted'}`}>
                {stepState === 'complete' ? '✓' : `0${index + 1}`}
              </span>
              <span>
                <strong className="block text-xs font-semibold text-ink">{title}</strong>
                <small className="mt-0.5 block text-[11px] leading-4 text-ink-muted">{detail}</small>
              </span>
            </li>
          ))}
        </ol>
        {!resultVerified && commandStatus && (
          <p className="relative mt-4 border-l-2 border-teal pl-3 text-xs leading-5 text-ink-muted">{commandMessage}</p>
        )}
      </section>

      {quickReview && (
        <section className="mt-6 overflow-hidden rounded-[1.35rem] border border-gold/30 bg-paper shadow-[0_18px_48px_rgba(15,29,19,0.045)]">
          <div className="border-b border-border-steel px-5 py-4 sm:px-6">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-gold-ink">Quick Review · National Life</p>
            <h2 className="mt-1 text-lg font-semibold tracking-[-0.025em] text-ink">{copy('Números revisados antes da montagem do PDF', 'Numbers reviewed before the PDF is assembled')}</h2>
            <p className="mt-1 text-xs leading-5 text-ink-muted">{copy('O K-Bot lê esta tabela diretamente do Foresight depois do cálculo e antes de solicitar o documento oficial.', 'K-Bot reads this table directly from Foresight after calculation and before requesting the official document.')}</p>
            {quickReview.evidence && (
              <p className="mt-1 font-mono text-[10px] text-ink-muted">
                {copy('Fonte: Foresight Quick View · capturado em', 'Source: Foresight Quick View · captured at')} {instant(new Date(quickReview.evidence.observedAt), locale)}
              </p>
            )}
          </div>
          <dl className="grid gap-px bg-border-steel sm:grid-cols-2 lg:grid-cols-4">
            {[
              [copy('Capital inicial', 'Initial face amount'), currency(quickReview.summary.initialFaceAmount, locale)],
              ['Target Premium', premiumCurrency(quickReview.summary.targetPremium, locale)],
              [copy('Prêmio modal', 'Modal premium'), quickReview.summary.modalPremium === null ? '—' : premiumCurrency(quickReview.summary.modalPremium, locale)],
              [copy('MEC Premium', 'MEC premium'), quickReview.summary.mecPremium === null ? '—' : premiumCurrency(quickReview.summary.mecPremium, locale)],
            ].map(([label, value]) => (
              <div key={label} className="bg-paper px-5 py-4">
                <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted">{label}</dt>
                <dd className="mt-1 font-mono text-lg font-semibold tabular-nums text-ink">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="overflow-x-auto p-5 sm:p-6">
            <table className="min-w-[920px] w-full border-collapse text-left text-xs">
              <thead className="border-b border-border-steel text-[10px] uppercase tracking-[0.08em] text-ink-muted">
                <tr>
                  <th className="px-2 py-2">{copy('Ano', 'Year')}</th>
                  <th className="px-2 py-2">{copy('Idade', 'Age')}</th>
                  <th className="px-2 py-2">{copy('Aporte', 'Premium outlay')}</th>
                  <th className="px-2 py-2">{copy('Taxa média', 'Average rate')}</th>
                  <th className="px-2 py-2">{copy('Empréstimo', 'Loan')}</th>
                  <th className="px-2 py-2">{copy('Renda', 'Income')}</th>
                  <th className="px-2 py-2">{copy('Valor acumulado', 'Accumulated value')}</th>
                  <th className="px-2 py-2">Cash surrender</th>
                  <th className="px-2 py-2">{copy('Benefício líquido', 'Net death benefit')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-steel/70">
                {quickReview.annualProjection.map((row) => (
                  <tr key={row.policyYear}>
                    <td className="px-2 py-2 font-mono tabular-nums">{row.policyYear}</td>
                    <td className="px-2 py-2 font-mono tabular-nums">{row.age}</td>
                    <td className="px-2 py-2 font-mono tabular-nums">{row.premiumOutlay === null ? '—' : premiumCurrency(row.premiumOutlay, locale)}</td>
                    <td className="px-2 py-2 font-mono tabular-nums">{row.weightedAverageInterestRate === null ? '—' : `${row.weightedAverageInterestRate.toFixed(2)}%`}</td>
                    <td className="px-2 py-2 font-mono tabular-nums">{row.loan === null ? '—' : currency(row.loan, locale)}</td>
                    <td className="px-2 py-2 font-mono tabular-nums">{row.annualIncome === null ? '—' : currency(row.annualIncome, locale)}</td>
                    <td className="px-2 py-2 font-mono tabular-nums">{row.accumulatedValue === null ? '—' : currency(row.accumulatedValue, locale)}</td>
                    <td className="px-2 py-2 font-mono tabular-nums">{row.cashSurrenderValue === null ? '—' : currency(row.cashSurrenderValue, locale)}</td>
                    <td className="px-2 py-2 font-mono tabular-nums">{row.netDeathBenefit === null ? '—' : currency(row.netDeathBenefit, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {foresightResult && (
        <section className="mt-6 overflow-hidden rounded-[1.35rem] border border-teal/25 bg-paper shadow-[0_18px_48px_rgba(15,29,19,0.045)]">
          <div className="border-b border-border-steel px-5 py-4 sm:px-6">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-teal">{copy('Conferência oficial', 'Official verification')}</p>
            <h2 className="mt-1 text-lg font-semibold tracking-[-0.025em] text-ink">{copy('Seu pedido e o resultado da National Life', 'Your request and the National Life result')}</h2>
            <p className="mt-1 text-xs leading-5 text-ink-muted">{copy('Os valores confirmados abaixo vêm do Foresight e do PDF oficial, não de uma estimativa da Keepr One.', 'The confirmed values below come from Foresight and the official PDF, not from a Keepr One estimate.')}</p>
          </div>
          <div className="grid md:grid-cols-2">
            <div className="border-b border-border-steel p-5 md:border-b-0 md:border-r sm:p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-muted">{copy('Pedido do agente', 'Agent request')}</p>
              <p className="mt-3 text-xl font-semibold text-ink">
                {foresightResult.solveBasis === 'PREMIUM'
                  ? copy('Prêmio mensal solicitado: {amount}', 'Requested monthly premium: {amount}', { amount: premiumCurrency(foresightResult.requestedAmount, locale) })
                  : copy('{amount} de capital segurado', '{amount} face amount', { amount: currency(foresightResult.requestedAmount, locale) })}
              </p>
              <p className="mt-1 text-xs text-ink-muted">{copy('Valor enviado ao Foresight para cálculo.', 'Amount sent to Foresight for calculation.')}</p>
              {termDurationResult && (
                <p className="mt-2 text-xs font-semibold text-ink">
                  {copy(
                    'Prazo solicitado: {duration}',
                    'Requested duration: {duration}',
                    { duration: termDurationResult.requestedTermDuration },
                  )}
                </p>
              )}
            </div>
            <div className="bg-teal-pale/35 p-5 sm:p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.1em] text-teal-deep">{copy('Confirmação da National Life', 'National Life confirmation')}</p>
              <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
                <p className="text-xl font-semibold text-ink">{copy('{amount} por mês', '{amount} per month', { amount: premiumCurrency(foresightResult.confirmedMonthlyPremium, locale) })}</p>
                <p className="text-sm font-semibold text-ink">{copy('{amount} por ano', '{amount} per year', { amount: premiumCurrency(foresightResult.confirmedAnnualPremium, locale) })}</p>
              </div>
              <p className="mt-2 text-xs text-ink-muted">{copy('Capital segurado confirmado: {amount}', 'Confirmed face amount: {amount}', { amount: currency(foresightResult.confirmedFaceAmount, locale) })}</p>
              {termDurationResult && (
                <p className="mt-1 text-xs font-semibold text-teal-deep">
                  {copy(
                    'Prazo confirmado: {duration}',
                    'Confirmed duration: {duration}',
                    { duration: termDurationResult.confirmedTermDuration },
                  )}
                </p>
              )}
            </div>
          </div>
        </section>
      )}

      <div className="mt-8 grid gap-5 md:grid-cols-2">
        <section className="module-main-surface">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-teal">{copy('Segurado', 'Insured')}</p>
          <dl className="mt-3">
            <Fact label={copy('Nome', 'Name')} value={illustration.insuredName} />
            <Fact label={copy('Nascimento', 'Date of birth')} value={illustration.insuredDateOfBirth ? day(illustration.insuredDateOfBirth, locale) : null} />
          </dl>
        </section>
        <section className="module-main-surface">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-teal">
            {foresightResult ? copy('Resultado confirmado pela National', 'Result confirmed by National Life') : copy('Instruções enviadas', 'Submitted instructions')}
          </p>
          <dl className="mt-3">
            <Fact label={copy('Produto', 'Product')} value={flexLifeProductLabel(illustration.productName)} />
            {termDurationResult && (
              <Fact label={copy('Prazo solicitado', 'Requested duration')} value={termDurationResult.requestedTermDuration} />
            )}
            {termDurationResult && foresightResult && (
              <Fact
                label={copy('Prazo confirmado pela National Life', 'Duration confirmed by National Life')}
                value={termDurationResult.confirmedTermDuration}
              />
            )}
            <Fact label={copy('Capital segurado', 'Face amount')} value={illustration.faceAmount ? currency(Number(illustration.faceAmount), locale) : null} />
            <Fact label={hasCarrierPremium ? copy('Prêmio mensal confirmado', 'Confirmed monthly premium') : copy('Prêmio mensal informado', 'Entered monthly premium')} value={premiumValue ? premiumCurrency(Number(premiumValue), locale) : null} />
            {foresightResult && (
              <Fact
                label={isTermProduct
                  ? copy('Total anual no modo mensal', 'Annual total in monthly mode')
                  : copy('Prêmio anual confirmado', 'Confirmed annual premium')}
                value={premiumCurrency(foresightResult.confirmedAnnualPremium, locale)}
              />
            )}
            <Fact label={copy('Origem do prêmio', 'Premium source')} value={
              hasCarrierPremium
                ? copy('Confirmado no Foresight com o PDF oficial', 'Confirmed in Foresight with the official PDF')
                : illustration.targetPremiumSource === 'AGENT_INPUT_FOR_FORESIGHT'
                  ? copy('Informado pelo agente para a ilustração', 'Entered by the agent for the illustration')
                  : illustration.targetPremiumSource === 'FORESIGHT_CALCULATES_PREMIUM_FROM_DEATH_BENEFIT'
                    ? copy('Será calculado pela National Life', 'Will be calculated by National Life')
                    : null
            } />
          </dl>
          {carrierAdjustedPremium && foresightResult && (
            <p className="mt-4 rounded-xl border border-gold/35 bg-gold/10 px-4 py-3 text-xs leading-5 text-ink">
              {copy(
                'Você informou {requested} por mês. A National Life confirmou {monthly} por mês e {annual} por ano no PDF oficial.',
                'You entered {requested} per month. National Life confirmed {monthly} per month and {annual} per year in the official PDF.',
                {
                  requested: premiumCurrency(foresightResult.requestedAmount, locale),
                  monthly: premiumCurrency(foresightResult.confirmedMonthlyPremium, locale),
                  annual: premiumCurrency(foresightResult.confirmedAnnualPremium, locale),
                },
              )}
            </p>
          )}
          {carrierAdjustedFace && foresightResult && (
            <p className="mt-4 rounded-xl border border-gold/35 bg-gold/10 px-4 py-3 text-xs leading-5 text-ink">
              {copy(
                'Você informou {requested} de capital segurado. A National Life confirmou {confirmed} no PDF oficial.',
                'You entered a face amount of {requested}. National Life confirmed {confirmed} in the official PDF.',
                {
                  requested: currency(foresightResult.requestedAmount, locale),
                  confirmed: currency(foresightResult.confirmedFaceAmount, locale),
                },
              )}
            </p>
          )}
          {termDurationResult?.adjusted && (
            <p className="mt-4 rounded-xl border border-gold/35 bg-gold/10 px-4 py-3 text-xs leading-5 text-ink">
              {copy(
                'Você solicitou {requested}. A National Life confirmou {confirmed}; este é o prazo usado no PDF oficial e na Application.',
                'You requested {requested}. National Life confirmed {confirmed}; this is the duration used in the official PDF and the application.',
                {
                  requested: termDurationResult.requestedTermDuration,
                  confirmed: termDurationResult.confirmedTermDuration,
                },
              )}
            </p>
          )}
        </section>
        {foresightSnapshot && (
          <section className="module-main-surface md:col-span-2">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-teal">{copy('Parâmetros do Foresight', 'Foresight parameters')}</p>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-muted">
              {copy('Cliente, capital, prêmio, opção de benefício, alocação, riders e relatório são conferidos no Foresight antes de salvar o caso.', 'Client, face amount, premium, benefit option, allocation, riders, and report are checked in Foresight before the case is saved.')}
            </p>
            <dl className="mt-3 grid gap-x-6 md:grid-cols-2 xl:grid-cols-3">
              <Fact label={copy('Estado de emissão', 'Issue state')} value={foresightSnapshot.insured.issueState} />
              <Fact
                label={copy('Perfil de risco', 'Risk profile')}
                value={`${foresightSnapshot.underwriting.gender === 'Female' ? copy('Feminino', 'Female') : copy('Masculino', 'Male')} • ${
                  foresightSnapshot.underwriting.rateClass === 'Standard_NT' ? copy('Standard não-tabagista', 'Standard non-tobacco') : copy('Standard tabagista', 'Standard tobacco')
                }`}
              />
              <Fact
                label={copy('Benefício por morte', 'Death benefit')}
                value={foresightSnapshot.deathBenefitOption === 'A_Level' ? copy('A — nivelado', 'A — level') : copy('B — crescente', 'B — increasing')}
              />
            {foresightSnapshot.schemaVersion === 2 ? (
                <>
                  <Fact
                    label={copy('Estratégia da ilustração', 'Illustration strategy')}
                    value={strategyLabel(foresightSnapshot.solve.method, copy)}
                  />
                  <Fact
                    label={foresightSnapshot.solve.basis === 'PREMIUM' ? copy('Aporte mensal informado', 'Entered monthly contribution') : copy('Capital segurado informado', 'Entered face amount')}
                    value={foresightSnapshot.solve.basis === 'PREMIUM'
                      ? premiumCurrency(foresightSnapshot.solve.amount, locale)
                      : currency(foresightSnapshot.solve.amount, locale)}
                  />
                  {quickReview && <Fact label="Target Premium" value={premiumCurrency(quickReview.summary.targetPremium, locale)} />}
                </>
              ) : (
                <>
                  <Fact label={copy('Modo e tipo de prêmio', 'Premium mode and type')} value={copy('Mensal • Specify Amount', 'Monthly • Specify Amount')} />
                  <Fact label={copy('Configuração padrão', 'Default configuration')} value={copy('Sem solve, sem 1035 exchange e sem distribuição', 'No solve, no 1035 exchange, and no distribution')} />
                </>
              )}
              <Fact label={copy('Estratégia de índice', 'Index strategy')} value={copy('S&P 500 — foco em teto (100%)', 'S&P 500 — cap focus (100%)')} />
            </dl>
          </section>
        )}
      </div>

      <p className="mt-5 text-xs leading-5 text-ink-muted">
        {copy(
          'Pedido criado em {date}. Nenhum valor é apresentado como cálculo da National Life antes da conferência do PDF oficial.',
          'Request created on {date}. No value is presented as a National Life calculation before the official PDF is verified.',
          { date: instant(illustration.createdAt, locale) },
        )}
      </p>
    </Shell>
  )
}
