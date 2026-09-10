import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  headers: vi.fn(),
  consumeRateLimit: vi.fn(),
  createMany: vi.fn(),
}))

vi.mock('next/headers', () => ({ headers: mocks.headers }))
vi.mock('@/lib/founder-rate-limit', () => ({
  consumeFounderRegistrationRateLimit: mocks.consumeRateLimit,
}))
vi.mock('@/lib/prisma', () => ({
  prisma: { founderLead: { createMany: mocks.createMany } },
}))

import { registerFounderLeadAction } from './lead-actions'

function registrationForm(overrides: Record<string, string> = {}) {
  const form = new FormData()
  Object.entries({
    name: '  Maria Founder  ',
    email: ' Maria@Example.com ',
    phone: '(212) 555-0100',
    ...overrides,
  }).forEach(([key, value]) => form.set(key, value))
  return form
}

describe('registerFounderLeadAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.headers.mockResolvedValue(new Headers({ 'x-forwarded-for': '203.0.113.8' }))
    mocks.consumeRateLimit.mockResolvedValue({ allowed: true })
    mocks.createMany.mockResolvedValue({ count: 1 })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('stores only a normalized lead without needing an invite, account, or trial', async () => {
    const result = await registerFounderLeadAction(registrationForm({
      role: 'ADMIN',
      acceptedTerms: 'on',
      trialEndsAt: '2099-01-01',
    }))

    expect(result).toEqual({ ok: true })
    expect(mocks.createMany).toHaveBeenCalledExactlyOnceWith({
      data: [{ name: 'Maria Founder', email: 'maria@example.com', phone: '+12125550100' }],
      skipDuplicates: true,
    })
  })

  it('acknowledges a duplicate email without updating or revealing the existing lead', async () => {
    mocks.createMany.mockResolvedValue({ count: 0 })

    expect(await registerFounderLeadAction(registrationForm({
      name: 'Another Name',
      phone: '(305) 555-0100',
    }))).toEqual({ ok: true })
    expect(mocks.createMany).toHaveBeenCalledExactlyOnceWith({
      data: [{ name: 'Another Name', email: 'maria@example.com', phone: '+13055550100' }],
      skipDuplicates: true,
    })
  })

  it('returns field errors without persisting an invalid lead', async () => {
    const result = await registerFounderLeadAction(registrationForm({
      name: ' ', email: 'invalid', phone: '+1 416 555 0100',
    }))

    expect(result).toEqual({
      ok: false,
      fieldErrors: {
        name: [expect.any(String)],
        email: [expect.any(String)],
        phone: [expect.any(String)],
      },
    })
    expect(mocks.createMany).not.toHaveBeenCalled()
    expect(mocks.headers).not.toHaveBeenCalled()
  })

  it('treats an uploaded file in a contact field as missing input', async () => {
    const form = registrationForm()
    form.set('name', new File(['Maria'], 'contact.txt'))

    expect(await registerFounderLeadAction(form)).toEqual({
      ok: false, fieldErrors: { name: [expect.any(String)] },
    })
    expect(mocks.createMany).not.toHaveBeenCalled()
  })

  it('silently discards a filled honeypot without using the database', async () => {
    expect(await registerFounderLeadAction(registrationForm({ website: 'https://spam.example' })))
      .toEqual({ ok: true })
    expect(mocks.createMany).not.toHaveBeenCalled()
    expect(mocks.consumeRateLimit).not.toHaveBeenCalled()
  })

  it('uses a separate rate-limit namespace with hashed address and email identifiers', async () => {
    await registerFounderLeadAction(registrationForm())

    expect(mocks.consumeRateLimit).toHaveBeenNthCalledWith(1, {
      key: expect.stringMatching(/^founders-lead-ip:[a-f0-9]{32}$/), max: 12, windowSeconds: 3600,
    })
    expect(mocks.consumeRateLimit).toHaveBeenNthCalledWith(2, {
      key: expect.stringMatching(/^founders-lead-email:[a-f0-9]{32}$/), max: 4, windowSeconds: 3600,
    })
  })

  it.each([0, 1])('blocks persistence when rate limiter %s rejects the attempt', async (blockedIndex) => {
    mocks.consumeRateLimit
      .mockResolvedValueOnce({ allowed: blockedIndex !== 0 })
      .mockResolvedValueOnce({ allowed: blockedIndex !== 1 })

    expect(await registerFounderLeadAction(registrationForm())).toEqual({
      ok: false,
      message: 'Muitas tentativas de cadastro. Aguarde um pouco antes de tentar novamente.',
    })
    expect(mocks.createMany).not.toHaveBeenCalled()
  })

  it('reports persistence failures as retryable without disclosing database details', async () => {
    mocks.createMany.mockRejectedValue(new Error('private connection string'))
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(await registerFounderLeadAction(registrationForm())).toEqual({
      ok: false,
      message: 'Não foi possível concluir seu cadastro agora. Tente novamente em instantes.',
    })
    expect(log).toHaveBeenCalledExactlyOnceWith('Founder lead registration failed.')
  })

  it('fails closed if the limiter cannot complete', async () => {
    mocks.consumeRateLimit.mockRejectedValue(new Error('Redis unavailable'))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(await registerFounderLeadAction(registrationForm())).toEqual({
      ok: false,
      message: 'Não foi possível concluir seu cadastro agora. Tente novamente em instantes.',
    })
    expect(mocks.createMany).not.toHaveBeenCalled()
  })
})
