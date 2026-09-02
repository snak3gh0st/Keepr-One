// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
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

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

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

  it('offers the three safe K-Bot task entry points when idle', async () => {
    render(
      <KBotCornerPresence
        state="idle"
        title="K-Bot is ready"
        detail="Choose what you want me to do."
        quickActions={[
          { href: '/sync', badge: 'NL', label: 'Sync National Life', detail: 'Update carrier data' },
          { href: '/illustrations/new', badge: 'PDF', label: 'Create Illustration', detail: 'Term or IUL' },
          { href: '/illustrations?intent=application', badge: 'iGO', label: 'Create Application in iGO', detail: 'Choose an official illustration' },
        ]}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'View K-Bot activity' }))

    expect(screen.getByRole('navigation', { name: 'K-Bot actions' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Sync National Life/i })).toHaveAttribute('href', '/sync')
    expect(screen.getByRole('link', { name: /Create Illustration/i })).toHaveAttribute('href', '/illustrations/new')
    expect(screen.getByRole('link', { name: /Create Application in iGO/i })).toHaveAttribute(
      'href',
      '/illustrations?intent=application',
    )
  })

  it('moves focus into the task launcher and returns it on Escape', async () => {
    render(
      <KBotCornerPresence
        state="idle"
        title="K-Bot is ready"
        quickActions={[
          { href: '/sync', badge: 'NL', label: 'Sync National Life', detail: 'Update carrier data' },
        ]}
      />,
    )

    const trigger = screen.getByRole('button', { name: 'View K-Bot activity' })
    await userEvent.click(trigger)

    expect(screen.getByRole('link', { name: /Sync National Life/i })).toHaveFocus()
    await userEvent.keyboard('{Escape}')

    expect(screen.queryByLabelText('K-Bot activity panel')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
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

  it('announces title and detail without duplicate punctuation', () => {
    render(
      <KBotCornerPresence
        state="success"
        title="All set. I organized everything for you."
        detail="Your National Life information is up to date."
      />,
    )

    const status = screen.getByLabelText('K-Bot status')
    expect(status).toHaveTextContent(
      'All set. I organized everything for you. Your National Life information is up to date.',
    )
    expect(status).not.toHaveTextContent('you.. Your')
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

  it('shows a compact visual status glyph for attention states', () => {
    const { rerender } = render(
      <KBotCornerPresence state="waiting" title="K-Bot is waiting" detail="Complete MFA to continue." />,
    )

    expect(screen.getByLabelText('K-Bot status').querySelector('[data-kbot-status-glyph="waiting"]')).toBeInTheDocument()

    rerender(<KBotCornerPresence state="success" title="K-Bot finished" />)

    expect(screen.getByLabelText('K-Bot status').querySelector('[data-kbot-status-glyph="success"]')).toBeInTheDocument()
    expect(screen.getByLabelText('K-Bot status').querySelector('[data-kbot-celebration="true"]')).toBeInTheDocument()
  })

  it('lets the pixel eyes and head follow the mouse in discrete steps', () => {
    render(<KBotCornerPresence state="idle" title="K-Bot is ready" />)

    const trigger = screen.getByRole('button', { name: 'View K-Bot activity' })
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
      bottom: 102,
      height: 102,
      left: 0,
      right: 78,
      top: 0,
      width: 78,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })

    fireEvent.pointerMove(trigger, { clientX: 76, clientY: 2, pointerType: 'mouse' })

    expect(trigger.style.getPropertyValue('--kbot-head-x')).toBe('1px')
    expect(trigger.style.getPropertyValue('--kbot-head-y')).toBe('-1px')
    expect(trigger.style.getPropertyValue('--kbot-eye-x')).toBe('1px')
    expect(trigger.style.getPropertyValue('--kbot-eye-y')).toBe('-1px')

    fireEvent.pointerLeave(trigger, { pointerType: 'mouse' })

    expect(trigger.style.getPropertyValue('--kbot-head-x')).toBe('')
    expect(trigger.style.getPropertyValue('--kbot-eye-x')).toBe('')
  })

  it('offers useful actions occasionally while K-Bot is idle', () => {
    vi.useFakeTimers()
    render(
      <KBotCornerPresence
        state="idle"
        title="K-Bot is ready"
        ambientMessages={[
          {
            id: 'sync',
            message: 'I can sync your National Life data for you.',
            href: '/agent/integrations/national-life',
            actionLabel: 'Sync National Life',
          },
          {
            id: 'illustration',
            message: 'Would you like an official illustration?',
            href: '/agent/illustrations/new',
            actionLabel: 'Create Illustration',
          },
        ]}
      />,
    )

    expect(screen.queryByRole('status', { name: 'A K-Bot idea' })).not.toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(28_000)
    })

    expect(screen.getByRole('status', { name: 'A K-Bot idea' })).toHaveTextContent(
      'I can sync your National Life data for you.',
    )
    expect(screen.getByRole('link', { name: 'Sync National Life' })).toHaveAttribute(
      'href',
      '/agent/integrations/national-life',
    )

    act(() => {
      vi.advanceTimersByTime(8_000)
    })
    expect(screen.queryByRole('status', { name: 'A K-Bot idea' })).not.toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(67_000)
    })
    expect(screen.getByRole('status', { name: 'A K-Bot idea' })).toHaveTextContent(
      'Would you like an official illustration?',
    )
  })

  it('stays quiet with ambient messages while K-Bot is working', () => {
    vi.useFakeTimers()
    render(
      <KBotCornerPresence
        state="working"
        title="K-Bot is working"
        ambientMessages={[
          {
            id: 'sync',
            message: 'I can sync your National Life data for you.',
            href: '/agent/integrations/national-life',
            actionLabel: 'Sync National Life',
          },
        ]}
      />,
    )

    act(() => {
      vi.advanceTimersByTime(28_000)
    })

    expect(screen.queryByRole('status', { name: 'A K-Bot idea' })).not.toBeInTheDocument()
  })
})
