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
        title="K-Bot está trabalhando"
        detail="Buscando suas informações na National Life"
        activity="combined"
        progress={1 / 3}
        secondaryState="working"
        tasks={[
          {
            id: 'sync',
            label: 'Atualizando seus dados',
            detail: '3 de 9 áreas verificadas',
            state: 'working',
            progress: 1 / 3,
          },
          {
            id: 'illustration',
            label: 'Preparando sua ilustração',
            detail: 'A National Life está calculando os valores e o PDF',
            state: 'working',
          },
        ]}
      />,
    )

    const status = screen.getByLabelText('Status do K-Bot')
    expect(status).toHaveAttribute('data-state', 'working')
    expect(status).toHaveTextContent('K-Bot está trabalhando')
    expect(status.querySelector('[data-kbot-character="true"]')).toHaveAttribute('data-state', 'working')
    expect(status.querySelector('[data-kbot-character="true"]')).toHaveAttribute('data-activity', 'combined')
    expect(status.querySelector('[data-kbot-paper="true"]')).toBeInTheDocument()
    expect(screen.getByLabelText('Progresso do sync: 33%')).toBeInTheDocument()
    expect(screen.getByLabelText('Ilustração em andamento')).toBeInTheDocument()
    const trigger = screen.getByRole('button', { name: 'Ver atividade do K-Bot' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('O que estou fazendo')).not.toBeInTheDocument()

    await userEvent.click(trigger)

    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('O que estou fazendo')).toBeInTheDocument()
    expect(screen.getByText('Atualizando seus dados')).toBeInTheDocument()
    expect(screen.getByText('Preparando sua ilustração')).toBeInTheDocument()
    expect(screen.queryByText(/chat|message/i)).not.toBeInTheDocument()
  })

  it('anchors a temporary update beside the avatar', () => {
    render(
      <KBotCornerPresence
        state="success"
        title="Tudo pronto"
        announcement="Sua ilustração oficial já está disponível."
      />,
    )

    expect(screen.getByRole('status', { name: 'Atualização do K-Bot' })).toHaveTextContent(
      'Sua ilustração oficial já está disponível.',
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

    expect(screen.getByLabelText('Status do K-Bot').querySelector('[data-kbot-character="true"]')).toHaveAttribute(
      'data-expression',
      'sad',
    )
  })
})
