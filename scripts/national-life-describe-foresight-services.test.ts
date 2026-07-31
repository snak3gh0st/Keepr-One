import { describe, expect, it } from 'vitest'
import {
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
