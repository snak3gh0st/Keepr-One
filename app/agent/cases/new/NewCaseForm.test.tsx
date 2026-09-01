// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  createInsuranceCase: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
}))

vi.mock('./actions', () => ({
  createInsuranceCase: mocks.createInsuranceCase,
}))

import { NewCaseForm } from './NewCaseForm'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createInsuranceCase.mockResolvedValue({ ok: true, caseId: 'case-123' })
})

afterEach(cleanup)

describe('NewCaseForm', () => {
  it('returns a K-Bot Application request directly to the Application section', async () => {
    const { container } = render(<NewCaseForm applicationIntent />)

    fireEvent.submit(container.querySelector('form')!)

    await waitFor(() => {
      expect(mocks.push).toHaveBeenCalledWith('/agent/cases/case-123#application')
    })
  })

  it('keeps the standard case flow unchanged', async () => {
    const { container } = render(<NewCaseForm />)

    fireEvent.submit(container.querySelector('form')!)

    await waitFor(() => {
      expect(mocks.push).toHaveBeenCalledWith('/agent/cases/case-123')
    })
  })
})
