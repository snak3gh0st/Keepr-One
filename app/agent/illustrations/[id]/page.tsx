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
  const documentReady = illustration.documentFetchedAt && illustration.documentMimeType === 'application/pdf'
  const delivery = documentReady
    ? {
        eyebrow: 'Documento pronto',
        title: 'PDF oficial verificado',
        detail: 'O arquivo foi recebido do Foresight e conferido antes de ficar disponível aqui.',
      }
    : commandStatus?.state === 'BLOCKED'
      ? {
          eyebrow: 'Ação necessária',
          title: 'Conecte a National Life para continuar',
          detail: 'A sessão do navegador expirou. Depois do login, a extensão retoma o mesmo pedido.',
        }
      : commandStatus?.state === 'WORKING'
        ? {
            eyebrow: 'Foresight em andamento',
            title: 'Gerando a ilustração oficial',
            detail: 'O caso está sendo salvo e o PDF será trazido automaticamente para esta página.',
          }
        : {
            eyebrow: 'Pedido preparado',
            title: 'Pronto para enviar ao Foresight',
            detail: 'Revise as instruções abaixo e inicie a geração oficial quando estiver pronto.',
          }

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

      <section className="relative overflow-hidden rounded-[1.55rem] border border-border-steel bg-paper p-5 shadow-[0_20px_58px_rgba(15,29,19,0.058)] sm:p-7" aria-live={documentReady ? 'off' : 'polite'}>
        <div className="absolute -right-12 -top-12 h-40 w-40 rounded-full border border-teal/15 shadow-[0_0_0_28px_rgba(31,128,86,0.035),0_0_0_56px_rgba(31,128,86,0.02)]" aria-hidden="true" />
        <div className="relative grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-teal">{delivery.eyebrow}</p>
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
              extensionId={localConnector.enabled ? localConnector.extensionId : undefined}
              disabled={commandStatus?.state === 'WORKING'}
              status={commandStatus?.state}
            />
          )}
        </div>
        <ol className="relative mt-6 grid gap-3 border-t border-border-steel pt-5 sm:grid-cols-3" aria-label="Progresso da ilustração">
          {[
            ['Dados revisados', 'Cenário FlexLife aprovado', true],
            ['Foresight', commandStatus?.state === 'BLOCKED' ? 'Aguardando login' : documentReady ? 'Caso salvo' : 'Em andamento', documentReady || commandStatus?.state === 'WORKING'],
            ['PDF oficial', documentReady ? 'Arquivo disponível' : 'Aguardando confirmação', documentReady],
          ].map(([title, detail, complete], index) => (
            <li key={title as string} className="flex items-start gap-3">
              <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-mono font-semibold ${complete ? 'bg-teal text-paper' : index === 1 && commandStatus?.state === 'BLOCKED' ? 'bg-gold text-ink' : 'bg-panel text-ink-muted'}`}>
                {complete ? '✓' : `0${index + 1}`}
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

      <div className="mt-8 grid gap-5 md:grid-cols-2">
        <section className="module-main-surface">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-teal">Segurado</p>
          <dl className="mt-3">
            <Fact label="Nome" value={illustration.insuredName} />
            <Fact label="Nascimento" value={illustration.insuredDateOfBirth ? day(illustration.insuredDateOfBirth) : null} />
          </dl>
        </section>
        <section className="module-main-surface">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-teal">Instruções enviadas</p>
          <dl className="mt-3">
            <Fact label="Produto" value={flexLifeProductLabel(illustration.productName)} />
            <Fact label="Capital segurado" value={illustration.faceAmount ? currency(Number(illustration.faceAmount)) : null} />
            <Fact label="Prêmio mensal informado" value={illustration.targetPremium ? currency(Number(illustration.targetPremium)) : null} />
            <Fact label="Origem do prêmio" value={illustration.targetPremiumSource === 'AGENT_INPUT_FOR_FORESIGHT' ? 'Informado pelo agente para a ilustração' : null} />
          </dl>
        </section>
      </div>

      <p className="mt-5 text-xs leading-5 text-ink-muted">
        Pedido criado em {formatCarrierInstant(illustration.createdAt)}. Nenhum valor é apresentado como cálculo da National Life antes do PDF oficial.
      </p>
    </Shell>
  )
}
