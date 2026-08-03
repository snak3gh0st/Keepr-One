// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NationalLifeSyncStatus } from '@/lib/national-life/sync-run-service'
import { NationalLifeSyncProgress } from './NationalLifeSyncProgress'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function status(overrides: Partial<NationalLifeSyncStatus> = {}): NationalLifeSyncStatus {
  return {
    runId: 'run-1',
    state: 'RUNNING',
    completed: 0,
    total: 9,
    percent: 0,
    failed: 0,
    currentGridKey: 'NEW_BUSINESS',
    currentGridLabel: 'novos negócios',
    safeErrorCode: null,
    shouldPoll: true,
    completedAt: null,
    ...overrides,
  }
}

function answerWith(value: unknown) {
  const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ run: value }) }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('NationalLifeSyncProgress', () => {
  it('is mounted on the National Life connection page', () => {
    const page = readFileSync(
      resolve(process.cwd(), 'app/agent/integrations/national-life/page.tsx'),
      'utf8',
    )
    expect(page).toContain('<NationalLifeSyncProgress')
  })

  it('shows real stage progress and current area', async () => {
    answerWith(status({ completed: 3, percent: 33, currentGridLabel: 'correspondências' }))
    render(
      <NationalLifeSyncProgress
        initialStatus={status({ completed: 3, percent: 33, currentGridLabel: 'correspondências' })}
      />,
    )

    expect(screen.getByText('Atualizando dados da seguradora')).toBeTruthy()
    expect(screen.getByText('3 de 9 áreas atualizadas')).toBeTruthy()
    expect(screen.getByText('Agora: correspondências')).toBeTruthy()
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '3')
    expect(screen.getByRole('progressbar')).toHaveAttribute('max', '9')
  })

  it('stops polling after the run reaches a terminal state', async () => {
    vi.useFakeTimers()
    const fetchMock = answerWith(status({ completed: 9, percent: 100, state: 'COMPLETED', shouldPoll: false }))
    render(<NationalLifeSyncProgress initialStatus={status({ state: 'COMPLETED', completed: 9, percent: 100, shouldPoll: false })} />)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000)
    })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.getByText('Dados atualizados')).toBeTruthy()
  })

  it('explains a paused run without exposing its internal error code', async () => {
    answerWith(status({ state: 'PAUSED', safeErrorCode: 'AUTHENTICATION_STATE_INVALID' }))
    render(
      <NationalLifeSyncProgress
        initialStatus={status({ state: 'PAUSED', safeErrorCode: 'AUTHENTICATION_STATE_INVALID' })}
      />,
    )

    expect(screen.getByText('Conecte a National Life para continuar.')).toBeTruthy()
    expect(screen.queryByText('AUTHENTICATION_STATE_INVALID')).toBeNull()
    await waitFor(() => expect(screen.getByText('0 de 9 áreas atualizadas')).toBeTruthy())
  })
})
