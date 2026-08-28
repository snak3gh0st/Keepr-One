export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentAgent } from '@/lib/agent-context'
import { formatCarrierInstant } from '@/lib/national-life/carrier-instant'
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

const currency = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
  }).format(value)

const premiumCurrency = (value: number) =>
  new Intl.NumberFormat('en-US', {
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

const day = (value: Date) =>
  new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'UTC' }).format(value)

function Fact({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="border-t border-white/10 py-3">
      <dt className="text-xs uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd className="mt-1 text-sm text-ink">{value ?? '—'}</dd>
    </div>
  )
}

export default async function IllustrationDetailPage({ params }: { params: Promise<{ id: string }> }) {
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
  const delivery = describeIllustrationDelivery({ documentReady: Boolean(documentReady), status: commandStatus })
  const isGenerating = commandStatus?.state === 'WORKING'
  const foresightStep = documentReady
    ? 'Caso salvo'
    : commandStatus?.state === 'BLOCKED'
      ? 'Aguardando login'
      : commandStatus?.state === 'FAILED'
        ? 'Revisão do cenário necessária'
        : commandStatus?.state === 'WORKING'
          ? 'Preenchendo, calculando e emitindo'
          : 'Aguardando início'

  return (
    <Shell role="AGENT" userName={user?.name ?? ''}>
      <PageHeader
        title={`Ilustração ${flexLifeProductLabel(illustration.productName)}`}
        eyebrow="Carteira"
        description="Pedido oficial preparado para o Foresight da National Life."
      >
        <Link
          href="/agent/illustrations"
          className="inline-flex items-center border border-white/15 px-4 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-white/[0.06]"
        >
          Voltar
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
              Abrir PDF oficial da National Life
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
        <ol className="relative mt-6 grid gap-3 border-t border-border-steel pt-5 sm:grid-cols-3" aria-label="Progresso da ilustração">
          {[
            ['Dados revisados', 'Cenário aprovado no Keepr One', 'complete'],
            ['K-Bot no Foresight', foresightStep, documentReady ? 'complete' : commandStatus?.state === 'WORKING' || commandStatus?.state === 'BLOCKED' ? 'current' : 'waiting'],
            ['PDF oficial', documentReady ? 'Recebido e verificado' : 'Aguardando a National Life', documentReady ? 'complete' : 'waiting'],
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
          <p className="relative mt-4 border-l-2 border-teal pl-3 text-xs leading-5 text-ink-muted">{illustrationPdfMessage(commandStatus)}</p>
        )}
      </section>

      {foresightResult && (
        <section className="mt-6 overflow-hidden rounded-[1.35rem] border border-teal/25 bg-paper shadow-[0_18px_48px_rgba(15,29,19,0.045)]">
          <div className="border-b border-border-steel px-5 py-4 sm:px-6">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-teal">Conferência oficial</p>
            <h2 className="mt-1 text-lg font-semibold tracking-[-0.025em] text-ink">Seu pedido e o resultado da National Life</h2>
            <p className="mt-1 text-xs leading-5 text-ink-muted">Os valores confirmados abaixo vêm do Foresight e do PDF oficial, não de uma estimativa do Keepr One.</p>
          </div>
          <div className="grid md:grid-cols-2">
            <div className="border-b border-border-steel p-5 md:border-b-0 md:border-r sm:p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-muted">Pedido do agente</p>
              <p className="mt-3 text-xl font-semibold text-ink">
                {foresightResult.solveBasis === 'PREMIUM'
                  ? `Prêmio mensal solicitado: ${premiumCurrency(foresightResult.requestedAmount)}`
                  : `${currency(foresightResult.requestedAmount)} de capital segurado`}
              </p>
              <p className="mt-1 text-xs text-ink-muted">Valor enviado ao Foresight para cálculo.</p>
            </div>
            <div className="bg-teal-pale/35 p-5 sm:p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.1em] text-teal-deep">Confirmação da National Life</p>
              <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
                <p className="text-xl font-semibold text-ink">{premiumCurrency(foresightResult.confirmedMonthlyPremium)} por mês</p>
                <p className="text-sm font-semibold text-ink">{premiumCurrency(foresightResult.confirmedAnnualPremium)} por ano</p>
              </div>
              <p className="mt-2 text-xs text-ink-muted">Capital segurado confirmado: {currency(foresightResult.confirmedFaceAmount)}</p>
            </div>
          </div>
        </section>
      )}

      <div className="mt-8 grid gap-5 md:grid-cols-2">
        <section className="module-main-surface">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-teal">Segurado</p>
          <dl className="mt-3">
            <Fact label="Nome" value={illustration.insuredName} />
            <Fact label="Nascimento" value={illustration.insuredDateOfBirth ? day(illustration.insuredDateOfBirth) : null} />
          </dl>
        </section>
        <section className="module-main-surface">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-teal">
            {foresightResult ? 'Resultado confirmado pela National' : 'Instruções enviadas'}
          </p>
          <dl className="mt-3">
            <Fact label="Produto" value={flexLifeProductLabel(illustration.productName)} />
            <Fact label="Capital segurado" value={illustration.faceAmount ? currency(Number(illustration.faceAmount)) : null} />
            <Fact label={hasCarrierPremium ? 'Prêmio mensal confirmado' : 'Prêmio mensal informado'} value={premiumValue ? premiumCurrency(Number(premiumValue)) : null} />
            {foresightResult && (
              <Fact label="Prêmio anual confirmado" value={premiumCurrency(foresightResult.confirmedAnnualPremium)} />
            )}
            <Fact label="Origem do prêmio" value={
              hasCarrierPremium
                ? 'Confirmado no Foresight com o PDF oficial'
                : illustration.targetPremiumSource === 'AGENT_INPUT_FOR_FORESIGHT'
                  ? 'Informado pelo agente para a ilustração'
                  : illustration.targetPremiumSource === 'FORESIGHT_CALCULATES_PREMIUM_FROM_DEATH_BENEFIT'
                    ? 'Será calculado pela National Life'
                    : null
            } />
          </dl>
          {carrierAdjustedPremium && foresightResult && (
            <p className="mt-4 rounded-xl border border-gold/35 bg-gold/10 px-4 py-3 text-xs leading-5 text-ink">
              Você informou {premiumCurrency(foresightResult.requestedAmount)} por mês. A National Life confirmou{' '}
              {premiumCurrency(foresightResult.confirmedMonthlyPremium)} por mês e{' '}
              {premiumCurrency(foresightResult.confirmedAnnualPremium)} por ano no PDF oficial.
            </p>
          )}
          {carrierAdjustedFace && foresightResult && (
            <p className="mt-4 rounded-xl border border-gold/35 bg-gold/10 px-4 py-3 text-xs leading-5 text-ink">
              Você informou {currency(foresightResult.requestedAmount)} de capital segurado. A National Life confirmou{' '}
              {currency(foresightResult.confirmedFaceAmount)} no PDF oficial.
            </p>
          )}
        </section>
        {foresightSnapshot && (
          <section className="module-main-surface md:col-span-2">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-teal">Parâmetros do Foresight</p>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-muted">
              Cliente, capital, prêmio, opção de benefício, alocação, riders e relatório são conferidos no Foresight antes de salvar o caso.
            </p>
            <dl className="mt-3 grid gap-x-6 md:grid-cols-2 xl:grid-cols-3">
              <Fact label="Estado de emissão" value={foresightSnapshot.insured.issueState} />
              <Fact
                label="Perfil de risco"
                value={`${foresightSnapshot.underwriting.gender === 'Female' ? 'Feminino' : 'Masculino'} • ${
                  foresightSnapshot.underwriting.rateClass === 'Standard_NT' ? 'Standard não-tabagista' : 'Standard tabagista'
                }`}
              />
              <Fact
                label="Benefício por morte"
                value={foresightSnapshot.deathBenefitOption === 'A_Level' ? 'A — nivelado' : 'B — crescente'}
              />
              {foresightSnapshot.schemaVersion === 2 ? (
                <>
                  <Fact
                    label="Base de cálculo"
                    value={foresightSnapshot.solve.basis === 'PREMIUM'
                      ? 'Resolvido pelo prêmio mensal'
                      : 'Resolvido pelo capital segurado'}
                  />
                  <Fact label="Método Foresight" value={foresightSnapshot.solve.method.replaceAll('_', ' ')} />
                  <Fact
                    label="Valor de origem"
                    value={currency(foresightSnapshot.solve.amount)}
                  />
                </>
              ) : (
                <>
                  <Fact label="Modo e tipo de prêmio" value="Mensal • Specify Amount" />
                  <Fact label="Configuração padrão" value="Sem solve, sem 1035 exchange e sem distribuição" />
                </>
              )}
              <Fact label="Estratégia de índice" value="S&P 500 — foco em teto (100%)" />
            </dl>
          </section>
        )}
      </div>

      <p className="mt-5 text-xs leading-5 text-ink-muted">
        Pedido criado em {formatCarrierInstant(illustration.createdAt)}. Nenhum valor é apresentado como cálculo da National Life antes do PDF oficial.
      </p>
    </Shell>
  )
}
