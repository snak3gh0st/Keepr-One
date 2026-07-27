import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const fixturesDir = path.resolve(__dirname, '../tests/fixtures/national-life')
const host = '127.0.0.1'

type FixtureServer = {
  origin: string
  close(): Promise<void>
}

export async function startNationalLifeFixtureServer(port = 0): Promise<FixtureServer> {
  const loginHtml = await readFixture('login.html')
  const mfaHtml = await readFixture('mfa.html')
  const failedLoginHtml = await readFixture('failed-login.html')
  const caseResultsHtml = await readFixture('case-results.html')
  const caseDetailHtml = await readFixture('case-detail.html')
  const changedLayoutHtml = await readFixture('changed-layout.html')

  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? '/', `http://${host}`)

    if (request.method === 'GET' && requestUrl.pathname === '/login') {
      return sendHtml(response, loginHtml)
    }

    if (request.method === 'GET' && requestUrl.pathname === '/mfa') {
      return sendHtml(response, mfaHtml)
    }

    if (request.method === 'GET' && requestUrl.pathname === '/login/failed') {
      return sendHtml(response, failedLoginHtml)
    }

    if (request.method === 'POST' && requestUrl.pathname === '/session/login') {
      const body = await readBody(request)
      const form = new URLSearchParams(body)
      const username = form.get('username')?.trim().toLowerCase() ?? ''
      const location = username.includes('mfa')
        ? '/mfa'
        : username.includes('denied')
          ? '/login/failed'
          : '/cases/search'

      response.statusCode = 303
      response.setHeader('Location', location)
      response.end()
      return
    }

    if (request.method === 'GET' && requestUrl.pathname === '/cases/search') {
      const applicationId = requestUrl.searchParams.get('applicationId')?.trim() || 'NLG-TEST-1001'
      const detailPath = buildDetailPath(applicationId)
      return sendHtml(
        response,
        caseResultsHtml
          .replaceAll('{{APPLICATION_ID}}', escapeHtml(applicationId))
          .replaceAll('{{DETAIL_PATH}}', escapeHtml(detailPath)),
      )
    }

    if (request.method === 'GET' && requestUrl.pathname === '/cases/detail/NLG-TEST-CHANGED') {
      return sendHtml(response, changedLayoutHtml)
    }

    if (request.method === 'GET' && requestUrl.pathname === '/cases/detail/NLG-TEST-UNEXPECTED') {
      return sendHtml(
        response,
        caseDetailHtml.replaceAll('{{APPLICATION_ID}}', 'NLG-TEST-1001'),
      )
    }

    if (request.method === 'GET' && requestUrl.pathname.startsWith('/cases/detail/')) {
      const applicationId = requestUrl.pathname.split('/').at(-1) ?? 'NLG-TEST-1001'
      return sendHtml(
        response,
        caseDetailHtml.replaceAll('{{APPLICATION_ID}}', escapeHtml(applicationId)),
      )
    }

    response.statusCode = 404
    response.end('Not found')
  })

  await listen(server, port)
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Fixture server failed to bind to 127.0.0.1')
  }

  return {
    origin: `http://${host}:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      }),
  }
}

async function readFixture(filename: string) {
  return readFile(path.join(fixturesDir, filename), 'utf8')
}

function buildDetailPath(applicationId: string) {
  return `/cases/detail/${encodeURIComponent(applicationId)}`
}

function sendHtml(response: ServerResponse<IncomingMessage>, html: string) {
  response.statusCode = 200
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  response.end(html)
}

function readBody(request: IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = []

    request.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })

    request.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'))
    })

    request.on('error', reject)
  })
}

function listen(server: Server, port: number) {
  return new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      server.off('error', reject)
      resolve()
    })
  })
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const requestedPort = Number(process.env.PORT ?? '4173')

  startNationalLifeFixtureServer(Number.isFinite(requestedPort) ? requestedPort : 4173)
    .then((server) => {
      process.stdout.write(`National Life fixture server listening at ${server.origin}\n`)
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      process.stderr.write(`${message}\n`)
      process.exitCode = 1
    })
}
