// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NationalLifeSyncStatus } from '@/lib/national-life/sync-run-service'
import {
  NATIONAL_LIFE_SYNC_STARTED_EVENT,
  NationalLifeSyncProgress,
} from './NationalLifeSyncProgress'

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
    total: 13,
    percent: 0,
    failed: 0,
    currentGridKey: 'NEW_BUSINESS',
    currentGridLabel: 'new business',
    safeErrorCode: null,
    shouldPoll: true,
    completedAt: null,
    receivedRecords: null,
    writtenRecords: null,
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
    answerWith(status({ completed: 3, percent: 33, currentGridLabel: 'correspondence' }))
    render(
      <NationalLifeSyncProgress
        initialStatus={status({ completed: 3, percent: 33, currentGridLabel: 'correspondence' })}
      />,
    )

    expect(screen.getByText('Updating your National Life data')).toBeTruthy()
    expect(screen.getByText('3 of 13 areas updated')).toBeTruthy()
    expect(screen.getByText('Now reading and saving: correspondence')).toBeTruthy()
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '3')
    expect(screen.getByRole('progressbar')).toHaveAttribute('max', '13')
  })

  it('stops polling after the run reaches a terminal state', async () => {
    vi.useFakeTimers()
    const fetchMock = answerWith(status({ completed: 13, percent: 100, state: 'COMPLETED', shouldPoll: false }))
    render(<NationalLifeSyncProgress initialStatus={status({ state: 'COMPLETED', completed: 13, percent: 100, shouldPoll: false })} />)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000)
    })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.getByText('Your National Life data')).toBeTruthy()
  })

  it('explains a paused run without exposing its internal error code', async () => {
    answerWith(status({ state: 'PAUSED', safeErrorCode: 'AUTHENTICATION_STATE_INVALID' }))
    render(
      <NationalLifeSyncProgress
        initialStatus={status({ state: 'PAUSED', safeErrorCode: 'AUTHENTICATION_STATE_INVALID' })}
      />,
    )

    expect(screen.getByText('Sign in to National Life to keep going.')).toBeTruthy()
    expect(screen.queryByText('AUTHENTICATION_STATE_INVALID')).toBeNull()
    await waitFor(() => expect(screen.getByText('0 of 13 areas updated')).toBeTruthy())
  })

  it('dates the last sync instead of saying "done" forever', () => {
    render(
      <NationalLifeSyncProgress
        initialStatus={status({
          state: 'COMPLETED',
          shouldPoll: false,
          completed: 13,
          percent: 100,
          currentGridLabel: null,
          completedAt: new Date('2026-08-04T18:30:00.000Z'),
          receivedRecords: 240,
          writtenRecords: 238,
        })}
      />,
    )

    expect(screen.getByText(/Last synced/)).toBeTruthy()
    expect(screen.getByText('238 records saved to Keepr One.')).toBeTruthy()
  })

  it('refuses to call an empty write a success', () => {
    // O recibo já sabia "recebi 240, escrevi 0". Sem mostrar isso, a tela dizia
    // "dados atualizados" para um sync que não trouxe nada.
    render(
      <NationalLifeSyncProgress
        initialStatus={status({
          state: 'COMPLETED',
          shouldPoll: false,
          completed: 13,
          percent: 100,
          currentGridLabel: null,
          completedAt: new Date('2026-08-04T18:30:00.000Z'),
          receivedRecords: 240,
          writtenRecords: 0,
        })}
      />,
    )

    expect(screen.getByText(/none of them could be saved/)).toBeTruthy()
  })

  it('claims nothing about records when there is no receipt to read', () => {
    render(
      <NationalLifeSyncProgress
        initialStatus={status({
          state: 'COMPLETED',
          shouldPoll: false,
          completed: 13,
          percent: 100,
          currentGridLabel: null,
          receivedRecords: null,
          writtenRecords: null,
        })}
      />,
    )

    expect(screen.getByText('100% done')).toBeTruthy()
  })

  it('claims nothing about records while the run is still going', () => {
    render(
      <NationalLifeSyncProgress
        initialStatus={status({
          state: 'RUNNING',
          shouldPoll: true,
          currentGridLabel: null,
          receivedRecords: 0,
          writtenRecords: 0,
        })}
      />,
    )

    expect(screen.queryByText(/nothing new to send/)).toBeNull()
    expect(screen.queryByText(/could be saved/)).toBeNull()
    expect(screen.getByText('0% done')).toBeTruthy()
  })

  it('shows a ready state and starts polling when the card starts a new sync', async () => {
    const fetchMock = answerWith(status({ completed: 1, percent: 11, currentGridLabel: 'new business' }))
    render(<NationalLifeSyncProgress initialStatus={null} />)

    expect(screen.getByText('Ready to bring National Life into Keepr One')).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()

    window.dispatchEvent(new Event(NATIONAL_LIFE_SYNC_STARTED_EVENT))

    await waitFor(() => expect(screen.getByText('1 of 13 areas updated')).toBeTruthy())
    expect(screen.getByText('Now reading and saving: new business')).toBeTruthy()
  })
})
