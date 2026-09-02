// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}))

import { NationalLifeDocumentButton } from './NationalLifeDocumentButton'

const extensionId = 'abcdefghijklmnopabcdefghijklmnop'

function installChromeResponse(response: Record<string, unknown>) {
  Object.defineProperty(window, 'chrome', {
    configurable: true,
    value: {
      runtime: {
        sendMessage: (
          id: string,
          message: Record<string, unknown>,
          callback: (value: Record<string, unknown>) => void,
        ) => {
          expect(id).toBe(extensionId)
          expect(message).toEqual({
            type: 'FETCH_NATIONAL_LIFE_DOCUMENT',
            reportRowId: 'report-row-1',
          })
          callback(response)
        },
      },
    },
  })
}

beforeEach(() => vi.clearAllMocks())

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(window, 'chrome')
})

describe('NationalLifeDocumentButton', () => {
  it('refreshes the policy only after the connector confirms persistence', async () => {
    installChromeResponse({ ok: true, documentId: 'document-1' })
    render(<NationalLifeDocumentButton extensionId={extensionId} reportRowId="report-row-1" />)

    await userEvent.click(screen.getByRole('button', { name: 'Trazer para a Keepr One' }))

    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce())
  })

  it('explains how to resume when the carrier session requires login', async () => {
    installChromeResponse({ ok: false, error: 'AUTH_REQUIRED' })
    render(<NationalLifeDocumentButton extensionId={extensionId} reportRowId="report-row-1" />)

    await userEvent.click(screen.getByRole('button', { name: 'Trazer para a Keepr One' }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Entre na National Life na aba que foi aberta e tente novamente.',
    )
    expect(screen.getByRole('button', { name: 'Tentar após entrar' })).toBeEnabled()
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it('asks for an extension update when the installed protocol is old', async () => {
    installChromeResponse({ ok: false, error: 'INVALID_MESSAGE' })
    render(<NationalLifeDocumentButton extensionId={extensionId} reportRowId="report-row-1" />)

    await userEvent.click(screen.getByRole('button', { name: 'Trazer para a Keepr One' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Atualize e recarregue o K-Bot')
  })

  it.each([
    ['BRIDGE_UNAVAILABLE', 'Recarregue a aba da National Life'],
    ['PORTAL_REQUEST_FAILED', 'A National Life não conseguiu entregar este documento'],
    ['INVALID_DOCUMENT_RESPONSE', 'A National Life devolveu um arquivo inesperado'],
  ])('reports the document boundary that failed for %s', async (error, expectedMessage) => {
    installChromeResponse({ ok: false, error })
    render(<NationalLifeDocumentButton extensionId={extensionId} reportRowId="report-row-1" />)

    await userEvent.click(screen.getByRole('button', { name: 'Trazer para a Keepr One' }))

    expect(await screen.findByRole('status')).toHaveTextContent(expectedMessage)
  })
})
