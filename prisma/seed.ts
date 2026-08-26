import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { hashPassword } from 'better-auth/crypto'
import { computeOverrides } from '../lib/commission'
import {
  AGENCY_MONTHLY_PRICE_CENTS,
  INDIVIDUAL_AGENT_MONTHLY_PRICE_CENTS,
  INVITED_AGENT_MONTHLY_PRICE_CENTS,
} from '../lib/plans'

const prisma = new PrismaClient()

// Dev-only seed password for every seeded user. Never use this outside of
// local/dev seeding — production users must set their own passwords.
const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'password123'

/**
 * Better Auth's email/password login needs a matching credential Account with
 * a password in its own scrypt format. The public generic signup endpoint is
 * intentionally disabled, so the seed provisions this pair directly.
 */
async function createUser(email: string, name: string, role: 'ADMIN' | 'AGENT' | 'CLIENT') {
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

async function main() {
  const now = new Date()
  const admin = await createUser('admin@ricos.test', 'Admin RICOS', 'ADMIN')

  const topUser = await createUser('top@ricos.test', 'Agente Topo', 'AGENT')
  const top = await prisma.agent.create({
    data: {
      userId: topUser.id,
      rank: 'DIRECTOR',
      npn: '1000001',
      phone: '+15550000001',
      status: 'ACTIVE',
      // Kept while the legacy promotion writer is migrated; portal access is
      // authorized by the platform subscription created below.
      promotionAccessScope: 'AGENCY',
    },
  })

  const midUser = await createUser('mid@ricos.test', 'Agente Meio', 'AGENT')
  const mid = await prisma.agent.create({
    data: {
      userId: midUser.id,
      parentAgentId: top.id,
      rank: 'MANAGER',
      npn: '1000002',
      phone: '+15550000002',
      status: 'ACTIVE',
    },
  })

  const leafUser = await createUser('leaf@ricos.test', 'Agente Base', 'AGENT')
  const leaf = await prisma.agent.create({
    data: {
      userId: leafUser.id,
      parentAgentId: mid.id,
      rank: 'AGENT',
      npn: '1000003',
      phone: '+15550000003',
      status: 'ACTIVE',
    },
  })

  // Demo all three commercial access contexts without treating hierarchy as
  // an entitlement: top owns the agency, mid is an invited subscriber, and
  // leaf remains on the independent agent plan despite being in the tree.
  const agency = await prisma.agency.create({
    data: { name: 'Agência RICOS Demo' },
  })
  await prisma.agencyMembership.create({
    data: {
      agencyId: agency.id,
      agentId: top.id,
      role: 'OWNER',
    },
  })
  const invitedMembership = await prisma.agencyMembership.create({
    data: {
      agencyId: agency.id,
      agentId: mid.id,
      role: 'MEMBER',
      invitedByAgentId: top.id,
    },
  })

  await prisma.platformSubscription.createMany({
    data: [
      {
        plan: 'AGENCY',
        status: 'ACTIVE',
        agencyId: agency.id,
        unitAmountCents: AGENCY_MONTHLY_PRICE_CENTS,
      },
      {
        plan: 'AGENT_AGENCY_MEMBER',
        status: 'ACTIVE',
        agencyMembershipId: invitedMembership.id,
        unitAmountCents: INVITED_AGENT_MONTHLY_PRICE_CENTS,
      },
      {
        plan: 'AGENT_INDIVIDUAL',
        status: 'ACTIVE',
        agentId: leaf.id,
        unitAmountCents: INDIVIDUAL_AGENT_MONTHLY_PRICE_CENTS,
      },
    ],
  })

  await prisma.commissionPlan.createMany({
    data: [
      { rank: 'MANAGER', downlineLevel: 1, overridePercent: 10 },
      { rank: 'DIRECTOR', downlineLevel: 2, overridePercent: 5 },
    ],
  })

  const clientUser = await createUser('client@ricos.test', 'Cliente Exemplo', 'CLIENT')
  const client = await prisma.client.create({
    data: { userId: clientUser.id, name: 'Cliente Exemplo', assignedAgentId: leaf.id },
  })

  await prisma.policy.create({
    data: {
      clientId: client.id,
      agentId: leaf.id,
      carrier: 'National Life Group',
      product: 'Term 20',
      policyNumber: 'NLG-0001',
      faceAmount: 250000,
      premium: 45.5,
      status: 'INFORCE',
    },
  })

  // Extra mock data below: gives the dashboard, risk alerts, and admin
  // production comparison something varied to show — not needed by any
  // test, just for demoing the UI locally with `pnpm dev`.
  const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000)

  const clientBeta = await prisma.client.create({
    data: { name: 'Cliente Beta', assignedAgentId: leaf.id },
  })
  const clientGama = await prisma.client.create({
    data: { name: 'Cliente Gama', assignedAgentId: leaf.id },
  })

  await prisma.policy.createMany({
    data: [
      // Recent payment, no alert.
      {
        clientId: clientBeta.id,
        agentId: leaf.id,
        carrier: 'Five Rings Financial',
        product: 'Whole Life',
        policyNumber: 'FRF-0001',
        faceAmount: 300000,
        premium: 60,
        status: 'INFORCE',
        effectiveDate: daysAgo(200),
        lastPaymentDate: daysAgo(10),
        statusChangedAt: daysAgo(200),
      },
      // NO_PAYMENT alert: last payment over 30 days ago.
      {
        clientId: clientGama.id,
        agentId: leaf.id,
        carrier: 'Alliance Group',
        product: 'Term 20',
        policyNumber: 'ALG-0001',
        faceAmount: 180000,
        premium: 35,
        status: 'INFORCE',
        effectiveDate: daysAgo(100),
        lastPaymentDate: daysAgo(45),
        statusChangedAt: daysAgo(100),
      },
      // NO_PAYMENT alert: never had a payment or effective date on record.
      {
        clientId: client.id,
        agentId: leaf.id,
        carrier: 'Alliance Group',
        product: 'Final Expense',
        policyNumber: 'ALG-0002',
        faceAmount: 25000,
        premium: 80,
        status: 'INFORCE',
        statusChangedAt: daysAgo(60),
      },
      // STALLED alert: pending for 20 days.
      {
        clientId: clientBeta.id,
        agentId: leaf.id,
        carrier: 'National Life Group',
        product: 'Term 20',
        policyNumber: 'NLG-0002',
        faceAmount: 200000,
        premium: 40,
        status: 'PENDING',
        createdAt: daysAgo(20),
        statusChangedAt: daysAgo(20),
      },
      // STALLED alert: approved for 18 days.
      {
        clientId: clientGama.id,
        agentId: leaf.id,
        carrier: 'Five Rings Financial',
        product: 'Term 20',
        policyNumber: 'FRF-0002',
        faceAmount: 220000,
        premium: 42,
        status: 'APPROVED',
        createdAt: daysAgo(18),
        statusChangedAt: daysAgo(18),
      },
      // RECENT_LAPSE alert: status changed to LAPSED 10 days ago.
      {
        clientId: client.id,
        agentId: leaf.id,
        carrier: 'National Life Group',
        product: 'Whole Life',
        policyNumber: 'NLG-0003',
        faceAmount: 150000,
        premium: 55,
        status: 'LAPSED',
        effectiveDate: daysAgo(300),
        statusChangedAt: daysAgo(10),
      },
      // No alert: lapsed long ago, outside the recent-lapse window.
      {
        clientId: clientBeta.id,
        agentId: leaf.id,
        carrier: 'Alliance Group',
        product: 'Term 20',
        policyNumber: 'ALG-0003',
        faceAmount: 90000,
        premium: 30,
        status: 'LAPSED',
        effectiveDate: daysAgo(400),
        statusChangedAt: daysAgo(90),
      },
      // Control case: cancelled, never alerts.
      {
        clientId: clientGama.id,
        agentId: leaf.id,
        carrier: 'National Life Group',
        product: 'Final Expense',
        policyNumber: 'NLG-0004',
        faceAmount: 50000,
        premium: 65,
        status: 'CANCELLED',
        statusChangedAt: daysAgo(50),
      },
      // A few more spread across recent months, to give the monthly chart shape.
      {
        clientId: client.id,
        agentId: leaf.id,
        carrier: 'Five Rings Financial',
        product: 'Whole Life',
        policyNumber: 'FRF-0003',
        faceAmount: 275000,
        premium: 58,
        status: 'INFORCE',
        effectiveDate: daysAgo(70),
        lastPaymentDate: daysAgo(5),
        createdAt: daysAgo(70),
        statusChangedAt: daysAgo(70),
      },
      {
        clientId: clientBeta.id,
        agentId: leaf.id,
        carrier: 'National Life Group',
        product: 'Term 20',
        policyNumber: 'NLG-0005',
        faceAmount: 320000,
        premium: 62,
        status: 'INFORCE',
        effectiveDate: daysAgo(130),
        lastPaymentDate: daysAgo(2),
        createdAt: daysAgo(130),
        statusChangedAt: daysAgo(130),
      },
    ],
  })

  // Commission history across 3 months, so /admin/production has more than
  // one period to compare and the direct/override split shows up for real.
  const periodFor = (monthsAgo: number) => {
    const d = new Date(now.getFullYear(), now.getMonth() - monthsAgo, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  }
  const allAgents = [
    { id: top.id, parentAgentId: null, rank: top.rank },
    { id: mid.id, parentAgentId: top.id, rank: mid.rank },
    { id: leaf.id, parentAgentId: mid.id, rank: leaf.rank },
  ]
  const plans = await prisma.commissionPlan.findMany()
  const lookupPlan = (rank: string, level: number) => {
    const plan = plans.find((p) => p.rank === rank && p.downlineLevel === level)
    return plan ? plan.overridePercent.toNumber() : null
  }

  const commissionedPolicy = await prisma.policy.findFirstOrThrow({ where: { policyNumber: 'NLG-0001' } })

  for (const [monthsAgo, directAmount] of [[2, 400], [1, 550], [0, 300]] as const) {
    const period = periodFor(monthsAgo)
    await prisma.commissionRecord.create({
      data: { policyId: commissionedPolicy.id, agentId: leaf.id, amount: directAmount, type: 'DIRECT', level: 0, period },
    })
    for (const override of computeOverrides(allAgents, leaf.id, directAmount, lookupPlan)) {
      await prisma.commissionRecord.create({
        data: {
          policyId: commissionedPolicy.id,
          agentId: override.agentId,
          amount: override.amount,
          type: 'OVERRIDE',
          level: override.level,
          period,
        },
      })
    }
  }

  console.log({ admin: admin.email, top: top.id, mid: mid.id, leaf: leaf.id })
  const usedPasswordMessage = SEED_PASSWORD === 'password123' ? 'password123 (change in production)' : SEED_PASSWORD
  console.log(`All seeded users can sign in at /login with password: ${usedPasswordMessage}`)
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
