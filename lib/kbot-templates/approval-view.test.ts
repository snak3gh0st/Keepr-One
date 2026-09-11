import { describe, expect, it } from 'vitest'
import { APPROVAL_WINDOW_MS, AWAITING_APPROVAL } from '@/lib/kbot-followup/domain'
import { AWAITING_APPROVAL_STATUS, bucketForJob, type ScheduledJobRow } from './schedule-view'
import { approvalTimeLeft, canApprove, templateValuesFor, toApprovalProposal } from './approval-view'

const row: ScheduledJobRow = {
  id: 'j1',
  category: 'BIRTHDAY',
  customerName: 'Ana Ribeiro',
  phone: '+14075550100',
  language: 'PT',
  status: AWAITING_APPROVAL,
  errorCode: null,
  content: null,
  createdAt: new Date('2026-09-01T12:00:00.000Z'),
  updatedAt: new Date('2026-09-01T12:00:00.000Z'),
}

const options = { agentName: 'Paulo Loureiro', templateEnabled: true, approvalWindowMs: APPROVAL_WINDOW_MS }

describe('the values a proposal is rendered with', () => {
  it('greets by the first name and signs with the agent', () => {
    expect(templateValuesFor({ customerName: 'Ana Ribeiro', agentName: 'Paulo Loureiro' })).toEqual({
      nome: 'Ana Ribeiro',
      primeiro_nome: 'Ana',
      agente: 'Paulo Loureiro',
    })
  })

  it('gives the same name twice when there is only one word', () => {
    const values = templateValuesFor({ customerName: '  Ana  ', agentName: ' Paulo ' })
    expect(values).toEqual({ nome: 'Ana', primeiro_nome: 'Ana', agente: 'Paulo' })
  })
})

describe('a proposal waiting for the agent', () => {
  it('carries the exact text the client will read', () => {
    const proposal = toApprovalProposal(row, { ...options, templateBody: 'Feliz aniversário, {{primeiro_nome}}! — {{agente}}' })
    expect(proposal.text).toBe('Feliz aniversário, Ana! — Paulo Loureiro')
    expect(proposal.problem).toBeNull()
    expect(canApprove(proposal, Date.parse('2026-09-01T13:00:00.000Z'))).toBe(true)
  })

  it('expires two days after it was raised, not after it was last touched', () => {
    const proposal = toApprovalProposal(row, { ...options, templateBody: 'Oi {{nome}}' })
    expect(proposal.expiresAt).toBe('2026-09-03T12:00:00.000Z')
  })

  it('refuses to be approved once the window has closed', () => {
    const proposal = toApprovalProposal(row, { ...options, templateBody: 'Oi {{nome}}' })
    expect(canApprove(proposal, Date.parse('2026-09-04T00:00:00.000Z'))).toBe(false)
  })
})

describe('a proposal that cannot be rendered', () => {
  it('shows no text and names the variables instead of leaking braces', () => {
    const proposal = toApprovalProposal(row, { ...options, templateBody: 'Oi {{apelido}}, tudo bem?' })
    expect(proposal.text).toBeNull()
    expect(proposal.problem).toBe('UNRENDERABLE')
    expect(proposal.unknown).toEqual(['apelido'])
    expect(canApprove(proposal, Date.parse('2026-09-01T13:00:00.000Z'))).toBe(false)
  })

  it('treats an unmatched brace the same way — nothing goes out half-written', () => {
    const proposal = toApprovalProposal(row, { ...options, templateBody: 'Oi {{nome' })
    expect(proposal.text).toBeNull()
    expect(proposal.problem).toBe('UNRENDERABLE')
    expect(canApprove(proposal, Date.parse('2026-09-01T13:00:00.000Z'))).toBe(false)
  })

  it('says the template is gone when it was switched off since the proposal was raised', () => {
    const proposal = toApprovalProposal(row, { ...options, templateBody: null })
    expect(proposal.problem).toBe('TEMPLATE_MISSING')
    expect(canApprove(proposal, Date.parse('2026-09-01T13:00:00.000Z'))).toBe(false)
  })
})

describe('how long is left', () => {
  it('counts down in hours and minutes', () => {
    expect(approvalTimeLeft('2026-09-03T12:00:00.000Z', Date.parse('2026-09-02T10:30:00.000Z')))
      .toEqual({ expired: false, hours: 25, minutes: 30 })
  })

  it('calls a window that already closed expired', () => {
    expect(approvalTimeLeft('2026-09-03T12:00:00.000Z', Date.parse('2026-09-03T12:00:00.000Z')).expired).toBe(true)
  })
})

describe('where a proposal is filed', () => {
  // The screen shows proposals in their own queue, and the deliveries query
  // excludes them. Without a case of its own, a message waiting for the agent
  // would be bucketed as a message that went wrong.
  it('is never mistaken for a delivery that needs attention', () => {
    expect(AWAITING_APPROVAL_STATUS).toBe(AWAITING_APPROVAL)
    expect(bucketForJob({ status: AWAITING_APPROVAL })).toBe('AWAITING_APPROVAL')
  })
})

describe('a proposal that already carries its text', () => {
  // A category the K-Bot writes has no template to render: the text was written
  // when the proposal was raised, and it is what the client will read.
  const written: ScheduledJobRow = { ...row, content: 'Ana, tudo de bom hoje!' }

  it('shows the stored text, not the template', () => {
    const proposal = toApprovalProposal(written, { ...options, templateBody: 'Feliz aniversário, {{nome}}!' })
    expect(proposal.text).toBe('Ana, tudo de bom hoje!')
    expect(proposal.problem).toBeNull()
  })

  it('is approvable with no template text at all', () => {
    // The K-Bot writes this category: on, and with no text of the agent's.
    const proposal = toApprovalProposal(written, { ...options, templateBody: null })
    expect(proposal.text).toBe('Ana, tudo de bom hoje!')
    expect(canApprove(proposal, new Date('2026-09-01T13:00:00.000Z').getTime())).toBe(true)
  })
})

describe('a proposal whose category was switched off after it was raised', () => {
  // The worker re-reads the template at dispatch and refuses. Offering to
  // release it would settle the job with nothing sent — and the event is
  // already taken, so for a birthday the year is gone.
  const written: ScheduledJobRow = { ...row, content: 'Ana, tudo de bom hoje!' }

  it('is not approvable, even carrying the text it would have sent', () => {
    const proposal = toApprovalProposal(written, { ...options, templateEnabled: false, templateBody: 'Feliz aniversário, {{nome}}!' })
    expect(proposal.problem).toBe('TEMPLATE_MISSING')
    expect(proposal.text).toBeNull()
    expect(canApprove(proposal, new Date('2026-09-01T13:00:00.000Z').getTime())).toBe(false)
  })
})
