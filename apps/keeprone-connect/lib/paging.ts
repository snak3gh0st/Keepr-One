/// The ceiling exists to bound memory and request count, not to describe any real
/// grid: at 200_000 rows no carrier grid we have ever seen reaches it. When it does
/// fire, `truncated` stays true and the server deliberately leaves the run open —
/// incomplete data must not finalize a stage.
export const MAX_PORTAL_RECORDS = 200_000
/// Raw carrier rows are fatter than the normalized ones we used to send, so a page
/// carries fewer of them. Mirrors LOCAL_CONNECTOR_MAX_RECORDS on the server.
export const PAGE_SIZE = 200

type JsonMap = Record<string, unknown>

function objectValue(value: unknown): JsonMap | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonMap)
    : null
}

function updateModel(model: JsonMap, start: number, length: number, draw: number): JsonMap {
  return { ...model, start, length: Math.min(length, PAGE_SIZE), draw }
}

export function buildPageBody(template: string, start: number, length = PAGE_SIZE, draw = 1): string {
  if (!Number.isSafeInteger(start) || start < 0 || start > MAX_PORTAL_RECORDS) {
    throw new Error('INVALID_PAGE_START')
  }
  try {
    const direct = objectValue(JSON.parse(template))
    if (direct) {
      const nested = direct.objJsonModel
      if (typeof nested === 'string') {
        const model = objectValue(JSON.parse(nested))
        if (!model) throw new Error('INVALID_TEMPLATE')
        return JSON.stringify({ ...direct, objJsonModel: JSON.stringify(updateModel(model, start, length, draw)) })
      }
      const model = objectValue(nested) ?? direct
      return JSON.stringify(nested ? { ...direct, objJsonModel: updateModel(model, start, length, draw) } : updateModel(model, start, length, draw))
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'INVALID_TEMPLATE') throw error
  }

  const form = new URLSearchParams(template)
  const encodedModel = form.get('objJsonModel')
  if (!encodedModel) throw new Error('INVALID_TEMPLATE')
  const model = objectValue(JSON.parse(encodedModel))
  if (!model) throw new Error('INVALID_TEMPLATE')
  form.set('objJsonModel', JSON.stringify(updateModel(model, start, length, draw)))
  return form.toString()
}

export type PortalPage = {
  rows: unknown[]
  recordsTotal: number
  truncated: boolean
}

export function parsePortalPage(value: unknown): PortalPage {
  const response = objectValue(value)
  if (!response) throw new Error('INVALID_PORTAL_RESPONSE')
  const rows = response.data ?? response.aaData ?? response.Data
  const totalValue =
    response.recordsTotal ?? response.iTotalRecords ?? response.RecordsTotal ?? response.total
  const total = typeof totalValue === 'string' ? Number(totalValue) : totalValue
  if (!Array.isArray(rows) || !Number.isSafeInteger(total) || (total as number) < 0) {
    throw new Error('INVALID_PORTAL_RESPONSE')
  }
  return {
    rows,
    recordsTotal: Math.min(total as number, MAX_PORTAL_RECORDS),
    truncated: (total as number) > MAX_PORTAL_RECORDS,
  }
}

export function nextPageStart(currentStart: number, rowCount: number, recordsTotal: number): number | null {
  if (rowCount <= 0) return null
  const next = currentStart + rowCount
  return next < Math.min(recordsTotal, MAX_PORTAL_RECORDS) ? next : null
}
