export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { Logo } from '@/components/Logo'
import { auth } from '@/lib/auth'
import {
  hashAgencyInvitationToken,
  isLocalBillingSimulationEnabled,
  isValidAgencyInvitationToken,
} from '@/lib/agency-invitations'
import { findActiveAgencyInvitationAuthority } from '@/lib/agency-invitation-authority'
import { prisma } from '@/lib/prisma'
import {
  InvitationAcceptanceForm,
} from './InvitationAcceptanceForm'
import {
  resolveAgencyInvitationPlanAccess,
  type AgencyInvitationIntendedType,
} from './plan-access'

export const metadata: Metadata = {
  title: { absolute: 'Convite de agência · Keepr One' },
  description: 'Confirme seu acesso e sua posição na estrutura da agência.',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

function maskEmail(email: string): string {
  const [localPart, domain] = email.split('@')
  if (!localPart || !domain) return 'e-mail convidado'
  const visible = localPart.slice(0, Math.min(2, localPart.length))
  return `${visible}${'*'.repeat(Math.max(3, localPart.length - visible.length))}@${domain}`
}

function InvitationUnavailable({ message }: { message: string }) {
  return (
    <main className="flex min-h-[100svh] items-center justify-center bg-[#090b09] px-5 py-12 text-white">
      <section className="w-full max-w-lg rounded-xl border border-white/10 bg-white/[0.045] p-7 sm:p-9">
        <Logo size={34} className="text-white" />
        <p className="mt-10 text-xs font-semibold uppercase tracking-[0.16em] text-[#65e497]">Convite de agência</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em]">Este link não está disponível.</h1>
        <p className="mt-4 text-sm leading-7 text-white/58">{message}</p>
        <a href="https://keeprone.com" className="mt-7 inline-flex min-h-11 items-center rounded-xl bg-white px-4 text-sm font-semibold text-black">
          Voltar ao Keepr One
        </a>
      </section>
    </main>
  )
}

export default async function AgencyInvitationPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  if (!isValidAgencyInvitationToken(token)) {
    return <InvitationUnavailable message="Peça um novo convite à agência responsável." />
  }

  const invitation = await prisma.agencyInvitation.findUnique({
    where: { tokenHash: hashAgencyInvitationToken(token) },
    select: {
      email: true,
      name: true,
      intendedType: true,
      monthlyPriceCents: true,
      status: true,
      expiresAt: true,
      agency: { select: { id: true, name: true } },
      invitedBy: {
        select: {
          id: true,
          status: true,
          user: { select: { name: true } },
        },
      },
    },
  })
  const now = new Date()
  if (
    !invitation
    || invitation.status !== 'PENDING'
    || invitation.expiresAt <= now
    || invitation.invitedBy.status !== 'ACTIVE'
  ) {
    return <InvitationUnavailable message="O convite expirou, foi revogado ou já foi utilizado. Peça à agência para gerar um novo link." />
  }
  const inviterAuthority = await findActiveAgencyInvitationAuthority(prisma, {
    agencyId: invitation.agency.id,
    agentId: invitation.invitedBy.id,
    now,
  })
  if (!inviterAuthority) {
    return <InvitationUnavailable message="A agência que enviou este convite não possui uma assinatura ativa. Peça um novo convite quando o acesso for regularizado." />
  }

  const [session, existingUser] = await Promise.all([
    auth.api.getSession({ headers: await headers() }),
    prisma.user.findFirst({
      where: { email: { equals: invitation.email.trim().toLowerCase(), mode: 'insensitive' } },
      select: {
        id: true,
        email: true,
        agent: {
          select: {
            founderEnrollment: { select: { id: true } },
            agencyMemberships: {
              where: { endedAt: null },
              orderBy: [{ joinedAt: 'desc' }, { id: 'desc' }],
              take: 2,
              select: {
                role: true,
                agency: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    }),
  ])

  const invitedEmail = invitation.email.trim().toLowerCase()
  const signedInAsInvitee = Boolean(
    existingUser
    && session
    && session.user.id === existingUser.id
    && session.user.email.trim().toLowerCase() === invitedEmail,
  )
  const accountGate = existingUser
    ? signedInAsInvitee
      ? 'READY' as const
      : session
        ? 'WRONG_ACCOUNT' as const
        : 'SIGN_IN' as const
    : session
      ? 'WRONG_ACCOUNT' as const
      : 'NEW_ACCOUNT' as const
  const activeMemberships = existingUser?.agent?.agencyMemberships ?? []
  const ownedAgency = activeMemberships.find((membership) => membership.role === 'OWNER')
  const isFounder = Boolean(existingUser?.agent?.founderEnrollment)
  const ownedAgencyName = ownedAgency?.agency.name ?? null
  const intendedType = invitation.intendedType as AgencyInvitationIntendedType | null
  const { allowedPlans, planRestriction } = resolveAgencyInvitationPlanAccess({
    activeMemberships: activeMemberships.map((membership) => ({
      role: membership.role,
      agencyId: membership.agency.id,
    })),
    intendedType,
    inviterAgencyId: invitation.agency.id,
    isFounder,
  })
  const invitationTypeLabel = intendedType === 'AGENT'
    ? 'Agente'
    : intendedType === 'AGENCY'
      ? 'Agência'
      : null
  const expiresLabel = new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(invitation.expiresAt)

  return (
    <main className="min-h-[100svh] bg-[#edf0e8] text-[#101512]">
      <div className="mx-auto grid min-h-[100svh] max-w-[1500px] lg:grid-cols-[0.82fr_1.18fr]">
        <section className="relative overflow-hidden bg-[#090b09] px-6 py-8 text-white sm:px-10 lg:min-h-[100svh] lg:px-14 lg:py-12">
          <div className="relative flex h-full flex-col lg:min-h-[470px]">
            <Logo size={36} className="text-white" />
            <div className="py-10 lg:my-auto lg:py-16">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#65e497]">Convite para crescer em rede</p>
              <h1 className="mt-5 max-w-xl text-[clamp(2.45rem,9vw,4.8rem)] font-medium leading-[0.96] tracking-[-0.04em]">
                Sua agência começa abaixo. Sua visão começa em você.
              </h1>
              <p className="mt-7 max-w-lg text-base leading-7 text-white/57">
                {invitation.invitedBy.user.name}, da {invitation.agency.name}, convidou você
                {invitationTypeLabel ? ` para entrar como ${invitationTypeLabel}` : ''}. Sua estrutura ficará organizada abaixo desse vínculo — sem expor quem está acima.
              </p>
            </div>
            <div className="grid gap-3 border-t border-white/10 pt-6 text-xs text-white/48 sm:grid-cols-2">
              <p><span className="block text-white/75">Convite para</span>{maskEmail(invitedEmail)}</p>
              <p><span className="block text-white/75">Válido até</span>{expiresLabel}</p>
            </div>
          </div>
        </section>

        <section className="flex items-center px-5 py-10 sm:px-10 lg:px-14 lg:py-14">
          <div className="mx-auto w-full max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#18864b]">Entrada na estrutura</p>
            <h2 className="mt-3 text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">
              {intendedType ? 'Confirme sua entrada na estrutura.' : 'Confirme como você entra na estrutura.'}
            </h2>
            <p className="mb-8 mt-4 max-w-xl text-sm leading-7 text-black/55">
              {invitationTypeLabel
                ? `Seu acesso como ${invitationTypeLabel} foi definido pela agência que enviou o convite. `
                : 'O vínculo direto será criado com a agência que enviou o convite. '}
              A árvore sempre começa no seu acesso e segue somente para os seus descendentes.
            </p>

            <InvitationAcceptanceForm
              token={token}
              invitedEmail={invitedEmail}
              accountGate={accountGate}
              ownedAgencyName={ownedAgencyName}
              allowedPlans={allowedPlans}
              intendedType={intendedType}
              monthlyPriceCents={invitation.monthlyPriceCents}
              planRestriction={planRestriction}
              simulationEnabled={isLocalBillingSimulationEnabled()}
            />
          </div>
        </section>
      </div>
    </main>
  )
}
