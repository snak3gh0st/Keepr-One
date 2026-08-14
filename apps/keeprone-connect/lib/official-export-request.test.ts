import { describe, expect, it } from 'vitest'
import { buildOfficialExportRequest } from './official-export-request'

describe('official National Life export request', () => {
  it('turns the JSON DataTables template into the carrier form body', () => {
    const body = new URLSearchParams(buildOfficialExportRequest(JSON.stringify({
      objJsonModel: {
        draw: 2,
        start: 0,
        length: 10,
        columns: [{ data: 'PolicyNumber', searchable: false, orderable: true, search: { value: '', regex: false } }],
        order: [{ column: 0, dir: 'asc' }],
        DatatableId: 'opaque-grid',
        filters: [{ Key: 'PolicyType', Value: 'Life' }],
      },
    }), null))

    expect(body.get('DatatableId')).toBe('opaque-grid')
    expect(body.get('IsEnableContactFields')).toBe('true')
    expect(body.get('columns[0][data]')).toBe('PolicyNumber')
    expect(body.get('columns[0][search][regex]')).toBe('false')
    expect(body.get('filters[0][Key]')).toBe('PolicyType')
    expect(body.get('filters[0][Value]')).toBe('Life')
  })

  it('builds a complete request from the server-rendered inforce model', () => {
    const body = new URLSearchParams(buildOfficialExportRequest(null, {
      DatatableId: 'server-grid',
      PageIndex: 0,
      PageLength: 10,
      InitialDrawCount: '1',
      DefaultSortFieldIndex: 0,
      DefaultSortDirection: 'asc',
      IsSortable: true,
      FieldList: [
        { data: 'OwnerClientName', searchable: false, orderable: true },
        { data: 'PolicyNumber', searchable: false, orderable: true },
        { data: null, searchable: false, orderable: false },
      ],
    }, [{ Key: 'PolicyType', Value: 'Life' }]))

    expect(body.get('DatatableId')).toBe('server-grid')
    expect(body.get('columns[1][data]')).toBe('PolicyNumber')
    expect(body.get('columns[2][data]')).toBe('')
    expect(body.get('order[0][column]')).toBe('0')
    expect(body.get('IsEnableContactFields')).toBe('true')
    expect(body.get('filters[0][Value]')).toBe('Life')
  })

  it('rejects when neither the captured request nor the page model exists', () => {
    expect(() => buildOfficialExportRequest(null, null)).toThrow('EXPORT_TEMPLATE_UNAVAILABLE')
  })
})

