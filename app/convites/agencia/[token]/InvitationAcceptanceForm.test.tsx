// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./actions', () => ({
  acceptAgencyInvitationAction: vi.fn(),
  INITIAL_AGENCY_INVITATION_ACCEPTANCE_STATE: { status: 'idle', message: '' },
}))

vi.mock('@/lib/auth-client', () => ({
  authClient: { signOut: vi.fn() },
}))

import { InvitationAcceptanceForm } from './InvitationAcceptanceForm'

const token = 'a'.repeat(43)

afterEach(() => cleanup())

describe('InvitationAcceptanceForm', () => {
  it('shows both server-defined plan prices and collects agency identity only for the agency choice', async () => {
    const user = userEvent.setup()
    render(
      <InvitationAcceptanceForm
        token={token}
        invitedEmail="invitee@example.com"
        accountGate="NEW_ACCOUNT"
        ownedAgencyName={null}
        allowedPlans={['AGENT_AGENCY_MEMBER', 'AGENCY']}
        monthlyPriceCents={4_990}
        planRestriction={null}
        simulationEnabled
      />,
    )

    expect(screen.getByRole('radio', { name: /Agente convidado/i })).not.toBeChecked()
    expect(screen.getByRole('radio', { name: /Plano Agência/i })).not.toBeChecked()
    expect(screen.getByText(/US\$\s*49,90/)).toBeVisible()
    expect(screen.getByText(/US\$\s*89,90/)).toBeVisible()
    expect(screen.getAllByText(/US\$\s*10,00 de desconto mensal/i)).toHaveLength(2)
    expect(screen.queryByLabelText('Nome da sua agência')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Nome completo')).toBeRequired()
    expect(screen.getByRole('button', { name: 'Confirmar plano e entrar na estrutura' })).toBeDisabled()

    await user.click(screen.getByRole('radio', { name: /Plano Agência/i }))
    expect(screen.getByLabelText('Nome da sua agência')).toBeRequired()
    expect(screen.getByRole('button', { name: 'Confirmar plano e entrar na estrutura' })).toBeEnabled()
    expect(screen.getByText(/sem cobrança real/i)).toBeVisible()
  })

  it('locks the plan selected by the inviting agency while preserving legacy invitations', () => {
    const { container } = render(
      <InvitationAcceptanceForm
        token={token}
        invitedEmail="invitee@example.com"
        accountGate="NEW_ACCOUNT"
        ownedAgencyName={null}
        allowedPlans={['AGENT_AGENCY_MEMBER']}
        intendedType="AGENT"
        monthlyPriceCents={4_990}
        planRestriction={null}
        simulationEnabled
      />,
    )

    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    expect(screen.getByText('Acesso definido neste convite')).toBeVisible()
    expect(screen.getByText('Definido pela agência')).toBeVisible()
    expect(container.querySelector<HTMLInputElement>('input[name="plan"]')).toHaveValue('AGENT_AGENCY_MEMBER')
    expect(screen.queryByLabelText('Nome da sua agência')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirmar acesso e entrar na estrutura' })).toBeEnabled()
  })

  it('fails closed when the account is incompatible with the intended type', () => {
    render(
      <InvitationAcceptanceForm
        token={token}
        invitedEmail="owner@example.com"
        accountGate="READY"
        ownedAgencyName="Agência Existente"
        allowedPlans={[]}
        intendedType="AGENT"
        monthlyPriceCents={4_990}
        planRestriction="OWNED_AGENCY"
        simulationEnabled
      />,
    )

    expect(screen.getByText(/convite foi emitido para Agente/i)).toBeVisible()
    expect(screen.queryByRole('button', { name: /Confirmar (plano|acesso) e entrar na estrutura/ })).not.toBeInTheDocument()
  })

  it('explains the consented conversion from direct agent to subagency', () => {
    render(
      <InvitationAcceptanceForm
        token={token}
        invitedEmail="member@example.com"
        accountGate="READY"
        ownedAgencyName={null}
        allowedPlans={['AGENCY']}
        intendedType="AGENCY"
        monthlyPriceCents={8_990}
        planRestriction="PROMOTE_DIRECT_MEMBER"
        simulationEnabled
      />,
    )

    expect(screen.getByText(/vínculo atual de agente.*será convertido em uma subagência/i)).toBeVisible()
    expect(screen.getByText(/US\$\s*89,90/)).toBeVisible()
    expect(screen.getByText(/US\$\s*10,00 de desconto mensal/i)).toBeVisible()
    expect(screen.getByLabelText('Nome da sua agência')).toBeRequired()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirmar acesso e entrar na estrutura' })).toBeEnabled()
  })

  it('fails closed visually when local billing simulation is not enabled', () => {
    render(
      <InvitationAcceptanceForm
        token={token}
        invitedEmail="invitee@example.com"
        accountGate="READY"
        ownedAgencyName={null}
        allowedPlans={['AGENT_AGENCY_MEMBER', 'AGENCY']}
        monthlyPriceCents={4_990}
        planRestriction={null}
        simulationEnabled={false}
      />,
    )

    expect(screen.getByRole('button', { name: 'Confirmar plano e entrar na estrutura' })).toBeDisabled()
    expect(screen.getByText(/não há um provedor de pagamento confirmado/i)).toBeVisible()
  })

  it('requires an existing invitee to authenticate and preserves the invitation return path', () => {
    render(
      <InvitationAcceptanceForm
        token={token}
        invitedEmail="invitee@example.com"
        accountGate="SIGN_IN"
        ownedAgencyName={null}
        allowedPlans={['AGENT_AGENCY_MEMBER', 'AGENCY']}
        monthlyPriceCents={4_990}
        planRestriction={null}
        simulationEnabled
      />,
    )

    const link = screen.getByRole('link', { name: 'Entrar e voltar ao convite' })
    expect(link).toHaveAttribute('href', expect.stringContaining('email=invitee%40example.com'))
    expect(link).toHaveAttribute('href', expect.stringContaining(`next=%2Fconvites%2Fagencia%2F${token}`))
    expect(screen.queryByRole('button', { name: /Confirmar (plano|acesso) e entrar na estrutura/ })).not.toBeInTheDocument()
  })

  it('allows only the agency plan for an existing agency owner and explains why', () => {
    render(
      <InvitationAcceptanceForm
        token={token}
        invitedEmail="owner@example.com"
        accountGate="READY"
        ownedAgencyName="Agência Existente"
        allowedPlans={['AGENCY']}
        monthlyPriceCents={4_990}
        planRestriction="OWNED_AGENCY"
        simulationEnabled
      />,
    )

    expect(screen.getByRole('radio', { name: /Agente convidado/i })).toBeDisabled()
    expect(screen.getByRole('radio', { name: /Plano Agência/i })).toBeChecked()
    expect(screen.getByText(/somente o plano Agência é compatível/i)).toBeVisible()
    expect(screen.getByText(/Agência Existente/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Confirmar plano e entrar na estrutura' })).toBeEnabled()
  })

  it('allows only the agency plan for an existing Founder account', () => {
    render(
      <InvitationAcceptanceForm
        token={token}
        invitedEmail="founder@example.com"
        accountGate="READY"
        ownedAgencyName={null}
        allowedPlans={['AGENCY']}
        monthlyPriceCents={4_990}
        planRestriction="FOUNDER"
        simulationEnabled
      />,
    )

    expect(screen.getByRole('radio', { name: /Agente convidado/i })).toBeDisabled()
    expect(screen.getByRole('radio', { name: /Plano Agência/i })).toBeChecked()
    expect(screen.getByText(/conta Founder existente entra neste convite pelo plano Agência/i)).toBeVisible()
    expect(screen.getByLabelText('Nome da sua agência')).toBeRequired()
  })
})
