export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { getCurrentAgent } from '@/lib/agent-context'
import { getIllustrationCommandStatuses } from '@/lib/national-life/illustration-command-status'
import { illustrationPdfMessage } from '@/lib/national-life/illustration-pdf-status'
import { formatCarrierInstant } from '@/lib/national-life/carrier-instant'
import { IllustrationPdfButton } from './IllustrationPdfButton'
import { getNationalLifeLocalConnectorConfig } from '@/lib/national-life/local-connector/config'
import { Shell } from '@/components/Shell'
import { PageHeader } from '@/components/PageHeader'
import { Table, Thead, Th, Tr, Td, TdNum, EmptyState } from '@/components/Table'
import { KBotAvatar } from '@/components/kbot/KBotAvatar'
import { StartApplicationFromIllustrationButton } from './StartApplicationFromIllustrationButton'

const currency = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value)

export default async function IllustrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ intent?: string }>
}) {
  const { intent } = await searchParams
  const applicationIntent = intent === 'application'
  const agent = await getCurrentAgent()
  const localConnector = getNationalLifeLocalConnectorConfig()
  const [user, illustrations, pdfStatus] = await Promise.all([
    prisma.user.findUnique({ where: { id: agent.userId } }),
    // Scoped to the agent who asked for them. A quote names an insured and a
    // premium, and the only thing that says who may read it is who requested it.
    prisma.illustration.findMany({
      where: { agentId: agent.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        createdAt: true,
        insuredName: true,
        faceAmount: true,
        premium: true,
        targetPremium: true,
        targetPremiumSource: true,
        productName: true,
        documentFetchedAt: true,
        documentMimeType: true,
        client: { select: { id: true, name: true } },
      },
    }),
    // One query for the whole list, so every item can say where its render stands.
    getIllustrationCommandStatuses(agent.id),
  ])

  return (
    <Shell role="AGENT" userName={user?.name ?? ''}>
      <PageHeader
        title="Ilustrações"
        eyebrow="Pré-venda"
        description="Crie o cenário, acompanhe o Foresight em segundo plano e guarde o PDF oficial no histórico do segurado."
      >
        <Link
          href="/agent/illustrations/new"
          className="inline-flex items-center border border-white/15 px-4 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-white/[0.06]"
        >
          Nova ilustração
        </Link>
      </PageHeader>

      {applicationIntent ? (
        <section className="mb-5 flex flex-col gap-4 rounded-xl border border-border-steel bg-paper p-4 sm:flex-row sm:items-center">
          <KBotAvatar state="idle" size="sm" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-teal-deep">K-Bot · iGO Application</p>
            <h2 className="mt-1 text-base font-semibold text-ink">Escolha a Illustration que originará a Application.</h2>
            <p className="mt-1 max-w-3xl text-sm leading-5 text-ink-muted">
              Use uma Illustration com PDF oficial. Produto, prazo, capital e prêmio confirmados serão vinculados automaticamente ao novo dossiê.
            </p>
          </div>
          <Link
            href="/agent/illustrations/new"
            className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-md border border-border-steel bg-paper px-4 py-2 text-sm font-semibold text-teal-deep transition-colors hover:border-teal hover:bg-teal-pale"
          >
            Nova Illustration
          </Link>
        </section>
      ) : null}

      <section className="module-main-surface">
        <Table>
          <Thead>
            <tr>
              <Th>Data</Th>
              <Th>Segurado</Th>
              <Th>Cliente</Th>
              <Th>Produto</Th>
              <Th className="text-right">Capital segurado</Th>
              <Th className="text-right">Prêmio mensal</Th>
              <Th>Documento</Th>
              <Th>Application</Th>
            </tr>
          </Thead>
          <tbody>
            {illustrations.map((illustration) => {
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
                <Td>{formatCarrierInstant(illustration.createdAt)}</Td>
                <Td>
                  <Link
                    href={`/agent/illustrations/${illustration.id}${applicationIntent ? '?intent=application' : ''}`}
                    className="text-teal hover:text-teal-deep"
                  >
                    {illustration.insuredName ?? '—'}
                  </Link>
                  <span className="mt-0.5 block text-xs text-ink-muted">Foresight · FlexLife</span>
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
                    <span className="text-ink-muted">Prospect</span>
                  )}
                </Td>
                <Td>
                  <span className="block">{illustration.productName ?? '—'}</span>
                  <span className="mt-0.5 block text-xs text-ink-muted">S&P 500 · foco em teto</span>
                </Td>
                <TdNum>
                  {illustration.faceAmount ? currency(Number(illustration.faceAmount)) : '—'}
                </TdNum>
                <TdNum>
                  {premium ? currency(Number(premium)) : '—'}
                  <span className="mt-0.5 block text-xs font-normal text-ink-muted">
                    {hasCarrierPremium
                      ? 'confirmado no Foresight'
                      : illustration.targetPremiumSource === 'AGENT_INPUT_FOR_FORESIGHT'
                        ? 'para a ilustração'
                        : illustration.targetPremiumSource === 'FORESIGHT_CALCULATES_PREMIUM_FROM_DEATH_BENEFIT'
                          ? 'a calcular pela National Life'
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
                      Abrir PDF
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
                          {illustrationPdfMessage(status)}
                        </p>
                      )}
                    </>
                  )}
                </Td>
                <Td>
                  {canStartApplication ? (
                    <StartApplicationFromIllustrationButton illustrationId={illustration.id} compact />
                  ) : (
                    <span className="text-xs leading-5 text-ink-muted">Disponível após o PDF oficial</span>
                  )}
                </Td>
              </Tr>
              )
            })}
          </tbody>
        </Table>

        {illustrations.length === 0 && (
            <EmptyState>Nenhuma ilustração oficial pedida ainda.</EmptyState>
        )}
      </section>
    </Shell>
  )
}
