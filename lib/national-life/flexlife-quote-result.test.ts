import { describe, expect, it, vi } from 'vitest'
import { buildFlexLifeQuoteSnapshot, flexLifeQuoteInputHash } from './flexlife-quote-contract'
import { createFlexLifeQuoteResultRepository } from './flexlife-quote-result'

const pending = {
  id: 'ill_quote_1',
  agentId: 'agent_1',
  clientId: null,
  insuredName: 'KeeprOne Test',
  insuredDateOfBirth: new Date('1981-08-26T00:00:00.000Z'),
  rawPayload: {
    request: {
      IssueState: 'FL', FirstName: 'KeeprOne', LastName: 'Test', DateOfBirth: '08/26/1981',
      IssueAge: 45, Gender: 'Male', RateClass: 'Standard_NT', SolveType: 'Specify_Amount',
      Amount: 250_000, DeathBenefitOption: 'A_Level', Strategy: 'SP500PointToPointCapFocus',
      Allocation: 100, ProductCode: '956', PremiumMode: 'Monthly',
    },
  },
}

function database() {
  return {
    illustration: {
      findFirst: vi.fn().mockResolvedValue(pending),
      upsert: vi.fn().mockResolvedValue({ id: pending.id }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  }
}

describe('persist local FlexLife quote result', () => {
  it('independently parses the carrier response and completes the pending illustration', async () => {
    const db = database()
    const repository = createFlexLifeQuoteResultRepository(db as never)
    const inputHash = flexLifeQuoteInputHash(buildFlexLifeQuoteSnapshot(pending))

    await repository.persistOwnedQuoteResult({
      agentId: 'agent_1',
      illustrationId: pending.id,
      inputHash,
      response: {
        Success: true,
        FaceAmount: '$250,000.00',
        AnnualPremium: '$4,200.00',
        MonthlyPremium: '$350.00',
        LapseYear: 0,
      },
    })

    expect(db.illustration.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { provider_externalId: { provider: 'NATIONAL_LIFE', externalId: pending.id } },
      update: expect.objectContaining({ faceAmount: 250000, premium: 350 }),
    }))
  })

  it('rejects a changed pending request before storing carrier numbers', async () => {
    const db = database()
    const repository = createFlexLifeQuoteResultRepository(db as never)

    await expect(repository.persistOwnedQuoteResult({
      agentId: 'agent_1',
      illustrationId: pending.id,
      inputHash: 'a'.repeat(64),
      response: { Success: true, FaceAmount: 250000, MonthlyPremium: 350, AnnualPremium: 4200 },
    })).rejects.toThrow('FLEXLIFE_QUOTE_INPUT_MISMATCH')
    expect(db.illustration.upsert).not.toHaveBeenCalled()
    expect(db.illustration.updateMany).not.toHaveBeenCalled()
  })

  it('stores a carrier refusal without inventing a premium or face amount', async () => {
    const db = database()
    const repository = createFlexLifeQuoteResultRepository(db as never)
    const inputHash = flexLifeQuoteInputHash(buildFlexLifeQuoteSnapshot(pending))

    await repository.persistOwnedQuoteResult({
      agentId: 'agent_1',
      illustrationId: pending.id,
      inputHash,
      response: { Success: false, Message: 'Face amount below the product minimum.' },
    })

    expect(db.illustration.upsert).not.toHaveBeenCalled()
    expect(db.illustration.updateMany).toHaveBeenCalledWith({
      where: { id: pending.id, agentId: 'agent_1' },
      data: {
        rawPayload: {
          request: pending.rawPayload.request,
          response: { ok: false, message: 'Face amount below the product minimum.' },
        },
      },
    })
  })
})
