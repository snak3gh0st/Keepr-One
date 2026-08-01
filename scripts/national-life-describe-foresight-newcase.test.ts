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
    expect(found.data).toContain('WidgetService.asmx/GetQuickCalcData')
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

  // An endpoint can legitimately answer two questions at once — a product
  // getter is both "product" and "data" — and hiding it from one bucket to keep
  // the lists tidy would be the probe deciding for the reader.
  it('lets one endpoint appear under more than one question', () => {
    const found = classifyEndpoints(['PageService.asmx/GetTermProducts'])
    expect(found.product).toEqual(['PageService.asmx/GetTermProducts'])
    expect(found.data).toEqual(['PageService.asmx/GetTermProducts'])
  })

  it('has nothing to report about an empty bundle', () => {
    expect(classifyEndpoints([])).toEqual({ product: [], newCase: [], data: [] })
  })
})
