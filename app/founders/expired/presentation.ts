import type { FounderAccessResolution } from '@/lib/founder-access'
import type { UserLanguage } from '@/lib/i18n/config'
import { localize } from '@/lib/i18n/catalog'
import type { PlatformPlanName } from '@/lib/plans'

type AccessPresentationInput = Pick<
  FounderAccessResolution,
  'source' | 'requiredPlan' | 'accountType' | 'invitingAgencyName'
> & { paymentRequiredAt?: Date | null }

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
  accessEndLabel: string,
  language: UserLanguage = 'PT',
): AccessRequiredPresentation {
  const copy = (portuguese: string, english: string) => localize(language, portuguese, english)
  const plan = resolveRequiredPlan(access)
  const planLabel = plan === 'AGENCY'
    ? copy('Plano Agência', 'Agency plan')
    : plan === 'AGENT_AGENCY_MEMBER'
      ? copy('Plano Agente Convidado', 'Invited agent plan')
      : copy('Plano Agente', 'Agent plan')

  if (access.source === 'ADMIN_PROVISIONED') {
    const manuallyRequired = access.paymentRequiredAt !== null
    return {
      plan,
      programLabel: copy('Acesso Keepr One', 'Keepr One access'),
      eyebrow: manuallyRequired
        ? copy('Pagamento necessário', 'Payment required')
        : copy('Período de teste concluído', 'Free trial ended'),
      description: manuallyRequired
        ? copy(
            `Ative o ${planLabel} para continuar. Seus dados permanecem salvos e o acesso aos módulos volta assim que o pagamento for confirmado.`,
            `Activate the ${planLabel} to continue. Your data remains saved and module access returns as soon as payment is confirmed.`,
          )
        : copy(
            `Seu período de teste terminou em ${accessEndLabel}. Seus dados permanecem salvos; ative o ${planLabel} para voltar a usar seus módulos.`,
            `Your free trial ended on ${accessEndLabel}. Your data remains saved; activate the ${planLabel} to use your modules again.`,
          ),
      planLabel,
      profileBenefit: copy(
        'Os módulos liberados pela Keepr One serão restaurados automaticamente.',
        'Modules enabled by Keepr One will be restored automatically.',
      ),
    }
  }

  if (access.source === 'AGENCY_INVITATION') {
    const agencyName = access.invitingAgencyName
      ? copy(` pela ${access.invitingAgencyName}`, ` by ${access.invitingAgencyName}`)
      : ''
    const description = plan === 'AGENCY'
      ? copy(
          `O Plano Agência escolhido no convite${agencyName} está sem uma assinatura ativa. Seus dados e sua posição na estrutura continuam preservados; ative o plano para voltar ao trabalho.`,
          `The Agency plan selected in the invitation${agencyName} does not have an active subscription. Your data and position in the structure remain preserved; activate the plan to return to work.`,
        )
      : copy(
          `Seu Plano Agente Convidado${agencyName} está sem uma assinatura ativa. Seus dados e seu vínculo com a agência continuam preservados; ative o plano para voltar ao trabalho.`,
          `Your Invited agent plan${agencyName} does not have an active subscription. Your data and agency connection remain preserved; activate the plan to return to work.`,
        )

    return {
      plan,
      programLabel: copy('Acesso por convite', 'Invitation access'),
      eyebrow: copy('Assinatura precisa de atenção', 'Subscription needs attention'),
      description,
      planLabel,
      profileBenefit: plan === 'AGENCY'
        ? copy(
            'Sua agência e a posição dela na árvore permanecem registradas.',
            'Your agency and its position in the tree remain recorded.',
          )
        : copy(
            'Seu vínculo com a agência que fez o convite permanece registrado.',
            'Your connection to the inviting agency remains recorded.',
          ),
    }
  }

  return {
    plan,
    programLabel: copy('Programa Founders', 'Founders Program'),
    eyebrow: copy('30 dias concluídos', '30 days completed'),
    description: copy(
      `Seu acesso Founder terminou em ${accessEndLabel}. Seus dados continuam preservados; para voltar ao trabalho, ative a assinatura do plano escolhido.`,
      `Your Founder access ended on ${accessEndLabel}. Your data remains preserved; activate the selected plan subscription to return to work.`,
    ),
    planLabel,
    profileBenefit: copy(
      'Você continua no perfil escolhido no cadastro.',
      'You keep the profile selected during registration.',
    ),
  }
}
