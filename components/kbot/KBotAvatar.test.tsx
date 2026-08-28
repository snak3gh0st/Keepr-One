// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { KBotActivity, KBotAvatar, KBotCornerPresence, KBotTaskTrail } from './KBotAvatar'

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
        title="K-Bot está sincronizando sua carteira"
        detail="Lendo apólices vigentes"
        estimate="Estimativa: 12–16 minutos"
      />,
    )

    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(status).toHaveTextContent('K-Bot está sincronizando sua carteira')
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
      />,
    )

    const status = screen.getByLabelText('K-Bot status')
    expect(status).toHaveAttribute('data-state', 'working')
    expect(status).toHaveTextContent('K-Bot is working')
    expect(status.querySelector('[data-kbot-character="true"]')).toHaveAttribute('data-state', 'working')
    const trigger = screen.getByRole('button', { name: 'Show K-Bot activity' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('K-Bot activity')).not.toBeInTheDocument()

    await userEvent.click(trigger)

    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('K-Bot activity')).toBeInTheDocument()
    expect(screen.queryByText(/chat|message/i)).not.toBeInTheDocument()
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
