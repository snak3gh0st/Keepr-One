export const NATIONAL_POLICY_QUEUE_KEYS = ['ENTER_INFORCE', 'WAITING_AGENT', 'WAITING_CLIENT'] as const
export type NationalPolicyQueueKey = typeof NATIONAL_POLICY_QUEUE_KEYS[number]

export type NationalPolicyQueueRow = {
  policyNo: string
  insuredName: string | null
  product: string | null
  carrierStatus: string | null
  deliveryStatus: string | null
  submitDate: string | null
}

export function isNationalPolicyQueueKey(value: unknown): value is NationalPolicyQueueKey {
  return typeof value === 'string' && NATIONAL_POLICY_QUEUE_KEYS.includes(value as NationalPolicyQueueKey)
}

export function belongsToNationalPolicyQueue(row: NationalPolicyQueueRow, queue: NationalPolicyQueueKey) {
  const status = (row.carrierStatus ?? '').trim().toUpperCase()
  const delivery = (row.deliveryStatus ?? '').trim().toLowerCase()
  if (queue === 'ENTER_INFORCE') return status === 'APPROVED' || status === 'MODIFIED APPROVED'
  if (queue === 'WAITING_AGENT') return delivery === 'edelivery with agent'
  return delivery === 'edelivery with client'
}

export function classifyNationalPolicyQueues(rows: NationalPolicyQueueRow[]) {
  return Object.fromEntries(NATIONAL_POLICY_QUEUE_KEYS.map((queue) => [
    queue,
    rows.filter((row) => belongsToNationalPolicyQueue(row, queue)),
  ])) as Record<NationalPolicyQueueKey, NationalPolicyQueueRow[]>
}
