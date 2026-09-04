// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { PhoneRepairForm } from './PhoneRepairForm'
afterEach(cleanup)
it('requires confirmation of the country for an existing national number', async () => {
  const save = vi.fn()
  render(<PhoneRepairForm initialPhone="(407) 555-0100" busy={false} onSave={save} onCancel={() => {}} />)
  await userEvent.click(screen.getByRole('button', { name: 'Salvar telefone' }))
  expect(save).not.toHaveBeenCalled()
  expect(screen.getByRole('alert')).toBeInTheDocument()
  await userEvent.selectOptions(screen.getByLabelText('Código do país'), '1')
  expect(screen.getByText('+14075550100')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Salvar telefone' }))
  expect(save).toHaveBeenCalledWith('+14075550100')
})
