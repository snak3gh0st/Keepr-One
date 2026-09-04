// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ stageSelectProps: vi.fn() }))

vi.mock('@/components/crm/CrmStageSelect', () => ({
  CrmStageSelect: (props: { onChange: unknown }) => {
    mocks.stageSelectProps(props)
    return <button type="button" aria-label="Alterar etapa">Alterar etapa</button>
  },
}))

import { CasePipelineStageControl } from './CasePipelineStageControl'

const stage = {
  id: 'stage-1', name: 'Novo Lead', position: 0, systemKey: 'NEW_LEAD', active: true, caseCount: 0,
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('CasePipelineStageControl', () => {
  it('does not expose a stage-change control or callback in a configured support preview', () => {
    const onChange = vi.fn(async () => ({ ok: true as const }))

    render(
      <CasePipelineStageControl
        pipelineAvailable
        readOnly
        caseId="case-1"
        stage={stage}
        stages={[stage]}
        onChange={onChange}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Alterar etapa' })).not.toBeInTheDocument()
    expect(mocks.stageSelectProps).not.toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('retains the stage-change control for a configured normal session', () => {
    const onChange = vi.fn(async () => ({ ok: true as const }))

    render(
      <CasePipelineStageControl
        pipelineAvailable
        readOnly={false}
        caseId="case-1"
        stage={stage}
        stages={[stage]}
        onChange={onChange}
      />,
    )

    expect(screen.getByRole('button', { name: 'Alterar etapa' })).toBeInTheDocument()
    expect(mocks.stageSelectProps).toHaveBeenCalledWith(expect.objectContaining({
      caseId: 'case-1', onChange,
    }))
  })
})
