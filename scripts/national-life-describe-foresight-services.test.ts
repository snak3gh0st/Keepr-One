import { describe, expect, it } from 'vitest'
import {
  callSites,
  documentEndpoints,
  serviceEndpoints,
} from './national-life-describe-foresight-services'

describe('serviceEndpoints', () => {
  it('keeps the method attached to the service, because the service alone says nothing', () => {
    expect(
      serviceEndpoints('$.ajax({url:"WidgetService.asmx/GetEAppStatus"})'),
    ).toEqual(['WidgetService.asmx/GetEAppStatus'])
  })

  it('finds handlers and pages too', () => {
    expect(serviceEndpoints('"/NWI/Main/LoginCallback.ashx" + "PrintPreview.aspx"')).toEqual([
      '/NWI/Main/LoginCallback.ashx',
      'PrintPreview.aspx',
    ])
  })

  it('reports each endpoint once, sorted, so two runs diff cleanly', () => {
    expect(serviceEndpoints('b.asmx/Two a.asmx/One b.asmx/Two a.asmx/One')).toEqual([
      'a.asmx/One',
      'b.asmx/Two',
    ])
  })

  it('finds nothing in a bundle that names no service', () => {
    expect(serviceEndpoints('function add(a, b) { return a + b }')).toEqual([])
  })
})

describe('documentEndpoints', () => {
  it('surfaces the candidates for where a PDF would come from', () => {
    expect(
      documentEndpoints([
        'WidgetService.asmx/GetState',
        'ReportService.asmx/GeneratePdf',
        'Output.aspx',
        'PageService.asmx/GetApplications',
      ]),
    ).toEqual(['ReportService.asmx/GeneratePdf', 'Output.aspx'])
  })

  it('returns nothing rather than guessing when no endpoint looks like a document', () => {
    expect(documentEndpoints(['WidgetService.asmx/GetState'])).toEqual([])
  })
})

describe('callSites', () => {
  it('returns the code around the call, where the payload is built', () => {
    const source = 'var p={caseId:1};$.post("PageService.asmx/RenderReports",p)'

    expect(callSites(source, 'PageService.asmx/RenderReports', 40)).toEqual([
      'var p={caseId:1};$.post("PageService.asmx/RenderReports",p)',
    ])
  })

  it('collapses the whitespace of a minified bundle without changing what it says', () => {
    expect(callSites('a\n\n  b Foo.asmx/Bar', 'Foo.asmx/Bar', 20)).toEqual(['a b Foo.asmx/Bar'])
  })

  it('finds nothing when the bundle never names the method', () => {
    expect(callSites('unrelated source', 'Foo.asmx/Bar')).toEqual([])
  })

  it('stops after a handful, so one common name cannot flood the report', () => {
    expect(callSites('x'.concat('Foo.asmx/Bar '.repeat(20)), 'Foo.asmx/Bar', 5)).toHaveLength(4)
  })
})
