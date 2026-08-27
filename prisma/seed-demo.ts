import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { hashPassword } from 'better-auth/crypto'
import { computeOverrides } from '../lib/commission'
import type { PolicyStatus } from '@prisma/client'

const prisma = new PrismaClient()

type AgentSeed = { id: string; parentAgentId: string | null; rank: string }

function ensurePositiveInt(value: number, fallback: number): number {
  if (Number.isFinite(value) && value > 0) return Math.floor(value)
  return fallback
}

const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'password123'
const AGENT_COUNT = ensurePositiveInt(Number.parseInt(process.env.DEMO_AGENT_COUNT ?? '100', 10), 100)
const CLIENTS_PER_AGENT = ensurePositiveInt(Number.parseInt(process.env.DEMO_CLIENTS_PER_AGENT ?? '2', 10), 2)
const POLICIES_PER_CLIENT = ensurePositiveInt(
  Number.parseInt(process.env.DEMO_POLICIES_PER_CLIENT ?? '2', 10),
  2,
)

function daysAgoFromNow(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
}

function formatPeriod(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function periodForPolicy(idx: number): string {
  const shift = idx % 3
  const d = new Date()
  d.setMonth(d.getMonth() - shift)
  return formatPeriod(d)
}

async function ensureCommissionPlans() {
  const required = [
    { rank: 'MANAGER', downlineLevel: 1, overridePercent: '10' },
    { rank: 'DIRECTOR', downlineLevel: 2, overridePercent: '5' },
  ] as const

  await Promise.all(
    required.map((plan) =>
      prisma.commissionPlan.upsert({
        where: { rank_downlineLevel: { rank: plan.rank, downlineLevel: plan.downlineLevel } },
        update: {},
        create: plan,
      }),
    ),
  )
}

async function createUser(email: string, name: string, role: 'ADMIN' | 'AGENT' | 'CLIENT') {
  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    if (existing.role !== role) {
      await prisma.user.update({ where: { id: existing.id }, data: { role } })
    }
    return existing
  }

  const password = await hashPassword(SEED_PASSWORD)
  return prisma.$transaction(async (transaction) => {
    const user = await transaction.user.create({
      data: { email, name, role },
    })
    await transaction.account.create({
      data: {
        id: randomUUID(),
        accountId: user.id,
        providerId: 'credential',
        userId: user.id,
        password,
      },
    })
    return user
  })
}

async function createDemoHierarchy(agentCount: number) {
  const branches = 6
  const seeds: AgentSeed[] = []

  for (let i = 0; i < agentCount; i += 1) {
    const label = String(i + 1).padStart(3, '0')
    const email = `agent-${label}@ricos.test`
    const user = await createUser(email, `Agente Demo ${label}`, 'AGENT')

    const depth = i === 0 ? 0 : Math.floor(Math.log10(i + 1) / Math.log10(branches))
    const rank = depth === 0 ? 'DIRECTOR' : depth === 1 ? 'MANAGER' : 'AGENT'

    const parentIndex = i === 0 ? null : Math.floor((i - 1) / branches)
    const parentAgentId = parentIndex === null ? null : seeds[parentIndex]?.id
    const phone = `+1555${String(i + 1).padStart(7, '0')}`

    const agent = await prisma.agent.upsert({
      where: { userId: user.id },
      update: {
        parentAgentId,
        rank,
        npn: `DEMO-${String(i + 1).padStart(5, '0')}`,
        phone,
        status: 'ACTIVE',
      },
      create: {
        userId: user.id,
        rank,
        npn: `DEMO-${String(i + 1).padStart(5, '0')}`,
        phone,
        status: 'ACTIVE',
        parentAgentId,
      },
    })

    seeds.push({ id: agent.id, parentAgentId: agent.parentAgentId, rank })
  }

  return seeds
}

function pick<T>(values: readonly T[], idx: number): T {
  return values[idx % values.length]
}

async function createDemoClientsAndPolicies(agents: AgentSeed[]) {
  const plans = await prisma.commissionPlan.findMany()
  const plansByRankAndLevel = new Map<string, number>()
  for (const plan of plans) {
    plansByRankAndLevel.set(`${plan.rank}:${plan.downlineLevel}`, plan.overridePercent.toNumber())
  }
  const lookupPlan = (rank: string, downlineLevel: number): number | null =>
    plansByRankAndLevel.get(`${rank}:${downlineLevel}`) ?? null

  const carriers = ['National Life Group', 'Five Rings Financial', 'Alliance Group', 'Mutual of Omaha', 'Aetna'] as const
  const products = ['Term 20', 'Whole Life', 'Final Expense', 'Universal Life', 'Indexed Universal Life'] as const
  const statuses: PolicyStatus[] = ['INFORCE', 'PENDING', 'APPROVED', 'LAPSED', 'CANCELLED']

  for (let i = 0; i < agents.length; i += 1) {
    const agent = agents[i]
    for (let c = 0; c < CLIENTS_PER_AGENT; c += 1) {
      const clientLabel = `${String(i + 1).padStart(3, '0')}-${c + 1}`
      const clientName = `Cliente Demo ${clientLabel}`

      const maybeClientLogin = c === 0 && i < 20
      let clientUserId: string | null = null
      if (maybeClientLogin) {
        const clientUserEmail = `client-${clientLabel}@ricos.test`
        const clientUser = await createUser(clientUserEmail, `Cliente Demo ${clientLabel}`, 'CLIENT')
        clientUserId = clientUser.id
      }

      const clientData = {
        name: clientName,
        assignedAgentId: agent.id,
        email: maybeClientLogin ? `client-${clientLabel}@ricos.test` : `client-${clientLabel}@mail.riscos.example`,
        phone: `+1-555-000-${String(i + 1).padStart(3, '0')}-${String(c + 1).padStart(2, '0')}`,
      }

      const client = clientUserId
        ? await (async () => {
            const existingClient = await prisma.client.findUnique({ where: { userId: clientUserId } })
            if (existingClient) {
              return prisma.client.update({
                where: { id: existingClient.id },
                data: {
                  ...clientData,
                  userId: clientUserId,
                },
              })
            }

            return prisma.client.create({
              data: {
                ...clientData,
                userId: clientUserId,
              },
            })
          })()
        : await prisma.client.create({
            data: clientData,
          })

      for (let p = 0; p < POLICIES_PER_CLIENT; p += 1) {
        const policyIndex = i * CLIENTS_PER_AGENT * POLICIES_PER_CLIENT + c * POLICIES_PER_CLIENT + p
        const status = pick(statuses, policyIndex)
        const carrier = pick(carriers, policyIndex + i)
        const product = pick(products, policyIndex + c)
        const premium = 25 + ((policyIndex * 7) % 130)
        const faceAmount = 10_000 + (policyIndex * 2_500)
        const effectiveDate = p % 2 === 0 ? daysAgoFromNow(30 + ((policyIndex * 3) % 220)) : null
        const statusChangedAt = status === 'CANCELLED' ? daysAgoFromNow(45) : daysAgoFromNow((policyIndex % 8) * 4)
        const lastPaymentDate =
          status === 'INFORCE'
            ? daysAgoFromNow((policyIndex % 20) + 1)
            : status === 'LAPSED'
              ? daysAgoFromNow((policyIndex % 40) + 45)
              : null
        const policyNumber = `DEMO-${String(i + 1).padStart(3, '0')}-${String(c + 1).padStart(2, '0')}-${String(p + 1).padStart(2, '0')}`

        const policy = await prisma.policy.upsert({
          where: { policyNumber },
          update: {
            clientId: client.id,
            agentId: agent.id,
            carrier,
            product,
            faceAmount,
            premium,
            status,
            effectiveDate,
            statusChangedAt,
            lastPaymentDate,
          },
          create: {
            clientId: client.id,
            agentId: agent.id,
            carrier,
            product,
            policyNumber,
            faceAmount,
            premium,
            status,
            effectiveDate,
            statusChangedAt,
            lastPaymentDate,
          },
        })

        if (status === 'CANCELLED') continue

        const period = periodForPolicy(policyIndex)
        const baseAmount = 120 + (policyIndex % 7) * 37

        await prisma.commissionRecord.upsert({
          where: {
            policyId_agentId_period_type_level: {
              policyId: policy.id,
              agentId: agent.id,
              period,
              type: 'DIRECT',
              level: 0,
            },
          },
          create: {
            policyId: policy.id,
            agentId: agent.id,
            amount: baseAmount,
            type: 'DIRECT',
            level: 0,
            period,
          },
          update: {
            amount: baseAmount,
          },
        })

        for (const override of computeOverrides(agents, agent.id, baseAmount, lookupPlan)) {
          if (override.amount <= 0) continue
          await prisma.commissionRecord.upsert({
            where: {
              policyId_agentId_period_type_level: {
                policyId: policy.id,
                agentId: override.agentId,
                period,
                type: 'OVERRIDE',
                level: override.level,
              },
            },
            create: {
              policyId: policy.id,
              agentId: override.agentId,
              amount: override.amount,
              type: 'OVERRIDE',
              level: override.level,
              period,
            },
            update: {
              amount: override.amount,
            },
          })
        }
      }
    }
  }
}

async function createDemoAdmin() {
  const admin = await createUser('admin@ricos.test', 'Admin Demo', 'ADMIN')
  return admin
}

async function main() {
  const safeAgentCount = ensurePositiveInt(AGENT_COUNT, 100)

  if (safeAgentCount < 1) {
    throw new Error('DEMO_AGENT_COUNT precisa ser maior que 0')
  }

  await ensureCommissionPlans()
  await createDemoAdmin()
  const agents = await createDemoHierarchy(safeAgentCount)
  await createDemoClientsAndPolicies(agents)

  console.log(`Demo seed: ${safeAgentCount} agentes criados`)
  console.log('Top logins:')
  console.log('admin@ricos.test')
  console.log('agent-001@ricos.test')
  console.log('agent-002@ricos.test')
  console.log('agent-010@ricos.test')
  console.log('client-001-1@ricos.test')
  console.log('client-002-1@ricos.test')
  console.log(`Senha única para todos os usuários mock (se não alterada): ${SEED_PASSWORD}`)
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error)
    await prisma.$disconnect()
    process.exit(1)
  })
