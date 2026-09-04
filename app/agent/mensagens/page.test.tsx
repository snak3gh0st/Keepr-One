// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCurrentAgent: vi.fn(),
  getCurrentSession: vi.fn(),
  findUser: vi.fn(),
  findMessagingAccount: vi.fn(),
  chatwootConfig: vi.fn(),
  provisionAgentInbox: vi.fn(),
  workspaceProps: vi.fn(),
}))

vi.mock('@/lib/agent-context', () => ({ getCurrentAgent: mocks.getCurrentAgent }))
vi.mock('@/lib/i18n/server', () => ({
  getCurrentSession: mocks.getCurrentSession,
  getServerI18n: async () => ({ copy: (portuguese: string) => portuguese }),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: mocks.findUser },
    agentMessagingAccount: { findUnique: mocks.findMessagingAccount },
  },
}))
vi.mock('@/lib/messaging/chatwoot-config', () => ({ chatwootConfigFromEnv: mocks.chatwootConfig }))
vi.mock('@/lib/messaging/provision-prisma', () => ({ prismaProvisionDeps: vi.fn(() => ({})) }))
vi.mock('@/lib/messaging/provision-agent-inbox', () => ({ provisionAgentInbox: mocks.provisionAgentInbox }))
vi.mock('@/lib/messaging/channel-mode', () => ({ whatsappChannelModeFromEnv: () => 'EVOLUTION' }))
vi.mock('@/components/Shell', () => ({ Shell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }))
vi.mock('@/components/PageHeader', () => ({ PageHeader: ({ title }: { title: string }) => <h1>{title}</h1> }))
vi.mock('@/components/Table', () => ({ EmptyState: ({ children }: { children: React.ReactNode }) => <div role="status">{children}</div> }))
vi.mock('./MessagingWorkspace', () => ({
  MessagingWorkspace: (props: unknown) => {
    mocks.workspaceProps(props)
    return <div data-testid="messaging-workspace" />
  },
}))

import MensagensPage from './page'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getCurrentAgent.mockResolvedValue({ id: 'agent-1', userId: 'user-1' })
  mocks.findUser.mockResolvedValue({ name: 'Ana', email: 'ana@example.com' })
  mocks.chatwootConfig.mockReturnValue({ baseUrl: 'https://chatwoot.test', platformToken: 'platform-token' })
  mocks.provisionAgentInbox.mockResolvedValue({ accountId: '15', userId: '44', created: true })
  mocks.getCurrentSession.mockResolvedValue({
    user: { id: 'user-1', role: 'AGENT' },
    session: { id: 'session-1', impersonatedBy: null },
  })
})

afterEach(() => cleanup())

describe('MensagensPage support preview', () => {
  it('does not provision a missing inbox while previewing an agent', async () => {
    mocks.getCurrentSession.mockResolvedValue({
      user: { id: 'user-1', role: 'AGENT' },
      session: { id: 'preview-1', impersonatedBy: 'admin-1' },
    })
    mocks.findMessagingAccount.mockResolvedValue(null)

    render(await MensagensPage())

    expect(mocks.findMessagingAccount).toHaveBeenCalledWith({
      where: { agentId: 'agent-1' },
      select: { externalUserToken: true },
    })
    expect(mocks.provisionAgentInbox).not.toHaveBeenCalled()
    expect(mocks.workspaceProps).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('modo de suporte')
  })

  it('uses an existing local token read-only without provisioning during preview', async () => {
    mocks.getCurrentSession.mockResolvedValue({
      user: { id: 'user-1', role: 'AGENT' },
      session: { id: 'preview-1', impersonatedBy: 'admin-1' },
    })
    mocks.findMessagingAccount.mockResolvedValue({ externalUserToken: 'stored-agent-token' })

    render(await MensagensPage())

    expect(mocks.provisionAgentInbox).not.toHaveBeenCalled()
    expect(mocks.workspaceProps).toHaveBeenCalledWith({ channelMode: 'EVOLUTION', readOnly: true })
  })

  it('keeps normal agent visits lazily provisioning the inbox', async () => {
    render(await MensagensPage())

    expect(mocks.findMessagingAccount).not.toHaveBeenCalled()
    expect(mocks.provisionAgentInbox).toHaveBeenCalledWith({}, {
      agentId: 'agent-1', agentName: 'Ana', agentEmail: 'ana@example.com',
    })
    expect(mocks.workspaceProps).toHaveBeenCalledWith({ channelMode: 'EVOLUTION', readOnly: false })
  })
})
