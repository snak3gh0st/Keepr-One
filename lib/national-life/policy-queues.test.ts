import { describe, expect, it } from 'vitest'
import { classifyNationalPolicyQueues, isNationalPolicyQueueKey, type NationalPolicyQueueRow } from './policy-queues'

const row = (carrierStatus: string | null, deliveryStatus: string | null): NationalPolicyQueueRow => ({
  policyNo: crypto.randomUUID(), insuredName: null, product: null, carrierStatus, deliveryStatus, submitDate: null,
})

describe('National policy queues', () => {
  it('uses exact carrier statuses for the policies entering in force', () => {
    expect(classifyNationalPolicyQueues([row('APPROVED', '-'), row('MODIFIED APPROVED', '-'), row('PENDING', '-')]).ENTER_INFORCE).toHaveLength(2)
  })
  it('separates eDelivery waiting on the agent from waiting on the client', () => {
    const queues = classifyNationalPolicyQueues([row('Issued', 'eDelivery with Agent'), row('Issued', 'eDelivery with Client')])
    expect(queues.WAITING_AGENT).toHaveLength(1)
    expect(queues.WAITING_CLIENT).toHaveLength(1)
  })
  it('accepts only supported URL filters', () => {
    expect(isNationalPolicyQueueKey('WAITING_AGENT')).toBe(true)
    expect(isNationalPolicyQueueKey('all')).toBe(false)
  })
})
