export type PageSnapshotRecord = Record<string, unknown>

/// Dimensionado contra o **pior caso do escape do JSON**, não contra o tamanho
/// do texto. O teto por linha das duas pontas (16 KiB) é medido sobre o texto já
/// serializado, e cada aspa ou barra invertida vira dois caracteres ali. Um bloco
/// de 12.000 caracteres cabia enquanto o texto fosse comum e estourava a partir
/// de ~36% de aspas — e um registro acima do teto não é recusado sozinho: ele faz
/// `parsePageCaptureAck` rejeitar o retrato inteiro, o que derruba o estágio com
/// `BRIDGE_UNAVAILABLE` e volta a derrubar em cada tentativa, porque a página
/// recapturada é a mesma. A 7.500, mesmo um bloco 100% de aspas cabe.
///
/// `MAX_TEXT_CHUNKS` sobe junto para preservar o mesmo total de 240.000
/// caracteres de texto por página: o teto existe para limitar a página, não para
/// perder texto quando o bloco encolhe.
const TEXT_CHUNK_SIZE = 7_500
const MAX_TEXT_CHUNKS = 32
const MAX_TABLE_ROWS = 2_000
const MAX_LINKS = 500
const MAX_FIELDS = 500

function clean(value: string | null | undefined, limit = 2_000): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit)
}

function safeAgentHref(anchor: HTMLAnchorElement, pageUrl: URL): string | null {
  try {
    const raw = anchor.getAttribute('href')
    if (!raw) return null
    const url = new URL(raw, pageUrl)
    if (url.origin !== pageUrl.origin || !url.pathname.startsWith('/agent/')) return null
    return `${url.pathname}${url.search}`.slice(0, 2_000)
  } catch {
    return null
  }
}

function safeFieldValue(element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement) {
  if (element instanceof HTMLInputElement) {
    const type = element.type.toLowerCase()
    if (type === 'password' || type === 'hidden' || type === 'file') return null
    if (/token|password|secret|csrf|verification/i.test(element.name || element.id)) return null
    if (type === 'checkbox' || type === 'radio') return element.checked ? 'checked' : 'unchecked'
  }
  return clean(element.value, 500)
}

/// Captures the information a human can read on a server-rendered National Life
/// page without retaining executable HTML, scripts, cookies, antiforgery tokens,
/// passwords, or file inputs. Records stay below the connector's 16 KiB row cap.
export function capturePageSnapshot(document: Document, pageUrl: URL): PageSnapshotRecord[] {
  const records: PageSnapshotRecord[] = []
  const headings = [...document.querySelectorAll('h1, h2, h3')]
    .map((element) => clean(element.textContent, 300))
    .filter(Boolean)
    .slice(0, 20)

  records.push({
    RecordType: 'PAGE_META',
    Path: `${pageUrl.pathname}${pageUrl.search}`,
    Title: clean(document.title, 500),
    Headings: headings,
  })

  const bodyText = clean(document.body?.innerText || document.body?.textContent, TEXT_CHUNK_SIZE * MAX_TEXT_CHUNKS)
  for (let offset = 0, chunkIndex = 0; offset < bodyText.length; offset += TEXT_CHUNK_SIZE, chunkIndex += 1) {
    records.push({
      RecordType: 'PAGE_TEXT',
      ChunkIndex: chunkIndex,
      Text: bodyText.slice(offset, offset + TEXT_CHUNK_SIZE),
    })
  }

  let tableRows = 0
  for (const [tableIndex, table] of [...document.querySelectorAll('table')].entries()) {
    const headers = [...table.querySelectorAll('thead th')]
      .map((cell) => clean(cell.textContent, 400))
      .slice(0, 12)
    records.push({
      RecordType: 'TABLE_META',
      TableIndex: tableIndex,
      Headers: headers,
    })
    for (const [rowIndex, row] of [...table.querySelectorAll('tbody tr')].entries()) {
      if (tableRows >= MAX_TABLE_ROWS) break
      const cells = [...row.querySelectorAll('th, td')]
        .map((cell) => clean(cell.textContent, 400))
        .slice(0, 12)
      records.push({
        RecordType: 'TABLE_ROW',
        TableIndex: tableIndex,
        RowIndex: rowIndex,
        Cells: cells,
      })
      tableRows += 1
    }
    if (tableRows >= MAX_TABLE_ROWS) break
  }

  let fieldCount = 0
  for (const [formIndex, form] of [...document.querySelectorAll('form')].entries()) {
    for (const field of [...form.querySelectorAll('input, select, textarea')]) {
      if (fieldCount >= MAX_FIELDS) break
      if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement)) continue
      const value = safeFieldValue(field)
      if (value === null) continue
      records.push({
        RecordType: 'FORM_FIELD',
        FormIndex: formIndex,
        Name: clean(field.name || field.id, 500),
        InputType: field instanceof HTMLInputElement ? clean(field.type, 100) : field.tagName.toLowerCase(),
        Value: value,
      })
      fieldCount += 1
    }
    if (fieldCount >= MAX_FIELDS) break
  }

  const seenLinks = new Set<string>()
  for (const anchor of [...document.querySelectorAll('a[href]')]) {
    if (!(anchor instanceof HTMLAnchorElement)) continue
    const href = safeAgentHref(anchor, pageUrl)
    if (!href || seenLinks.has(href)) continue
    seenLinks.add(href)
    records.push({
      RecordType: 'AGENT_LINK',
      Href: href,
      Label: clean(anchor.textContent, 500),
    })
    if (seenLinks.size >= MAX_LINKS) break
  }

  return records
}
