'use client'

import Link from 'next/link'
import { useActionState, useEffect, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth-client'
import {
  AGENCY_INVITATION_DISCOUNT_CENTS,
  formatPlanPrice,
  getAgencyInvitationPriceCents,
  INVITED_AGENCY_MONTHLY_PRICE_CENTS,
  INVITED_AGENT_MONTHLY_PRICE_CENTS,
} from '@/lib/plans'
import {
  acceptAgencyInvitationAction,
  INITIAL_AGENCY_INVITATION_ACCEPTANCE_STATE,
} from './actions'
import type {
  AgencyInvitationAcceptedPlan,
  AgencyInvitationIntendedType,
  AgencyInvitationPlanRestriction,
} from './plan-access'

export type {
  AgencyInvitationAcceptedPlan,
  AgencyInvitationIntendedType,
  AgencyInvitationPlanRestriction,
} from './plan-access'
type AccountGate = 'NEW_ACCOUNT' | 'READY' | 'SIGN_IN' | 'WRONG_ACCOUNT'

const memberPrice = formatPlanPrice(INVITED_AGENT_MONTHLY_PRICE_CENTS)
const agencyPrice = formatPlanPrice(INVITED_AGENCY_MONTHLY_PRICE_CENTS)
const invitationDiscount = formatPlanPrice(AGENCY_INVITATION_DISCOUNT_CENTS)

function SubmitButton({
  disabled,
  fixedAccess,
  simulationEnabled,
}: {
  disabled: boolean
  fixedAccess: boolean
  simulationEnabled: boolean
}) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-[#0b0c0b] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#1a1c1a] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#65e497]/25 disabled:cursor-not-allowed disabled:opacity-45"
    >
      {pending
        ? simulationEnabled ? 'Confirmando convite…' : 'Abrindo checkout seguro…'
        : !simulationEnabled
          ? 'Continuar para pagamento seguro'
        : fixedAccess
          ? 'Confirmar acesso e entrar na estrutura'
          : 'Confirmar plano e entrar na estrutura'}
    </button>
  )
}

function SignOutButton() {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  return (
    <button
      type="button"
      disabled={pending}
      onClick={async () => {
        setPending(true)
        try {
          await authClient.signOut()
          router.refresh()
        } finally {
          setPending(false)
        }
      }}
      className="inline-flex min-h-11 items-center justify-center rounded-xl bg-white px-4 text-sm font-semibold text-black disabled:opacity-50"
    >
      {pending ? 'Saindo…' : 'Sair e usar a conta convidada'}
    </button>
  )
}

function FieldError({ id, errors }: { id: string; errors?: string[] }) {
  if (!errors?.length) return null
  return <span id={id} className="mt-1 block text-xs text-[#b42318]">{errors[0]}</span>
}

export function InvitationAcceptanceForm({
  token,
  invitedEmail,
  accountGate,
  ownedAgencyName,
  allowedPlans,
  intendedType = null,
  monthlyPriceCents,
  planRestriction,
  simulationEnabled,
}: {
  token: string
  invitedEmail: string
  accountGate: AccountGate
  ownedAgencyName: string | null
  allowedPlans: AgencyInvitationAcceptedPlan[]
  intendedType?: AgencyInvitationIntendedType | null
  monthlyPriceCents: number
  planRestriction: AgencyInvitationPlanRestriction
  simulationEnabled: boolean
}) {
  const intendedPlan: AgencyInvitationAcceptedPlan | null = intendedType === 'AGENT'
    ? 'AGENT_AGENCY_MEMBER'
    : intendedType === 'AGENCY'
      ? 'AGENCY'
      : null
  const fixedPlan = intendedPlan && allowedPlans.includes(intendedPlan)
    ? intendedPlan
    : null
  const fixedPrice = fixedPlan ? formatPlanPrice(monthlyPriceCents) : null
  const fixedPlanHasDiscount = Boolean(
    fixedPlan
    && intendedType
    && monthlyPriceCents === getAgencyInvitationPriceCents(intendedType),
  )
  const [state, action] = useActionState(
    acceptAgencyInvitationAction,
    INITIAL_AGENCY_INVITATION_ACCEPTANCE_STATE,
  )
  const [plan, setPlan] = useState<AgencyInvitationAcceptedPlan | ''>(
    fixedPlan ?? (allowedPlans.length === 1 ? allowedPlans[0] : ''),
  )
  const returnPath = `/convites/agencia/${encodeURIComponent(token)}`
  const loginHref = `/login?${new URLSearchParams({
    email: invitedEmail,
    invitation: 'agency',
    next: returnPath,
  }).toString()}`

  useEffect(() => {
    if (state.status === 'checkout' && state.nextUrl) {
      window.location.assign(state.nextUrl)
    }
  }, [state.nextUrl, state.status])

  if (accountGate === 'SIGN_IN') {
    return (
      <div className="rounded-xl border border-black/10 bg-white p-5">
        <p className="text-sm leading-6 text-black/65">
          Já existe uma conta para o e-mail convidado. Entre com essa conta para confirmar que o convite pertence a você.
        </p>
        <Link href={loginHref} className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-black px-4 text-sm font-semibold text-white">
          Entrar e voltar ao convite
        </Link>
      </div>
    )
  }

  if (accountGate === 'WRONG_ACCOUNT') {
    return (
      <div className="rounded-xl border border-[#b42318]/20 bg-[#fff2ef] p-5">
        <p className="text-sm leading-6 text-[#7a271a]">
          A sessão aberta pertence a outra conta. Saia antes de criar ou acessar a conta que recebeu este convite.
        </p>
        <div className="mt-4"><SignOutButton /></div>
      </div>
    )
  }

  if (state.status === 'success') {
    return (
      <div role="status" className="rounded-xl border border-[#18864b]/25 bg-[#edfdf3] p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#08733e]">Convite confirmado</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-[#101512]">Sua posição na estrutura foi criada.</h2>
        <p className="mt-3 text-sm leading-6 text-[#3c4a41]">{state.message}</p>
        {state.nextUrl ? (
          <Link href={state.nextUrl} className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-[#101512] px-4 text-sm font-semibold text-white">
            {state.createdAccount ? 'Entrar com a conta criada' : 'Abrir minha área'}
          </Link>
        ) : null}
      </div>
    )
  }

  if (state.status === 'checkout' && state.nextUrl) {
    return (
      <div role="status" className="rounded-xl border border-[#18864b]/25 bg-[#edfdf3] p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#08733e]">Checkout preparado</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-[#101512]">Abrindo o pagamento seguro.</h2>
        <p className="mt-3 text-sm leading-6 text-[#3c4a41]">{state.message}</p>
        <a href={state.nextUrl} className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-[#101512] px-4 text-sm font-semibold text-white">
          Continuar para a Stripe
        </a>
      </div>
    )
  }

  if (allowedPlans.length === 0 || (intendedPlan && !fixedPlan)) {
    const incompatibleType = intendedPlan && !fixedPlan
    return (
      <div className="rounded-xl border border-[#b42318]/20 bg-[#fff2ef] p-5">
        <p className="text-sm leading-6 text-[#7a271a]">
          {planRestriction === 'ACTIVE_MEMBER'
            ? 'Esta conta já possui um vínculo ativo com outra posição ou agência. Esse vínculo precisa ser encerrado antes de aceitar este convite.'
            : incompatibleType && intendedType === 'AGENT'
              ? 'Este convite foi emitido para Agente, mas esta conta possui um vínculo compatível apenas com Agência. Peça à agência convidante um novo convite do tipo Agência.'
              : incompatibleType
                ? 'Esta conta não pode assumir o vínculo de Agência definido neste convite. Peça à agência convidante para revisar o tipo do convite.'
                : 'Esta conta já possui um vínculo ativo como membro de outra agência. Esse vínculo precisa ser encerrado antes de aceitar uma nova posição.'}
        </p>
      </div>
    )
  }

  const memberAllowed = allowedPlans.includes('AGENT_AGENCY_MEMBER')
  const agencyAllowed = allowedPlans.includes('AGENCY')

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="token" value={token} />
      <input className="hidden" aria-hidden tabIndex={-1} autoComplete="off" name="website" />

      <fieldset>
        <legend className="text-sm font-semibold text-[#101512]">
          {fixedPlan ? 'Acesso definido neste convite' : 'Escolha como você quer operar'}
        </legend>
        {fixedPlan ? (
          <div className="mt-3 rounded-xl border border-[#18864b] bg-[#edfdf3] p-4">
            <input type="hidden" name="plan" value={fixedPlan} />
            <span className="flex items-center justify-between gap-3 text-sm font-semibold text-[#101512]">
              {fixedPlan === 'AGENT_AGENCY_MEMBER' ? 'Agente convidado' : 'Plano Agência'}
              <small className="rounded-full bg-[#18864b] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-white">
                Definido pela agência
              </small>
            </span>
            <strong className="mt-2 block text-xl tracking-[-0.04em] text-[#101512]">
              {fixedPrice}
              <small className="text-xs font-medium text-black/65"> / mês</small>
            </strong>
            {fixedPlanHasDiscount ? (
              <span className="mt-2 block text-xs font-semibold text-[#12693b]">
                {invitationDiscount} de desconto mensal por ter vindo por convite.
              </span>
            ) : null}
            <span className="mt-2 block text-xs leading-5 text-black/55">
              {fixedPlan === 'AGENT_AGENCY_MEMBER'
                ? 'Seu acesso individual ficará vinculado diretamente à agência que enviou o convite.'
                : 'Sua agência formará um novo ramo abaixo da agência que enviou o convite.'}
            </span>
          </div>
        ) : (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className={`rounded-xl border p-4 transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[#18864b] ${memberAllowed ? 'cursor-pointer' : 'cursor-not-allowed opacity-55'} ${plan === 'AGENT_AGENCY_MEMBER' ? 'border-[#18864b] bg-[#edfdf3]' : 'border-black/10 bg-white'}`}>
              <input
                type="radio"
                name="plan"
                value="AGENT_AGENCY_MEMBER"
                required
                disabled={!memberAllowed}
                checked={plan === 'AGENT_AGENCY_MEMBER'}
                onChange={() => setPlan('AGENT_AGENCY_MEMBER')}
                aria-describedby={state.fieldErrors?.plan ? 'invitation-plan-error' : undefined}
                className="sr-only"
              />
              <span className="flex items-center justify-between gap-2 text-sm font-semibold text-[#101512]">
                Agente convidado
                {plan === 'AGENT_AGENCY_MEMBER' ? <small className="rounded-full bg-[#18864b] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-white">Selecionado</small> : null}
              </span>
              <strong className="mt-2 block text-xl tracking-[-0.04em] text-[#101512]">{memberPrice}<small className="text-xs font-medium text-black/65"> / mês</small></strong>
              <span className="mt-2 block text-xs font-semibold text-[#12693b]">
                {invitationDiscount} de desconto mensal por ter vindo por convite.
              </span>
              <span className="mt-2 block text-xs leading-5 text-black/55">Acesso individual vinculado à agência que convidou você.</span>
            </label>

            <label className={`rounded-xl border p-4 transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[#18864b] ${agencyAllowed ? 'cursor-pointer' : 'cursor-not-allowed opacity-55'} ${plan === 'AGENCY' ? 'border-[#18864b] bg-[#edfdf3]' : 'border-black/10 bg-white'}`}>
              <input
                type="radio"
                name="plan"
                value="AGENCY"
                required
                disabled={!agencyAllowed}
                checked={plan === 'AGENCY'}
                onChange={() => setPlan('AGENCY')}
                aria-describedby={state.fieldErrors?.plan ? 'invitation-plan-error' : undefined}
                className="sr-only"
              />
              <span className="flex items-center justify-between gap-2 text-sm font-semibold text-[#101512]">
                Plano Agência
                {plan === 'AGENCY' ? <small className="rounded-full bg-[#18864b] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-white">Selecionado</small> : null}
              </span>
              <strong className="mt-2 block text-xl tracking-[-0.04em] text-[#101512]">{agencyPrice}<small className="text-xs font-medium text-black/65"> / mês</small></strong>
              <span className="mt-2 block text-xs font-semibold text-[#12693b]">
                {invitationDiscount} de desconto mensal por ter vindo por convite.
              </span>
              <span className="mt-2 block text-xs leading-5 text-black/55">Crie sua agência abaixo da atual e convide sua própria equipe.</span>
            </label>
          </div>
        )}
        {planRestriction === 'PROMOTE_DIRECT_MEMBER' ? (
          <p className="mt-3 rounded-xl border border-[#18864b]/20 bg-[#edfdf3] px-4 py-3 text-xs leading-5 text-[#12693b]">
            Ao confirmar, seu vínculo atual de agente com esta agência será convertido em uma subagência. Você passará a administrar seu próprio ramo e poderá convidar agentes ou agências abaixo de você.
          </p>
        ) : planRestriction === 'OWNED_AGENCY' ? (
          <p className="mt-3 text-xs leading-5 text-black/55">
            Como esta conta já é titular de uma agência, somente o plano Agência é compatível. A agência existente será conectada abaixo da agência que enviou o convite.
          </p>
        ) : planRestriction === 'FOUNDER' ? (
          <p className="mt-3 text-xs leading-5 text-black/55">
            Nesta primeira versão, uma conta Founder existente entra neste convite pelo plano Agência para preservar seu vínculo comercial.
          </p>
        ) : null}
        <FieldError id="invitation-plan-error" errors={state.fieldErrors?.plan} />
      </fieldset>

      {accountGate === 'NEW_ACCOUNT' ? (
        <div className="grid gap-4 border-t border-black/10 pt-6 sm:grid-cols-2">
          <label className="sm:col-span-2">
            <span className="mb-2 block text-xs font-semibold text-black/65">Nome completo</span>
            <input name="name" required maxLength={100} autoComplete="name" aria-invalid={Boolean(state.fieldErrors?.name)} aria-describedby={state.fieldErrors?.name ? 'invitation-name-error' : undefined} className="min-h-12 w-full rounded-xl border border-black/15 bg-white px-4 text-sm outline-none focus:border-[#18864b]" />
            <FieldError id="invitation-name-error" errors={state.fieldErrors?.name} />
          </label>
          <label>
            <span className="mb-2 block text-xs font-semibold text-black/65">Crie uma senha</span>
            <input name="password" type="password" required minLength={8} maxLength={128} autoComplete="new-password" aria-invalid={Boolean(state.fieldErrors?.password)} aria-describedby={state.fieldErrors?.password ? 'invitation-password-help invitation-password-error' : 'invitation-password-help'} className="min-h-12 w-full rounded-xl border border-black/15 bg-white px-4 text-sm outline-none focus:border-[#18864b]" />
            <span id="invitation-password-help" className="mt-1 block text-xs text-black/55">Use pelo menos 8 caracteres.</span>
            <FieldError id="invitation-password-error" errors={state.fieldErrors?.password} />
          </label>
          <label>
            <span className="mb-2 block text-xs font-semibold text-black/65">Confirme a senha</span>
            <input name="confirmPassword" type="password" required minLength={8} maxLength={128} autoComplete="new-password" aria-invalid={Boolean(state.fieldErrors?.confirmPassword)} aria-describedby={state.fieldErrors?.confirmPassword ? 'invitation-confirm-password-error' : undefined} className="min-h-12 w-full rounded-xl border border-black/15 bg-white px-4 text-sm outline-none focus:border-[#18864b]" />
            <FieldError id="invitation-confirm-password-error" errors={state.fieldErrors?.confirmPassword} />
          </label>
        </div>
      ) : null}

      {plan === 'AGENCY' ? (
        ownedAgencyName ? (
          <div className="rounded-xl border border-black/10 bg-white px-4 py-3 text-sm text-black/65">
            Sua agência <strong className="text-black">{ownedAgencyName}</strong> será conectada abaixo da agência que enviou o convite.
          </div>
        ) : (
          <label className="block">
            <span className="mb-2 block text-xs font-semibold text-black/65">Nome da sua agência</span>
            <input name="agencyName" required maxLength={120} autoComplete="organization" aria-invalid={Boolean(state.fieldErrors?.agencyName)} aria-describedby={state.fieldErrors?.agencyName ? 'invitation-agency-name-error' : undefined} className="min-h-12 w-full rounded-xl border border-black/15 bg-white px-4 text-sm outline-none focus:border-[#18864b]" />
            <FieldError id="invitation-agency-name-error" errors={state.fieldErrors?.agencyName} />
          </label>
        )
      ) : (
        <input type="hidden" name="agencyName" value="" />
      )}

      <label className="flex items-start gap-3 text-xs leading-5 text-black/60">
        <input type="checkbox" name="acceptedTerms" required aria-invalid={Boolean(state.fieldErrors?.acceptedTerms)} aria-describedby={state.fieldErrors?.acceptedTerms ? 'invitation-terms-error' : undefined} className="mt-1 h-4 w-4 accent-[#18864b]" />
        <span>
          {fixedPlan
            ? 'Confirmo o acesso definido e o uso dos meus dados conforme a '
            : 'Confirmo a escolha do plano e o uso dos meus dados conforme a '}
          <Link href="/privacy" className="font-semibold text-[#12693b] underline underline-offset-2">Política de Privacidade</Link>.
        </span>
      </label>
      <FieldError id="invitation-terms-error" errors={state.fieldErrors?.acceptedTerms} />

      <div className="rounded-xl border border-[#a15c00]/20 bg-[#fff8e8] px-4 py-3 text-xs leading-5 text-[#704000]">
        {simulationEnabled
          ? 'Ambiente local de demonstração: o plano ficará ativo por 30 dias sem cobrança real. Em produção, a ativação dependerá da confirmação do provedor de pagamento.'
          : 'Você será direcionado ao checkout seguro da Stripe. A conta e o vínculo só serão criados após a confirmação do pagamento.'}
      </div>

      {state.status === 'error' ? (
        <p role="alert" className="rounded-xl border border-[#b42318]/20 bg-[#fff2ef] px-4 py-3 text-sm leading-6 text-[#7a271a]">{state.message}</p>
      ) : null}

      <SubmitButton
        disabled={plan === ''}
        fixedAccess={Boolean(fixedPlan)}
        simulationEnabled={simulationEnabled}
      />
    </form>
  )
}
