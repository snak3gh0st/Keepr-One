import { describe, expect, it } from 'vitest'
import { formatPlatformPlanPrice } from '@/lib/plans'
import { buildAccessRequiredPresentation } from './presentation'

describe('access-required presentation', () => {
  it('shows the discounted invited-agent plan and names the inviting agency', () => {
    const presentation = buildAccessRequiredPresentation({
      source: 'AGENCY_INVITATION',
      requiredPlan: 'AGENT_AGENCY_MEMBER',
      accountType: 'AGENT',
      invitingAgencyName: 'Agência Aurora',
    }, 'unused')

    expect(presentation).toMatchObject({
      plan: 'AGENT_AGENCY_MEMBER',
      programLabel: 'Acesso por convite',
      planLabel: 'Plano Agente Convidado',
    })
    expect(presentation.description).toContain('Agência Aurora')
    expect(presentation.description).not.toMatch(/Founder/i)
    expect(formatPlatformPlanPrice(presentation.plan, 'en-US')).toBe('$49.90')
  })

  it('shows the agency price when the invitee chose to create an agency', () => {
    const presentation = buildAccessRequiredPresentation({
      source: 'AGENCY_INVITATION',
      requiredPlan: 'AGENCY',
      accountType: 'AGENCY',
      invitingAgencyName: 'Agência Aurora',
    }, 'unused')

    expect(presentation).toMatchObject({
      plan: 'AGENCY',
      planLabel: 'Plano Agência',
    })
    expect(presentation.profileBenefit).toMatch(/árvore/i)
    expect(formatPlatformPlanPrice(presentation.plan, 'en-US')).toBe('$99.90')
  })

  it('preserves the Founder copy and individual plan price', () => {
    const presentation = buildAccessRequiredPresentation({
      source: 'FOUNDER',
      requiredPlan: 'AGENT_INDIVIDUAL',
      accountType: 'AGENT',
      invitingAgencyName: null,
    }, '30 de agosto de 2026')

    expect(presentation).toMatchObject({
      plan: 'AGENT_INDIVIDUAL',
      programLabel: 'Programa Founders',
      eyebrow: '30 dias concluídos',
      planLabel: 'Plano Agente',
    })
    expect(presentation.description).toContain('30 de agosto de 2026')
    expect(formatPlatformPlanPrice(presentation.plan, 'en-US')).toBe('$59.90')
  })

  it('explains an administratively required payment without Founder copy', () => {
    const presentation = buildAccessRequiredPresentation({
      source: 'ADMIN_PROVISIONED',
      requiredPlan: 'AGENCY',
      accountType: 'AGENCY',
      invitingAgencyName: null,
      paymentRequiredAt: new Date('2026-09-02T12:00:00.000Z'),
    }, '2 de setembro de 2026')

    expect(presentation).toMatchObject({
      plan: 'AGENCY',
      programLabel: 'Acesso Keepr One',
      eyebrow: 'Pagamento necessário',
      planLabel: 'Plano Agência',
    })
    expect(presentation.description).toContain('permanecem salvos')
    expect(presentation.description).not.toMatch(/Founder/i)
  })

  it('shows the custom end date when an administrative trial expires naturally', () => {
    const presentation = buildAccessRequiredPresentation({
      source: 'ADMIN_PROVISIONED',
      requiredPlan: 'AGENT_INDIVIDUAL',
      accountType: 'AGENT',
      invitingAgencyName: null,
      paymentRequiredAt: null,
    }, '15 de setembro de 2026')

    expect(presentation.eyebrow).toBe('Período de teste concluído')
    expect(presentation.description).toContain('15 de setembro de 2026')
  })

  it('localizes invitation and Founder presentations in English', () => {
    const invited = buildAccessRequiredPresentation({
      source: 'AGENCY_INVITATION',
      requiredPlan: 'AGENT_AGENCY_MEMBER',
      accountType: 'AGENT',
      invitingAgencyName: 'Aurora Agency',
    }, 'unused', 'EN')

    expect(invited).toMatchObject({
      programLabel: 'Invitation access',
      eyebrow: 'Subscription needs attention',
      planLabel: 'Invited agent plan',
    })
    expect(invited.description).toContain('by Aurora Agency')
    expect(invited.profileBenefit).toContain('inviting agency')

    const founder = buildAccessRequiredPresentation({
      source: 'FOUNDER',
      requiredPlan: 'AGENT_INDIVIDUAL',
      accountType: 'AGENT',
      invitingAgencyName: null,
    }, 'August 30, 2026', 'EN')

    expect(founder).toMatchObject({
      programLabel: 'Founders Program',
      eyebrow: '30 days completed',
      planLabel: 'Agent plan',
    })
    expect(founder.description).toContain('August 30, 2026')
  })
})
