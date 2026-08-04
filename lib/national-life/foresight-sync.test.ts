import { describe, expect, it } from 'vitest'
import {
  FORESIGHT_READ_SERVICES,
  describeForesightShape,
  isForesightReadService,
  parseForesightCaseListings,
  redactForesightPayload,
  summarizeForesightCase,
} from './foresight-sync'

describe('Foresight read contract', () => {
  it('parses only named case anchors and classifies quick quotes', () => {
    expect(
      parseForesightCaseListings(
        '<a href="/ignored">Ignore me</a><a id="lnkCaseName0"> RP-Silva-QQ-08032026 </a><a id="lnkCaseName1"> Maria Silva </a>',
      ),
    ).toEqual([
      {
        externalKey: 'RP-Silva-QQ-08032026',
        displayName: 'RP-Silva-QQ-08032026',
        caseKind: 'QUICK_QUOTE',
        product: null,
      },
      { externalKey: 'Maria Silva', displayName: 'Maria Silva', caseKind: 'CASE', product: null },
    ])
  })

  it('uses a visible label when the case anchor has no separate id value', () => {
    expect(parseForesightCaseListings('<a id="lnkCaseName"> Visible case </a>')).toEqual([
      { externalKey: 'Visible case', displayName: 'Visible case', caseKind: 'CASE', product: null },
    ])
  })

  it('accepts only the five read services', () => {
    expect(FORESIGHT_READ_SERVICES).toHaveLength(5)
    expect(isForesightReadService('WidgetService.asmx/GetQuickCalcData')).toBe(true)
    expect(isForesightReadService('PageService.asmx/RenderReports')).toBe(false)
    expect(isForesightReadService('WidgetService.asmx/GetQuickCalcData/extra')).toBe(false)
  })

  it('redacts sensitive keys while preserving safe values', () => {
    expect(
      redactForesightPayload({ email: 'person@example.com', tokenId: 'secret', premium: 250 }),
    ).toEqual({ email: '[REDACTED]', tokenId: '[REDACTED]', premium: 250 })
  })

  it('truncates strings and stops nested payloads at the safe depth', () => {
    expect(redactForesightPayload({ note: 'x'.repeat(2_001) })).toEqual({ note: 'x'.repeat(2_000) })

    let nested: unknown = { value: 'safe' }
    for (let index = 0; index < 8; index += 1) nested = { nested }
    expect(redactForesightPayload(nested)).toEqual(
      expect.objectContaining({ nested: expect.anything() }),
    )
    expect(JSON.stringify(redactForesightPayload(nested))).not.toContain('safe')
  })

  it('describes values without exposing them', () => {
    expect(describeForesightShape({ rows: [{ premium: 250 }] })).toEqual({
      rows: { array: 1, of: { premium: 'number' } },
    })
  })

  it('extracts only explicit carrier summary keys', () => {
    expect(
      summarizeForesightCase({
        CaseType: 'CASE',
        ProductName: 'IUL',
        status: 'APPROVED',
        nested: { caseKind: 'SHOULD_NOT_BE_USED' },
      }),
    ).toEqual({ caseKind: 'CASE', product: 'IUL' })
    expect(summarizeForesightCase({ displayName: 'Visible label' })).toEqual({
      caseKind: null,
      product: null,
    })
  })
})
