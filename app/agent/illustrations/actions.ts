"use server";

import { revalidatePath } from 'next/cache'
import { getCurrentAgent } from '@/lib/agent-context'
import { prisma } from '@/lib/prisma'
import { enqueueIllustrationPdf } from '@/lib/national-life/job-service'

export type RequestIllustrationPdfResult =
  | { ok: true; jobId: string; duplicate: boolean }
  | { ok: false; message: string }

/// Asks the carrier to render the PDF of a quote the agent already made.
///
/// The illustration is looked up scoped to the agent before anything is queued:
/// the id arrives from a form, and a job that renders someone else's client is
/// not a bug to find later.
export async function requestIllustrationPdf(
  illustrationId: string,
): Promise<RequestIllustrationPdfResult> {
  const agent = await getCurrentAgent()

  const illustration = await prisma.illustration.findFirst({
    where: { id: illustrationId, agentId: agent.id },
    select: { id: true, insuredName: true },
  })
  if (!illustration) {
    return { ok: false, message: 'Cotação não encontrada.' }
  }

  // Foresight names a quick quote `RP-<sobrenome>-QQ-<carimbo>`, so the surname
  // is what narrows the tool's Recent panel to the right case. Without a name
  // the job takes the most recent quick quote, which is the one just made.
  const surname = (illustration.insuredName ?? '').trim().split(/\s+/).at(-1)

  const { jobId, duplicate } = await enqueueIllustrationPdf({
    agentId: agent.id,
    illustrationId: illustration.id,
    ...(surname ? { caseNameFragment: surname } : {}),
  })

  revalidatePath('/agent/illustrations')
  return { ok: true, jobId, duplicate }
}
