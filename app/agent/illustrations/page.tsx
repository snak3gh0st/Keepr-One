export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { getCurrentAgent } from '@/lib/agent-context'
import { summarizeQuotePayload } from '@/lib/national-life/quote-summary'
import { getIllustrationPdfStatuses } from '@/lib/national-life/job-service'
import { illustrationPdfMessage } from '@/lib/national-life/illustration-pdf-status'
import { Shell } from '@/components/Shell'
import { PageHeader } from '@/components/PageHeader'
import {
  IllustrationsWorkspace,
  type IllustrationWorkspaceItem,
} from './IllustrationsWorkspace'

export default async function IllustrationsPage() {
  const agent = await getCurrentAgent()
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
        productName: true,
        documentFetchedAt: true,
        // Both sides of the carrier exchange were persisted; the question is what
        // makes the answer mean anything. Two quotes at the same face amount are
        // different quotes if the insured is not the same age or rate class.
        rawPayload: true,
        client: { select: { id: true, name: true } },
      },
    }),
    // One query for the whole list, so every item can say where its render stands.
    getIllustrationPdfStatuses(agent.id),
  ])

  return (
    <Shell role="AGENT" userName={user?.name ?? ''}>
      <PageHeader
        title="Ilustrações"
        eyebrow="Pré-venda"
        description="Simule coberturas, compare prêmio e recupere cada documento sem perder o histórico do segurado."
      >
        <Link
          href="/agent/illustrations/new"
          className="inline-flex items-center border border-white/15 px-4 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-white/[0.06]"
        >
          Nova ilustração
        </Link>
      </PageHeader>

      <IllustrationsWorkspace
        isLimited={illustrations.length === 100}
        illustrations={illustrations.map((illustration): IllustrationWorkspaceItem => {
          const quote = summarizeQuotePayload(illustration.rawPayload)
          const status = pdfStatus.get(illustration.id)
          const gender =
            quote.gender === 'Male'
              ? 'Masculino'
              : quote.gender === 'Female'
                ? 'Feminino'
                : quote.gender
          const asked = [
            quote.issueAge === null ? null : `${quote.issueAge} anos`,
            gender,
            quote.issueState,
            quote.rateClass,
          ].filter((value): value is string => Boolean(value))

          return {
            id: illustration.id,
            dateLabel: illustration.createdAt.toLocaleDateString('pt-BR'),
            insuredName: illustration.insuredName ?? 'Segurado não informado',
            insuredDetails: asked.join(' · '),
            client: illustration.client,
            productName: illustration.productName ?? 'Produto não informado',
            strategy: quote.strategy,
            faceAmount: illustration.faceAmount ? Number(illustration.faceAmount) : null,
            premium: illustration.premium ? Number(illustration.premium) : null,
            annualPremium: quote.annualPremium,
            documentState: illustration.documentFetchedAt
              ? 'READY'
              : status?.state === 'WORKING'
                ? 'WORKING'
                : status?.state === 'FAILED'
                  ? 'ATTENTION'
                  : 'NOT_REQUESTED',
            documentMessage: status ? illustrationPdfMessage(status) : null,
          }
        })}
      />
    </Shell>
  )
}
