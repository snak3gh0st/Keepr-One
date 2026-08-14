type JsonObject = Record<string, unknown>

export type DatatableExportConfig = {
  DatatableId?: unknown
  PageIndex?: unknown
  PageLength?: unknown
  InitialDrawCount?: unknown
  DefaultSortFieldIndex?: unknown
  DefaultSortDirection?: unknown
  IsSortable?: unknown
  FieldList?: unknown
}

function objectValue(value: unknown): JsonObject | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : null
}

function integerValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : fallback
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

function datatableModelFromTemplate(template: string): JsonObject | null {
  try {
    const parsed = objectValue(JSON.parse(template))
    if (parsed) {
      const nested = parsed.objJsonModel
      if (typeof nested === 'string') return objectValue(JSON.parse(nested))
      if (nested !== undefined) return objectValue(nested)
      if ('DatatableId' in parsed || 'columns' in parsed) return parsed
    }
  } catch {
    // Some older portal surfaces submit the model as a form field.
  }

  try {
    const form = new URLSearchParams(template)
    const nested = form.get('objJsonModel')
    if (nested) return objectValue(JSON.parse(nested))
  } catch {
    // The caller will use the server-rendered model below.
  }
  return null
}

function formAppend(form: URLSearchParams, key: string, value: unknown) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => formAppend(form, `${key}[${index}]`, item))
    return
  }
  const object = objectValue(value)
  if (object) {
    for (const [childKey, childValue] of Object.entries(object)) {
      formAppend(form, `${key}[${childKey}]`, childValue)
    }
    return
  }
  form.append(key, value === null || value === undefined ? '' : String(value))
}

export function encodeDatatableForm(model: JsonObject): string {
  const form = new URLSearchParams()
  for (const [key, value] of Object.entries(model)) formAppend(form, key, value)
  return form.toString()
}

function modelFromServerRenderedConfig(
  config: DatatableExportConfig,
  filters: readonly JsonObject[],
): JsonObject | null {
  if (typeof config.DatatableId !== 'string' || !config.DatatableId) return null
  if (!Array.isArray(config.FieldList)) return null

  const columns = config.FieldList.map((field) => {
    const value = objectValue(field)
    return {
      data: value?.data ?? null,
      name: '',
      searchable: value?.searchable === true,
      orderable: value?.orderable === true,
      search: { value: '', regex: false },
    }
  })
  const page = integerValue(config.PageIndex, 0)
  const length = integerValue(config.PageLength, 10)
  const model: JsonObject = {
    draw: integerValue(config.InitialDrawCount, 1),
    page,
    start: page,
    length,
    columns,
    order: config.IsSortable === false
      ? []
      : [{
          column: integerValue(config.DefaultSortFieldIndex, 0),
          dir: stringValue(config.DefaultSortDirection, 'asc'),
        }],
    DatatableId: config.DatatableId,
    IsEnableContactFields: true,
    filters,
  }
  return model
}

export function buildOfficialExportRequest(
  template: string | null,
  config: DatatableExportConfig | null,
  filters: readonly JsonObject[] = [],
): string {
  const model = template ? datatableModelFromTemplate(template) : null
  const exportModel = model ?? (config ? modelFromServerRenderedConfig(config, filters) : null)
  if (!exportModel) throw new Error('EXPORT_TEMPLATE_UNAVAILABLE')
  exportModel.IsEnableContactFields = true
  return encodeDatatableForm(exportModel)
}

