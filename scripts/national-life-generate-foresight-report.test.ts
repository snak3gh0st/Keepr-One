import { describe, expect, it } from 'vitest'
import { pickCase, reportTimeStamp } from './national-life-generate-foresight-report'

describe('reportTimeStamp', () => {
  it('reproduces the format the tool builds for itself', () => {
    expect(reportTimeStamp(new Date(2026, 6, 31, 10, 2, 37))).toBe('10:02:37 AM')
  })

  it('drops the leading zero on the hour but keeps it on minutes and seconds', () => {
    expect(reportTimeStamp(new Date(2026, 6, 31, 9, 5, 3))).toBe('9:05:03 AM')
  })

  it('calls noon and midnight twelve, not zero', () => {
    expect(reportTimeStamp(new Date(2026, 6, 31, 12, 0, 0))).toBe('12:00:00 PM')
    expect(reportTimeStamp(new Date(2026, 6, 31, 0, 30, 0))).toBe('12:30:00 AM')
  })

  it('reads the afternoon on a twelve hour clock', () => {
    expect(reportTimeStamp(new Date(2026, 6, 31, 21, 56, 5))).toBe('9:56:05 PM')
  })
})

describe('pickCase', () => {
  const names = ['Fabio Filho IUL', 'RP-Campos-QQ-073026215605', 'RP-Teste-QQ-073026223730']

  it('prefers a quick quote when nothing was asked for, since that is what an agent just made', () => {
    expect(pickCase(names, undefined)).toBe('RP-Campos-QQ-073026215605')
  })

  it('matches on a fragment, because the full name carries a timestamp nobody types', () => {
    expect(pickCase(names, 'teste')).toBe('RP-Teste-QQ-073026223730')
  })

  it('returns null rather than opening the wrong client when nothing matches', () => {
    expect(pickCase(names, 'nobody')).toBeNull()
  })

  it('falls back to the first case when there is no quick quote at all', () => {
    expect(pickCase(['Fabio Filho IUL'], undefined)).toBe('Fabio Filho IUL')
  })

  it('has nothing to open on an empty panel', () => {
    expect(pickCase([], undefined)).toBeNull()
  })
})
