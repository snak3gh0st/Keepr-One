// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NationalLifeSyncStatus } from '@/lib/national-life/sync-run-service'
import {
  NATIONAL_LIFE_RETRY_REMAINING_EVENT,
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
    startedAt: new Date('2026-08-27T15:00:00.000Z'),
    completedAt: null,
    receivedRecords: null,
    writtenRecords: null,
    duplicateRecords: null,
    rejectedRecords: null,
    ...overrides,
  }
}

function answerWith(value: unknown) {
  const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ run: value }) }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('NationalLifeSyncProgress', () => {
  /// A bare "988 received, 823 saved" makes the agent guess whether 165 policies
  /// went missing. Repeats are how the source lists one policy per coverage and
  /// cost nothing; rows with no policy number are the only real loss. Naming the
  /// two separately is the difference between a number that alarms and a number
  /// that informs.
  it('explains the gap between received and saved rows', () => {
    render(<NationalLifeSyncProgress initialStatus={status({
      state: 'PARTIAL',
      shouldPoll: false,
      receivedRecords: 988,
      writtenRecords: 823,
      duplicateRecords: 155,
      rejectedRecords: 10,
    })} />)
    expect(document.body.textContent).toContain('155')
    expect(document.body.textContent).toContain('10')
    expect(document.body.textContent).toMatch(/repeat/i)
  })

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

    expect(screen.getByText('K-Bot is updating your National Life data')).toBeTruthy()
    expect(screen.getByText(
      'K-Bot is collecting correspondence from National Life. Everything already collected is safe.',
    )).toBeTruthy()
    expect(screen.getByText('3 of 13 portal areas checked')).toBeTruthy()
    expect(screen.getByText('Reading and saving correspondence.')).toBeTruthy()
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '3')
    expect(screen.getByRole('progressbar')).toHaveAttribute('max', '13')
  })

  it('shows an honest range based on comparable carrier runs', () => {
    render(<NationalLifeSyncProgress initialStatus={status({
      estimate: { lowerMinutes: 13, upperMinutes: 16, basisRuns: 2 },
    })} />)

    expect(screen.getByText('Typically about 13–16 min for the remaining areas')).toBeTruthy()
    expect(screen.getByText('Based on 2 recent syncs from this account')).toBeTruthy()
  })

  it('dates each completed source independently', () => {
    render(<NationalLifeSyncProgress initialStatus={status({
      state: 'PARTIAL',
      shouldPoll: false,
      stageCoverage: [{
        gridKey: 'NEW_BUSINESS',
        label: 'new business',
        state: 'VERIFIED',
        verifiedRecords: 856,
        verifiedAt: new Date('2026-08-27T15:28:00.000Z'),
      }, {
        gridKey: 'INFORCE_CLIENTS',
        label: 'in-force policies',
        state: 'FAILED',
        verifiedRecords: null,
        verifiedAt: null,
      }],
    })} />)

    expect(screen.getByText(/Confirmed by National Life/)).toBeTruthy()
    expect(screen.getByText('Last attempt needs retry')).toBeTruthy()
  })

  it('summarizes new and reconfirmed data without calling every saved row new', () => {
    render(<NationalLifeSyncProgress initialStatus={status({
      state: 'COMPLETED',
      shouldPoll: false,
      completed: 13,
      delta: { addedRecords: 5, refreshedRecords: 127, newCommissionAmount: 80.25 },
    })} />)

    expect(screen.getByText('5 new to Keepr One')).toBeTruthy()
    expect(screen.getByText('127 reconfirmed')).toBeTruthy()
    expect(screen.getByText('$80.25 in newly received commission entries')).toBeTruthy()
  })

  it('offers a one-click retry that keeps verified sources intact', () => {
    const retry = vi.fn()
    window.addEventListener(NATIONAL_LIFE_RETRY_REMAINING_EVENT, retry)
    render(<NationalLifeSyncProgress initialStatus={status({
      state: 'PARTIAL', shouldPoll: false, completed: 12, failed: 1,
    })} />)

    fireEvent.click(screen.getByRole('button', { name: 'Retry remaining source' }))

    expect(retry).toHaveBeenCalledOnce()
    window.removeEventListener(NATIONAL_LIFE_RETRY_REMAINING_EVENT, retry)
  })

  it('stops polling after the run reaches a terminal state', async () => {
    vi.useFakeTimers()
    const fetchMock = answerWith(status({ completed: 14, total: 14, percent: 100, state: 'COMPLETED', shouldPoll: false }))
    render(<NationalLifeSyncProgress initialStatus={status({ state: 'COMPLETED', completed: 14, total: 14, percent: 100, shouldPoll: false })} />)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000)
    })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.getByText('K-Bot finished updating your priority data')).toBeTruthy()
  })

  it('recognizes a completed personal-plan sync as current', () => {
    const personalPlan = [
      'NEW_BUSINESS',
      'RECENTLY_CLOSED',
      'INFORCE_CLIENTS',
      'PAID_COMMISSIONS',
      'COMMISSIONS_EARNING_REPORT',
      'CORRESPONDENCE',
    ]
    render(<NationalLifeSyncProgress initialStatus={status({
      state: 'COMPLETED',
      shouldPoll: false,
      completed: personalPlan.length,
      total: personalPlan.length,
      percent: 100,
      stageCoverage: personalPlan.map((gridKey) => ({
        gridKey,
        label: gridKey.toLowerCase(),
        state: 'VERIFIED' as const,
        verifiedRecords: 0,
      })),
    })} />)

    expect(screen.getByText('K-Bot finished updating your priority data')).toBeTruthy()
    expect(screen.queryByText(/broader portal run/i)).toBeNull()
  })

  it('does not present a historical broad run as current priority freshness', () => {
    render(<NationalLifeSyncProgress initialStatus={status({
      state: 'COMPLETED',
      shouldPoll: false,
      completed: 26,
      total: 26,
      percent: 100,
      stageCoverage: [
        {
          gridKey: 'NEW_BUSINESS',
          label: 'new business',
          state: 'VERIFIED',
          verifiedRecords: 862,
        },
        {
          gridKey: 'POLICY_PAYMENT_HISTORY',
          label: 'policy payment history',
          state: 'CAPTURED',
          verifiedRecords: 229,
        },
      ],
    })} />)

    expect(screen.getByText('K-Bot preserved your previous National Life sync')).toBeTruthy()
    expect(screen.getByText(/broader portal run/i)).toBeTruthy()
    expect(document.body.textContent).toContain('Previous run plan: 1 structured + 1 snapshot sources')
    expect(screen.queryByText('K-Bot finished updating your priority data')).toBeNull()
  })

  it('does not accept an arbitrary 13-source plan as the current priority plan', () => {
    render(<NationalLifeSyncProgress initialStatus={status({
      state: 'COMPLETED',
      shouldPoll: false,
      completed: 13,
      total: 13,
      percent: 100,
      stageCoverage: Array.from({ length: 13 }, (_, index) => ({
        gridKey: index === 12 ? 'POLICY_PAYMENT_HISTORY' : `UNKNOWN_${index}`,
        label: `source ${index}`,
        state: 'VERIFIED' as const,
        verifiedRecords: 0,
      })),
    })} />)

    expect(screen.getByText('K-Bot preserved your previous National Life sync')).toBeTruthy()
    expect(screen.queryByText('K-Bot finished updating your priority data')).toBeNull()
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
    await waitFor(() => expect(screen.getByText('0 of 13 portal areas checked')).toBeTruthy())
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

    expect(screen.getByText('13 of 13 areas checked.')).toBeTruthy()
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
    expect(screen.getByText('0 of 13 areas checked.')).toBeTruthy()
  })

  it('shows a ready state and starts polling when the card starts a new sync', async () => {
    const fetchMock = answerWith(status({ completed: 1, percent: 11, currentGridLabel: 'new business' }))
    render(<NationalLifeSyncProgress initialStatus={null} />)

    expect(screen.getByText('K-Bot is ready for the first sync')).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()

    window.dispatchEvent(new Event(NATIONAL_LIFE_SYNC_STARTED_EVENT))

    await waitFor(() => expect(screen.getByText('1 of 13 portal areas checked')).toBeTruthy())
    expect(screen.getByText('Reading and saving new business.')).toBeTruthy()
  })

  it('does not present the automatic grids as complete portal coverage', () => {
    render(
      <NationalLifeSyncProgress
        initialStatus={status({
          state: 'COMPLETED',
          shouldPoll: false,
          completed: 13,
          percent: 100,
          currentGridLabel: null,
          stageCoverage: [{
            gridKey: 'NEW_BUSINESS',
            label: 'new business',
            state: 'VERIFIED',
            verifiedRecords: 857,
          }],
        })}
      />,
    )

    expect(screen.getByText('12 of 30 known sources are operationally structured')).toBeTruthy()
  })

  it('separates raw snapshots from operational rows in the final totals', () => {
    render(
      <NationalLifeSyncProgress
        initialStatus={status({
          state: 'COMPLETED',
          shouldPoll: false,
          completed: 13,
          receivedRecords: 20_536,
          writtenRecords: 18_696,
          duplicateRecords: 837,
          rejectedRecords: 0,
          stageCoverage: [
            {
              gridKey: 'NEW_BUSINESS',
              label: 'new business',
              state: 'VERIFIED',
              verifiedRecords: 858,
            },
            {
              gridKey: 'AGENT_DASHBOARD',
              label: 'agent dashboard',
              state: 'CAPTURED',
              verifiedRecords: 1_003,
            },
          ],
        })}
      />,
    )

    expect(screen.getByText('Structured in Keepr One')).toBeTruthy()
    expect(screen.getByText('Source snapshots preserved')).toBeTruthy()
    expect(screen.getByText('1,003')).toBeTruthy()
    expect(document.body.textContent).toMatch(/not counted as operational rows/i)
    expect(document.body.textContent).toContain('Previous run plan: 1 structured + 1 snapshot sources')
  })

  it('shows an isolated failure as non-blocking while the remaining areas continue', () => {
    render(
      <NationalLifeSyncProgress
        initialStatus={status({
          completed: 4,
          failed: 1,
          currentGridLabel: 'client intelligence',
        })}
      />,
    )

    expect(screen.getByText('5 of 13 portal areas checked')).toBeTruthy()
    expect(screen.getByText(/The sync is continuing with the remaining areas/)).toBeTruthy()
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '5')
  })

  it('keeps resumed progress stable and labels verified areas as reused', () => {
    render(
      <NationalLifeSyncProgress
        initialStatus={status({
          completed: 4,
          total: 12,
          currentGridKey: 'CLIENT_INTELLIGENCE',
          currentGridLabel: 'client intelligence',
          stageCoverage: [
            {
              gridKey: 'NEW_BUSINESS',
              label: 'new business',
              state: 'REUSED',
              verifiedRecords: 859,
            },
            {
              gridKey: 'CLIENT_INTELLIGENCE',
              label: 'client intelligence',
              state: 'READING',
              verifiedRecords: null,
            },
          ],
        })}
      />,
    )

    expect(screen.getByText('Reused')).toBeTruthy()
    expect(screen.getByText(/1 previously verified area was reused/)).toBeTruthy()
    expect(screen.getByText('4 of 12 portal areas checked')).toBeTruthy()
  })

  it('does not mention reuse on a fresh verified run', () => {
    render(
      <NationalLifeSyncProgress
        initialStatus={status({
          state: 'COMPLETED',
          shouldPoll: false,
          completed: 1,
          total: 1,
          stageCoverage: [{
            gridKey: 'NEW_BUSINESS',
            label: 'new business',
            state: 'VERIFIED',
            verifiedRecords: 10,
          }],
        })}
      />,
    )

    expect(document.body.textContent).not.toContain('Reused areas were already verified')
  })
})
