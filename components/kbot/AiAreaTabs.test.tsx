// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ pathname: '/agent/ai', modules: null as string[] | null }))

vi.mock('next/navigation', () => ({ usePathname: () => state.pathname }))
vi.mock('@/components/AgentAccessContext', () => ({
  useAgentAccessContext: () => (state.modules ? { enabledModules: state.modules } : null),
}))
vi.mock('@/components/i18n/LanguageProvider', () => ({
  useI18n: () => ({ copy: (_pt: string, en: string) => en }),
}))

import { AiAreaTabs } from './AiAreaTabs'

afterEach(() => {
  cleanup()
  state.pathname = '/agent/ai'
  state.modules = null
})

describe('AiAreaTabs', () => {
  it('links every K-Bot AI area, including the message center', () => {
    render(<AiAreaTabs />)

    expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute('href', '/agent/ai')
    expect(screen.getByRole('link', { name: 'Messages' })).toHaveAttribute('href', '/agent/ai/mensagens')
    expect(screen.getByRole('link', { name: 'AI follow-up' })).toHaveAttribute('href', '/agent/ai/acoes')
    expect(screen.getByRole('link', { name: 'Scheduled' })).toHaveAttribute('href', '/agent/ai/agendadas')
  })

  it('marks only the current area, without the overview swallowing its children', () => {
    state.pathname = '/agent/ai/mensagens'
    render(<AiAreaTabs />)

    expect(screen.getByRole('link', { name: 'Messages' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Overview' })).not.toHaveAttribute('aria-current')
  })

  it('shows no door to messages when the MESSAGES module is off', () => {
    state.modules = ['TODAY', 'CRM']
    render(<AiAreaTabs />)

    expect(screen.queryByRole('link', { name: 'Messages' })).toBeNull()
    expect(screen.getByRole('link', { name: 'AI follow-up' })).toBeTruthy()
  })
})
