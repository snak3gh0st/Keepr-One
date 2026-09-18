import { describe, expect, it } from 'vitest'
import { parseCrmLeadRows } from './lead-import'

describe('CRM lead CSV import', () => {
  it('accepts a minimal name row and applies safe defaults', () => {
    const result = parseCrmLeadRows('name,email,phone\nMaria Silva,MARIA@EXAMPLE.COM,+1 (305) 555-0100\n')

    expect(result).toEqual({
      rows: [{
        firstName: 'Maria',
        lastName: 'Silva',
        email: 'maria@example.com',
        phone: '13055550100',
        dateOfBirth: null,
        state: null,
        tobaccoStatus: 'NO',
        objective: 'PROTECTION',
        productType: 'UNDECIDED',
        targetCoverage: null,
        monthlyBudget: null,
      }],
      errors: [],
    })
  })

  it('reports malformed rows with their CSV line number', () => {
    const result = parseCrmLeadRows('firstName,lastName,email,state\n,Silva,nope,Florida\n')

    expect(result).toMatchObject({ rows: [] })
    if ('error' in result) throw new Error(result.error)
    expect(result.errors[0]).toMatchObject({ row: 2 })
    expect(result.errors[0]?.message).toContain('Invalid email address')
  })

  it('supports the documented optional CRM fields', () => {
    const result = parseCrmLeadRows('firstName,lastName,dateOfBirth,state,tobaccoStatus,objective,productType,targetCoverage,monthlyBudget\nAna,Souza,1990-05-12,FL,FORMER,RETIREMENT,IUL,$250,120\n')

    if ('error' in result) throw new Error(result.error)
    expect(result.errors).toEqual([])
    expect(result.rows[0]).toMatchObject({
      state: 'FL', tobaccoStatus: 'FORMER', objective: 'RETIREMENT', productType: 'IUL', targetCoverage: 250, monthlyBudget: 120,
    })
    expect(result.rows[0]?.dateOfBirth?.toISOString()).toBe('1990-05-12T00:00:00.000Z')
  })

  it('accepts firstName as the only name column', () => {
    const result = parseCrmLeadRows('firstName\nJoão\n')

    if ('error' in result) throw new Error(result.error)
    expect(result.errors).toEqual([])
    expect(result.rows[0]).toMatchObject({ firstName: 'João', lastName: 'Lead' })
  })
})
