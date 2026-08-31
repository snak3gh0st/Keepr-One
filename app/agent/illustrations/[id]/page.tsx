export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentAgent } from '@/lib/agent-context'
import { flexLifeProductLabel } from '@/lib/national-life/flex-life'
import { buildForesightIllustrationSnapshot } from '@/lib/national-life/foresight-illustration-contract'
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
  if (!rawPayload || typeof rawPayload !== 'object' || Array.isArray(rawPayload) ||
    !('foresightResult' in rawPayload)) return null
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

const day = (value: Date, locale: string) =>
  new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeZone: 'UTC' }).format(value)

const instant = (value: Date, locale: string) =>
  new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(value)

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
  const commandStatus = (await getIllustrationCommandStatuses(agent.id)).get(illustration.id)
  const documentReady = illustration.documentFetchedAt && illustration.documentMimeType === 'application/pdf'
  const foresightResult = documentReady ? foresightResultFrom(illustration.rawPayload) : null
  const hasCarrierPremium = Boolean(documentReady && illustration.premium)
  const premiumValue = hasCarrierPremium ? illustration.premium : illustration.targetPremium
  const carrierAdjustedPremium = foresightResult?.solveBasis === 'PREMIUM' &&
    Math.abs(foresightResult.requestedAmount - foresightResult.confirmedMonthlyPremium) > 0.005
  const carrierAdjustedFace = foresightResult?.solveBasis === 'DEATH_BENEFIT' &&
    Math.abs(foresightResult.requestedAmount - foresightResult.confirmedFaceAmount) > 0.005
  const deliveryPt = describeIllustrationDelivery({ documentReady: Boolean(documentReady), status: commandStatus })
  const delivery = language === 'PT'
    ? deliveryPt
    : documentReady
      ? { eyebrow: 'Document ready', title: 'Official PDF verified', detail: 'The file was received from Foresight and verified before becoming available here.' }
      : commandStatus?.state === 'BLOCKED'
        ? { eyebrow: 'K-Bot · action required', title: 'Connect National Life to continue', detail: 'The browser session expired. After you sign in, K-Bot resumes the same request.' }
        : commandStatus?.state === 'WORKING'
          ? { eyebrow: 'K-Bot at work', title: 'K-Bot is generating the official illustration', detail: 'K-Bot is filling in the case, checking the National Life calculation, and preparing the PDF. Typical estimate: 2–5 minutes; you can keep working.' }
          : commandStatus?.state === 'FAILED'
            ? { eyebrow: 'Review required', title: 'Foresight did not accept this scenario', detail: copy(illustrationPdfMessage(commandStatus), 'Foresight could not complete this scenario. Review the source amount and generate a new illustration; no PDF was issued.') }
            : { eyebrow: 'Request prepared', title: 'Ready to send to Foresight', detail: 'Review the instructions below and start official generation when you are ready.' }
  const isGenerating = commandStatus?.state === 'WORKING'
  const foresightStep = documentReady
    ? copy('Caso salvo', 'Case saved')
    : commandStatus?.state === 'BLOCKED'
      ? copy('Aguardando login', 'Waiting for sign-in')
      : commandStatus?.state === 'FAILED'
        ? copy('Revisão do cenário necessária', 'Scenario review required')
        : commandStatus?.state === 'WORKING'
          ? copy('Preenchendo, calculando e emitindo', 'Filling in, calculating, and issuing')
          : copy('Aguardando início', 'Waiting to start')
  const commandMessage = commandStatus
    ? language === 'PT' ? illustrationPdfMessage(commandStatus) : delivery.detail
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

      <section className="relative overflow-hidden rounded-[1.55rem] border border-border-steel bg-paper p-5 shadow-[0_20px_58px_rgba(15,29,19,0.058)] sm:p-7" aria-live={documentReady ? 'off' : 'polite'}>
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
            <a
              href={`/api/illustrations/${illustration.id}/document`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center justify-center rounded-full bg-rail-strong px-5 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-rail"
            >
              {copy('Abrir PDF oficial da National Life', 'Open official National Life PDF')}
            </a>
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
            ['K-Bot no Foresight', foresightStep, documentReady ? 'complete' : commandStatus?.state === 'WORKING' || commandStatus?.state === 'BLOCKED' ? 'current' : 'waiting'],
            [copy('PDF oficial', 'Official PDF'), documentReady ? copy('Recebido e verificado', 'Received and verified') : copy('Aguardando a National Life', 'Waiting for National Life'), documentReady ? 'complete' : 'waiting'],
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
        {!documentReady && commandStatus && (
          <p className="relative mt-4 border-l-2 border-teal pl-3 text-xs leading-5 text-ink-muted">{commandMessage}</p>
        )}
      </section>

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
            </div>
            <div className="bg-teal-pale/35 p-5 sm:p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.1em] text-teal-deep">{copy('Confirmação da National Life', 'National Life confirmation')}</p>
              <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
                <p className="text-xl font-semibold text-ink">{copy('{amount} por mês', '{amount} per month', { amount: premiumCurrency(foresightResult.confirmedMonthlyPremium, locale) })}</p>
                <p className="text-sm font-semibold text-ink">{copy('{amount} por ano', '{amount} per year', { amount: premiumCurrency(foresightResult.confirmedAnnualPremium, locale) })}</p>
              </div>
              <p className="mt-2 text-xs text-ink-muted">{copy('Capital segurado confirmado: {amount}', 'Confirmed face amount: {amount}', { amount: currency(foresightResult.confirmedFaceAmount, locale) })}</p>
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
            <Fact label={copy('Capital segurado', 'Face amount')} value={illustration.faceAmount ? currency(Number(illustration.faceAmount), locale) : null} />
            <Fact label={hasCarrierPremium ? copy('Prêmio mensal confirmado', 'Confirmed monthly premium') : copy('Prêmio mensal informado', 'Entered monthly premium')} value={premiumValue ? premiumCurrency(Number(premiumValue), locale) : null} />
            {foresightResult && (
              <Fact label={copy('Prêmio anual confirmado', 'Confirmed annual premium')} value={premiumCurrency(foresightResult.confirmedAnnualPremium, locale)} />
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
                    label={copy('Base de cálculo', 'Solve basis')}
                    value={foresightSnapshot.solve.basis === 'PREMIUM'
                      ? copy('Resolvido pelo prêmio mensal', 'Solved by monthly premium')
                      : copy('Resolvido pelo capital segurado', 'Solved by face amount')}
                  />
                  <Fact label={copy('Método Foresight', 'Foresight method')} value={foresightSnapshot.solve.method.replaceAll('_', ' ')} />
                  <Fact
                    label={copy('Valor de origem', 'Source amount')}
                    value={currency(foresightSnapshot.solve.amount, locale)}
                  />
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
          'Pedido criado em {date}. Nenhum valor é apresentado como cálculo da National Life antes do PDF oficial.',
          'Request created on {date}. No value is presented as a National Life calculation before the official PDF.',
          { date: instant(illustration.createdAt, locale) },
        )}
      </p>
    </Shell>
  )
}
