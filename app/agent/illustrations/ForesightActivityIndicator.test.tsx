// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ForesightActivityIndicator } from './ForesightActivityIndicator'

describe('ForesightActivityIndicator', () => {
  it('shows a compact live status while keeping the decorative pulse silent', () => {
    render(<ForesightActivityIndicator label="Foresight em andamento" />)

    expect(screen.getByText('Foresight em andamento')).toBeTruthy()
    expect(screen.getByTestId('foresight-activity-pulse').getAttribute('aria-hidden')).toBe('true')
  })
})
