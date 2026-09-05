import { getCurrentAgent } from '@/lib/agent-context'
import { prisma } from '@/lib/prisma'
import { Shell } from '@/components/Shell'
import { AiWorkspace } from './AiWorkspace'

export const dynamic = 'force-dynamic'
export default async function AiPage() {
  const agent = await getCurrentAgent()
  const user = await prisma.user.findUniqueOrThrow({ where: { id: agent.userId }, select: { name: true } })
  return <Shell role="AGENT" userName={user.name}><AiWorkspace /></Shell>
}
