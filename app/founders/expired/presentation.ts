import type { FounderAccessResolution } from '@/lib/founder-access'
import type { PlatformPlanName } from '@/lib/plans'

type AccessPresentationInput = Pick<
  FounderAccessResolution,
  'source' | 'requiredPlan' | 'accountType' | 'invitingAgencyName'
>

export type AccessRequiredPresentation = {
  plan: PlatformPlanName
  programLabel: string
  eyebrow: string
  description: string
  planLabel: string
  profileBenefit: string
}

function resolveRequiredPlan(access: AccessPresentationInput): PlatformPlanName {
  if (access.requiredPlan) return access.requiredPlan
  return access.accountType === 'AGENCY' ? 'AGENCY' : 'AGENT_INDIVIDUAL'
}

export function buildAccessRequiredPresentation(
  access: AccessPresentationInput,
  founderEndLabel: string,
): AccessRequiredPresentation {
  const plan = resolveRequiredPlan(access)
  const planLabel = plan === 'AGENCY'
    ? 'Plano Agência'
    : plan === 'AGENT_AGENCY_MEMBER'
      ? 'Plano Agente Convidado'
      : 'Plano Agente'

  if (access.source === 'AGENCY_INVITATION') {
    const agencyName = access.invitingAgencyName
      ? ` pela ${access.invitingAgencyName}`
      : ''
    const description = plan === 'AGENCY'
      ? `O Plano Agência escolhido no convite${agencyName} está sem uma assinatura ativa. Seus dados e sua posição na estrutura continuam preservados; ative o plano para voltar ao trabalho.`
      : `Seu Plano Agente Convidado${agencyName} está sem uma assinatura ativa. Seus dados e seu vínculo com a agência continuam preservados; ative o plano para voltar ao trabalho.`

    return {
      plan,
      programLabel: 'Acesso por convite',
      eyebrow: 'Assinatura precisa de atenção',
      description,
      planLabel,
      profileBenefit: plan === 'AGENCY'
        ? 'Sua agência e a posição dela na árvore permanecem registradas.'
        : 'Seu vínculo com a agência que fez o convite permanece registrado.',
    }
  }

  return {
    plan,
    programLabel: 'Programa Founders',
    eyebrow: '30 dias concluídos',
    description: `Seu acesso Founder terminou em ${founderEndLabel}. Seus dados continuam preservados; para voltar ao trabalho, ative a assinatura do plano escolhido.`,
    planLabel,
    profileBenefit: 'Você continua no perfil escolhido no cadastro.',
  }
}
