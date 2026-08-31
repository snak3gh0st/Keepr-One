// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { KBotActivity, KBotAvatar, KBotCornerPresence, KBotTaskTrail } from './KBotAvatar'

vi.mock('@/components/i18n/LanguageProvider', () => ({
  useI18n: () => ({
    language: 'EN',
    locale: 'en-US',
    copy: (_pt: string, en: string, values: Record<string, string | number> = {}) =>
      en.replace(/\{(\w+)\}/g, (_match, token: string) => String(values[token] ?? `{${token}}`)),
  }),
}))

afterEach(cleanup)

describe('KBotAvatar', () => {
  it('keeps the drawing decorative because adjacent text carries the state', () => {
    const { container } = render(<KBotAvatar state="working" />)
    expect(container.querySelector('[data-state="working"]')).toHaveAttribute('aria-hidden', 'true')
  })

  it('announces a working task without presenting a chat interface', () => {
    render(
      <KBotActivity
        state="working"
        title="K-Bot is syncing your book"
        detail="Lendo apólices vigentes"
        estimate="Estimativa: 12–16 minutos"
      />,
    )

    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(status).toHaveTextContent('K-Bot is syncing your book')
    expect(status).not.toHaveTextContent(/mensagem|pergunte|chat/i)
  })

  it('marks only the real current operational step', () => {
    render(<KBotTaskTrail label="K-Bot progress" steps={['Open', 'Read', 'Save']} currentIndex={1} />)
    expect(screen.getByRole('list', { name: 'K-Bot progress' })).toBeTruthy()
    expect(screen.getByText('Read').closest('li')).toHaveAttribute('aria-current', 'step')
    expect(screen.getByText('Open').closest('li')).not.toHaveAttribute('aria-current')
  })

  it('opens a compact activity panel without becoming a chat interface', async () => {
    render(
      <KBotCornerPresence
        state="working"
        title="K-Bot is working"
        detail="Collecting your National Life information"
        activity="combined"
        progress={1 / 3}
        secondaryState="working"
        tasks={[
          {
            id: 'sync',
            label: 'Updating your data',
            detail: '3 of 9 areas checked',
            state: 'working',
            progress: 1 / 3,
          },
          {
            id: 'illustration',
            label: 'Preparing your illustration',
            detail: 'National Life is calculating the values and the PDF',
            state: 'working',
          },
        ]}
      />,
    )

    const status = screen.getByLabelText('K-Bot status')
    expect(status).toHaveAttribute('data-state', 'working')
    expect(status).toHaveTextContent('K-Bot is working')
    expect(status.querySelector('[data-kbot-character="true"]')).toHaveAttribute('data-state', 'working')
    expect(status.querySelector('[data-kbot-character="true"]')).toHaveAttribute('data-activity', 'combined')
    expect(status.querySelector('[data-kbot-paper="true"]')).toBeInTheDocument()
    expect(screen.getByLabelText('Sync progress: 33%')).toBeInTheDocument()
    expect(screen.getByLabelText('Illustration in progress')).toBeInTheDocument()
    const trigger = screen.getByRole('button', { name: 'View K-Bot activity' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('What I am doing')).not.toBeInTheDocument()

    await userEvent.click(trigger)

    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('What I am doing')).toBeInTheDocument()
    expect(screen.getByText('Updating your data')).toBeInTheDocument()
    expect(screen.getByText('Preparing your illustration')).toBeInTheDocument()
    expect(screen.queryByText(/chat|message/i)).not.toBeInTheDocument()
  })

  it('anchors a temporary update beside the avatar', () => {
    render(
      <KBotCornerPresence
        state="success"
        title="Tudo pronto"
        announcement="Your official illustration is ready."
      />,
    )

    expect(screen.getByRole('status', { name: 'K-Bot update' })).toHaveTextContent(
      'Your official illustration is ready.',
    )
  })

  it('shows a sad pixel expression when K-Bot is disconnected', () => {
    render(
      <KBotCornerPresence
        state="error"
        title="K-Bot needs attention"
        detail="Connect this computer again."
      />,
    )

    expect(screen.getByLabelText('K-Bot status').querySelector('[data-kbot-character="true"]')).toHaveAttribute(
      'data-expression',
      'sad',
    )
  })
})
