// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { KBotActivity, KBotAvatar, KBotCornerPresence, KBotTaskTrail } from './KBotAvatar'

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

  it('keeps a subtle animated presence in the corner without becoming a chat button', () => {
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
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
