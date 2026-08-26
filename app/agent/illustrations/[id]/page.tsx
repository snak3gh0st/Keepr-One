export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentAgent } from '@/lib/agent-context'
import { formatCarrierInstant } from '@/lib/national-life/carrier-instant'
import { flexLifeProductLabel } from '@/lib/national-life/flex-life'
import { IllustrationPdfButton } from '../IllustrationPdfButton'
import { getNationalLifeLocalConnectorConfig } from '@/lib/national-life/local-connector/config'
import { getIllustrationCommandStatuses } from '@/lib/national-life/illustration-command-status'
import { illustrationPdfMessage } from '@/lib/national-life/illustration-pdf-status'
import { Shell } from '@/components/Shell'
import { PageHeader } from '@/components/PageHeader'

const currency = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
  }).format(value)

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
      productName: true, faceAmount: true, targetPremium: true, targetPremiumSource: true,
      documentFetchedAt: true, documentMimeType: true,
    },
  })
  if (!illustration) notFound()
  const commandStatus = (await getIllustrationCommandStatuses(agent.id)).get(illustration.id)

  return (
    <Shell role="AGENT" userName={user?.name ?? ''}>
      <PageHeader
        title="Ilustração FlexLife"
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

      <div className="grid gap-8 md:grid-cols-2">
        <section>
          <h2 className="text-sm font-semibold text-paper">Segurado</h2>
          <dl>
            <Fact label="Nome" value={illustration.insuredName} />
            <Fact
              label="Nascimento"
              value={illustration.insuredDateOfBirth ? day(illustration.insuredDateOfBirth) : null}
            />
          </dl>
        </section>
        <section>
          <h2 className="text-sm font-semibold text-paper">Instruções enviadas ao Foresight</h2>
          <dl>
            <Fact label="Produto" value={flexLifeProductLabel(illustration.productName)} />
            <Fact
              label="Capital segurado"
              value={illustration.faceAmount ? currency(Number(illustration.faceAmount)) : null}
            />
            <Fact
              label="Prêmio mensal informado"
              value={illustration.targetPremium ? currency(Number(illustration.targetPremium)) : null}
            />
            <Fact
              label="Origem do prêmio"
              value={illustration.targetPremiumSource === 'AGENT_INPUT_FOR_FORESIGHT'
                ? 'Informado pelo agente para a ilustração' : null}
            />
          </dl>
        </section>
      </div>

      <section className="mt-10 border-t border-white/10 pt-6 text-sm text-ink-muted">
        <p>
          Pedido criado em {formatCarrierInstant(illustration.createdAt)}. O PDF é disponibilizado
          somente depois que o Foresight salva o caso e a extensão confirma a integridade do arquivo.
        </p>
        <div className="mt-3">
          {illustration.documentFetchedAt && illustration.documentMimeType === 'application/pdf' ? (
            <a
              href={`/api/illustrations/${illustration.id}/document`}
              target="_blank"
              rel="noreferrer"
              className="text-teal hover:text-teal-deep"
            >
              Abrir PDF oficial da National Life
            </a>
          ) : (
            <IllustrationPdfButton
              illustrationId={illustration.id}
              extensionId={localConnector.enabled ? localConnector.extensionId : undefined}
              disabled={commandStatus?.state === 'WORKING'}
              status={commandStatus?.state}
            />
          )}
          {!illustration.documentFetchedAt && commandStatus && (
            <p className="mt-1 text-xs text-ink-muted">{illustrationPdfMessage(commandStatus)}</p>
          )}
        </div>
      </section>
    </Shell>
  )
}
