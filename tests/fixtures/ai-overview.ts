import type { AiActivity, AiOverview } from '@/lib/kbot-ai/overview'

export const aiActivityFixture: AiActivity = {
  id: 'job-demo', batchId: '9cebe68c-47ca-48e4-aee4-53bfa4b4e0da', customerName: 'Ana Exemplo', status: 'READ', reason: 'LAPSE_WARNING',
  creditState: 'SPENT', billedTokens: 134, reservedTokens: 192, inputTokens: 123, outputTokens: 11,
  content: 'Olá, Ana! Podemos conversar sobre a pendência da sua apólice?', conversationId: 'demo-conversation', createdAt: '2026-09-05T12:30:00.000Z',
}

export const aiOverviewFixture: AiOverview = {
  enabled: true, updatedAt: '2026-09-05T13:00:00.000Z', period: 'month', start: '2026-09-01T00:00:00.000Z', availability: 'READY',
  balance: { available: 663, reserved: 192, spent: 145, allowance: 1000, expiresAt: '2026-10-01T00:00:00.000Z' },
  consumption: { tokens: 145, generations: 2 }, impact: { total: 3, working: 1, attention: 1, sent: 1, delivered: 1, read: 1 },
  current: { working: 1, unconfirmed: 0 }, reservationPerMessage: 192, subscription: null,
  activity: { jobs: [
    { ...aiActivityFixture, id: 'job-pending', customerName: 'Bruno Exemplo', status: 'PENDING', creditState: 'RESERVED', billedTokens: 0, inputTokens: 0, outputTokens: 0, content: null, conversationId: null },
    aiActivityFixture,
    { ...aiActivityFixture, id: 'job-failed', customerName: 'Clara Exemplo', status: 'FAILED', billedTokens: 11, content: null, conversationId: null },
  ], total: 3, page: 0, pageSize: 20, filter: 'all' },
}
