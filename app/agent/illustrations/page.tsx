export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { getCurrentAgent } from '@/lib/agent-context'
import { getIllustrationCommandStatuses } from '@/lib/national-life/illustration-command-status'
import { illustrationPdfMessage } from '@/lib/national-life/illustration-pdf-status'
import { flexLifeProductLabel } from '@/lib/national-life/flex-life'
import { IllustrationPdfButton } from './IllustrationPdfButton'
import { getNationalLifeLocalConnectorConfig } from '@/lib/national-life/local-connector/config'
import { Shell } from '@/components/Shell'
import { PageHeader } from '@/components/PageHeader'
import { Table, Thead, Th, Tr, Td, TdNum, EmptyState } from '@/components/Table'
import { getServerI18n } from '@/lib/i18n/server'
import { localeFor } from '@/lib/i18n/config'
import { KBotAvatar } from '@/components/kbot/KBotAvatar'
import { StartApplicationFromIllustrationButton } from './StartApplicationFromIllustrationButton'
import {
  parseIllustrationDirectoryFilters,
  readIllustrationDirectory,
  type IllustrationDirectoryFilters,
} from '@/lib/national-life/illustration-directory'

const currency = (value: number, locale: string) =>
  new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value)

function illustrationHref(
  filters: IllustrationDirectoryFilters,
  intent: string | undefined,
  page = filters.page,
) {
  const params = new URLSearchParams()
  if (intent === 'application') params.set('intent', 'application')
  if (filters.query) params.set('q', filters.query)
  if (filters.document) params.set('document', filters.document)
  if (filters.sort !== 'recent') params.set('sort', filters.sort)
  if (page > 1) params.set('page', String(page))
  const query = params.toString()
  return query ? `/agent/illustrations?${query}` : '/agent/illustrations'
}

export default async function IllustrationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { copy, language } = await getServerI18n()
  const locale = localeFor(language)
  const params = await searchParams
  const intent = Array.isArray(params.intent) ? params.intent[0] : params.intent
  const applicationIntent = intent === 'application'
  const agent = await getCurrentAgent()
  const localConnector = getNationalLifeLocalConnectorConfig()
  const filters = parseIllustrationDirectoryFilters(params)
  const [user, directory] = await Promise.all([
    prisma.user.findUnique({ where: { id: agent.userId } }),
    readIllustrationDirectory(prisma, agent.id, filters),
  ])
  const pdfStatus = await getIllustrationCommandStatuses(agent.id, directory.items.map((illustration) => illustration.id))
  const instant = (value: Date) => new Intl.DateTimeFormat(locale, { dateStyle: 'short' }).format(value)
  const pdfMessage = (status: Parameters<typeof illustrationPdfMessage>[0]) => {
    if (language === 'PT') return illustrationPdfMessage(status)
    if (status.state === 'WORKING') {
      return 'K-Bot is doing in Foresight what you would do: entering the scenario, waiting for the calculation, and preparing the PDF. Typical estimate: 2–5 minutes.'
    }
    if (status.state === 'BLOCKED') {
      return 'K-Bot is waiting for you to sign in to National Life before continuing the same request.'
    }
    if (status.state === 'WAITING_FOR_KBOT') {
      return 'K-Bot is waiting to connect on this computer before starting the same request.'
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
        return copy('Não foi possível gerar ({code}).', 'The PDF could not be generated ({code}).', { code: status.safeErrorCode })
    }
  }

  return (
    <Shell role="AGENT" userName={user?.name ?? ''}>
      <PageHeader
        title={copy("Ilustrações", "Illustrations")}
        eyebrow={copy("Pré-venda", "Pre-sale")}
        description={copy("Crie o cenário, acompanhe o Foresight em segundo plano e guarde o PDF oficial no histórico do segurado.", "Create the scenario, follow Foresight in the background, and keep the official PDF in the insured's history.")}
      >
        <Link
          href="/agent/illustrations/new"
          className="inline-flex items-center border border-white/15 px-4 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-white/[0.06]"
        >
          {copy("Nova ilustração", "New illustration")}
        </Link>
      </PageHeader>

      {applicationIntent ? (
        <section className="mb-5 flex flex-col gap-4 rounded-xl border border-border-steel bg-paper p-4 sm:flex-row sm:items-center">
          <KBotAvatar state="idle" size="sm" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-teal-deep">K-Bot · iGO Application</p>
            <h2 className="mt-1 text-base font-semibold text-ink">
              {copy('Escolha a ilustração que originará a proposta.', 'Choose the illustration that will start the application.')}
            </h2>
            <p className="mt-1 max-w-3xl text-sm leading-5 text-ink-muted">
              {copy(
                'Use uma ilustração com PDF oficial. Produto, prazo, capital e prêmio confirmados serão vinculados automaticamente ao novo dossiê.',
                'Use an illustration with an official PDF. The confirmed product, duration, face amount, and premium will be linked to the new case automatically.',
              )}
            </p>
          </div>
          <Link
            href="/agent/illustrations/new"
            className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-md border border-border-steel bg-paper px-4 py-2 text-sm font-semibold text-teal-deep transition-colors hover:border-teal hover:bg-teal-pale"
          >
            {copy('Nova ilustração', 'New illustration')}
          </Link>
        </section>
      ) : null}

      <section className="mb-5 rounded-xl border border-border-steel bg-paper p-4" aria-label={copy('Filtros de ilustrações', 'Illustration filters')}>
        <form action="/agent/illustrations" method="get" className="grid gap-3 md:grid-cols-4">
          {applicationIntent && <input type="hidden" name="intent" value="application" />}
          <label className="grid gap-1 text-sm text-ink-muted">
            <span>{copy('Buscar segurado, cliente ou produto', 'Search insured, client, or product')}</span>
            <input name="q" type="search" defaultValue={directory.filters.query} className="min-h-11 rounded-md border border-border-steel bg-paper px-3 text-ink" />
          </label>
          <label className="grid gap-1 text-sm text-ink-muted">
            <span>{copy('Documento', 'Document')}</span>
            <select name="document" defaultValue={directory.filters.document ?? ''} className="min-h-11 rounded-md border border-border-steel bg-paper px-3 text-ink">
              <option value="">{copy('Todos', 'All')}</option>
              <option value="ready">{copy('PDF disponível', 'PDF available')}</option>
              <option value="pending">{copy('PDF pendente', 'PDF pending')}</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm text-ink-muted">
            <span>{copy('Ordenar', 'Sort')}</span>
            <select name="sort" defaultValue={directory.filters.sort} className="min-h-11 rounded-md border border-border-steel bg-paper px-3 text-ink">
              <option value="recent">{copy('Mais recentes', 'Most recent')}</option>
              <option value="oldest">{copy('Mais antigas', 'Oldest')}</option>
            </select>
          </label>
          <div className="flex items-end gap-3">
            <button type="submit" className="min-h-11 rounded-md bg-rail-strong px-4 text-sm font-semibold text-paper">{copy('Aplicar', 'Apply')}</button>
            {(directory.filters.query || directory.filters.document || directory.filters.sort !== 'recent') && <Link href={illustrationHref({ query: '', document: null, sort: 'recent', page: 1 }, intent)} className="text-sm font-semibold text-teal">{copy('Limpar', 'Clear')}</Link>}
          </div>
        </form>
        <p className="mt-3 text-xs text-ink-muted" role="status">
          {copy('{total} ilustrações · {ready} com PDF oficial', '{total} illustrations · {ready} with official PDF', { total: directory.total, ready: directory.summary.ready })}
        </p>
      </section>

      <section className="module-main-surface">
        <Table>
          <Thead>
            <tr>
              <Th>{copy("Data", "Date")}</Th>
              <Th>{copy("Segurado", "Insured")}</Th>
              <Th>{copy("Cliente", "Client")}</Th>
              <Th>{copy("Produto", "Product")}</Th>
              <Th className="text-right">{copy("Capital segurado", "Face amount")}</Th>
              <Th className="text-right">{copy("Prêmio mensal", "Monthly premium")}</Th>
              <Th>{copy("Documento", "Document")}</Th>
              <Th>{copy('Proposta', 'Application')}</Th>
            </tr>
          </Thead>
          <tbody>
            {directory.items.map((illustration) => {
              const status = pdfStatus.get(illustration.id)
              const hasCarrierPremium = Boolean(illustration.documentFetchedAt && illustration.premium)
              const premium = hasCarrierPremium ? illustration.premium : illustration.targetPremium
              const canStartApplication = Boolean(
                illustration.documentFetchedAt &&
                illustration.documentMimeType === 'application/pdf' &&
                illustration.faceAmount &&
                illustration.premium,
              )
              return (
              <Tr key={illustration.id}>
                <Td>{instant(illustration.createdAt)}</Td>
                <Td>
                  <Link
                    href={`/agent/illustrations/${illustration.id}${applicationIntent ? '?intent=application' : ''}`}
                    className="text-teal hover:text-teal-deep"
                  >
                    {illustration.insuredName ?? '—'}
                  </Link>
                  <span className="mt-0.5 block text-xs text-ink-muted">Foresight · {flexLifeProductLabel(illustration.productName)}</span>
                </Td>
                <Td>
                  {illustration.client ? (
                    <Link
                      href={`/agent/clients/${illustration.client.id}`}
                      className="text-teal hover:text-teal-deep"
                    >
                      {illustration.client.name}
                    </Link>
                  ) : (
                    <span className="text-ink-muted">{copy("Prospect", "Prospect")}</span>
                  )}
                </Td>
                <Td>
                  <span className="block">{illustration.productName ?? '—'}</span>
                  {flexLifeProductLabel(illustration.productName) === 'FlexLife' ? (
                    <span className="mt-0.5 block text-xs text-ink-muted">{copy("S&P 500 · foco em teto", "S&P 500 · cap focus")}</span>
                  ) : null}
                </Td>
                <TdNum>
                  {illustration.faceAmount ? currency(Number(illustration.faceAmount), locale) : '—'}
                </TdNum>
                <TdNum>
                  {premium ? currency(Number(premium), locale) : '—'}
                  <span className="mt-0.5 block text-xs font-normal text-ink-muted">
                    {hasCarrierPremium
                      ? copy('confirmado no Foresight', 'confirmed in Foresight')
                      : illustration.targetPremiumSource === 'AGENT_INPUT_FOR_FORESIGHT'
                        ? copy('para a ilustração', 'for the illustration')
                        : illustration.targetPremiumSource === 'FORESIGHT_CALCULATES_PREMIUM_FROM_DEATH_BENEFIT'
                          ? copy('a calcular pela National Life', 'to be calculated by National Life')
                          : null}
                  </span>
                </TdNum>
                <Td>
                  {illustration.documentFetchedAt ? (
                    // A condição do carrier vale igual aqui: é o PDF que o
                    // agente lê, não o que ele entrega ao cliente.
                    <a
                      href={`/api/illustrations/${illustration.id}/document`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-teal hover:text-teal-deep"
                    >
                      {copy("Abrir PDF", "Open PDF")}
                    </a>
                  ) : (
                    <>
                      <IllustrationPdfButton
                        illustrationId={illustration.id}
                        extensionId={localConnector.enabled ? localConnector.extensionTarget : undefined}
                        disabled={status?.state === 'WORKING'}
                        status={status?.state}
                        safeErrorCode={status?.state === 'FAILED'
                          ? status.safeErrorCode
                          : undefined}
                      />
                      {/* Without this the row went silent after "pedido
                          enviado": a render that failed looked exactly like one
                          still running. The carrier's illustration tool has its
                          own login and it expires early, so the common failure
                          is not a broken quote — it is "connect again". */}
                      {status && (
                        <p className="mt-1 text-xs text-ink-muted">
                          {pdfMessage(status)}
                        </p>
                      )}
                    </>
                  )}
                </Td>
                <Td>
                  {canStartApplication ? (
                    <StartApplicationFromIllustrationButton illustrationId={illustration.id} compact />
                  ) : (
                    <span className="text-xs leading-5 text-ink-muted">
                      {copy('Disponível após o PDF oficial', 'Available after the official PDF')}
                    </span>
                  )}
                </Td>
              </Tr>
              )
            })}
          </tbody>
        </Table>

        {directory.total === 0 && (
            <EmptyState>{copy("Nenhuma ilustração oficial pedida ainda.", "No official illustrations have been requested yet.")}</EmptyState>
        )}
        {directory.pageCount > 1 && (
          <nav aria-label={copy('Paginação das ilustrações', 'Illustration pagination')} className="mt-4 flex items-center justify-between gap-3 border-t border-border-steel pt-4">
            {directory.page > 1 ? <Link href={illustrationHref(directory.filters, intent, directory.page - 1)}>{copy('Anterior', 'Previous')}</Link> : <span />}
            <span className="font-mono text-xs text-ink-muted">
              {copy('Página {page} de {pages}', 'Page {page} of {pages}', { page: directory.page, pages: directory.pageCount })}
            </span>
            {directory.page < directory.pageCount ? <Link href={illustrationHref(directory.filters, intent, directory.page + 1)}>{copy('Próxima', 'Next')}</Link> : <span />}
          </nav>
        )}
      </section>
    </Shell>
  )
}
