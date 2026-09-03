import { describe, expect, it } from 'vitest'
import { parseForesightProgressPhase } from './foresight-progress'

describe('parseForesightProgressPhase', () => {
  it('accepts only the progress words understood by the extension', () => {
    expect(parseForesightProgressPhase('GENERATING_PDF')).toBe('GENERATING_PDF')
    expect(parseForesightProgressPhase('READING_QUICK_REVIEW')).toBe('READING_QUICK_REVIEW')
    expect(parseForesightProgressPhase('STEAL_PASSWORD')).toBeNull()
    expect(parseForesightProgressPhase({ phase: 'GENERATING_PDF' })).toBeNull()
  })
})
