import { describe, expect, it } from 'vitest'
import { classifyEndpoints } from './national-life-describe-foresight-newcase'

describe('classifyEndpoints', () => {
  it('separates the three questions the probe is asking', () => {
    const found = classifyEndpoints([
      'PageService.asmx/GetProductList',
      'PageService.asmx/CreateNewCase',
      'WidgetService.asmx/GetQuickCalcData',
      'PageService.asmx/AbortReports',
    ])

    expect(found.product).toContain('PageService.asmx/GetProductList')
    expect(found.newCase).toContain('PageService.asmx/CreateNewCase')
    expect(found.data).toEqual(['WidgetService.asmx/GetQuickCalcData'])
    expect(found.data).not.toContain('PageService.asmx/GetProductList')
  })

  // The report family produces a document. The whole point of the `data` bucket
  // is to find something that produces *values* instead, so a match on
  // "SetupReportDisplay" or "GetReportProgress" would be the bucket answering
  // its own question wrong.
  it('keeps the report endpoints out of the data bucket', () => {
    const found = classifyEndpoints([
      'PageService.asmx/SetupReportDisplay',
      'PageService.asmx/GetReportProgress',
      'PageService.asmx/RenderReports',
    ])

    expect(found.data).toEqual([])
    expect(found.newCase).toEqual([])
  })

  it('keeps discovery-only product heuristics out of the operational read bucket', () => {
    const found = classifyEndpoints([
      'PageService.asmx/GetTermProducts',
      'WidgetService.asmx/GetQuickCalcStatus',
    ])
    expect(found.product).toEqual(['PageService.asmx/GetTermProducts'])
    expect(found.data).toEqual(['WidgetService.asmx/GetQuickCalcStatus'])
  })

  it('has nothing to report about an empty bundle', () => {
    expect(classifyEndpoints([])).toEqual({ product: [], newCase: [], data: [] })
  })
})
