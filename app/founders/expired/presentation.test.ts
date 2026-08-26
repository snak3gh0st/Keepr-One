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
})
