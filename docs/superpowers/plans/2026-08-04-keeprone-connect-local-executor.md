# KeeproneConnect Local Executor — Implementation Plan (Fase 0 + Fase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir três defeitos que impedem diagnóstico, e transformar a extensão KeeproneConnect de sincronizador de duas grades em executor de capabilities, com as 21 grades alcançáveis sem release na Chrome Web Store.

**Architecture:** A extensão carrega um catálogo fechado de capabilities e valida nome e parâmetros antes de executar. O servidor escolhe a capability e os parâmetros, recebe a resposta **crua** do carrier, e normaliza com os mapeadores puros que já existem (`toCaseSnapshots`, `toInforcePolicySnapshots`, `toReportRows`). A extensão deixa de normalizar.

**Tech Stack:** Next.js 16 (App Router, route handlers), Prisma/PostgreSQL, Zod, Vitest, WXT + TypeScript (extensão MV3), Playwright (apenas no worker remoto legado).

## Global Constraints

- A extensão nunca recebe URL arbitrária do backend. Só `{ capability, params }`, validados contra o catálogo local.
- Permissões da extensão inalteradas: sem `all_urls`, `cookies`, `chrome.debugger`, JS remoto, coleta de histórico.
- JSON cru do endpoint do próprio portal é permitido e necessário. HTML de página continua proibido nesta fase.
- Nenhuma capability desta fase escreve no carrier.
- Toda query filtra por `agentId` e `deploymentScope`. A API nunca aceita `agentId` ou `gridKey` do cliente como autoridade.
- Mensagens visíveis não contêm Auth0, cookies, IDs de sessão nem credenciais.
- `LOCAL_CONNECTOR_SCHEMA_VERSION` sobe para `2` ao introduzir o envelope cru.
- Commits em português, prefixo `feat:` / `fix:` / `docs:`, terminando com a linha `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## Escopo

Este plano cobre **Fase 0** (três correções) e **Fase 1** (contrato de capability + `READ_GRID` para as 21 grades).

**Fase 2 (Foresight na extensão) recebe plano próprio.** Ela depende do contrato entregue aqui e o seu escopo ainda é definido por dois experimentos não executados (`Rapid Solve cria o caso?` e `GetQuickCalcData devolve valores?`). Planejá-la agora produziria tarefas cujo escopo muda depois.

## File Structure

| Arquivo | Responsabilidade | Ação |
|---|---|---|
| `workers/national-life/run-job.ts` | Roteamento de erro do worker remoto | Modificar |
| `app/api/agent/integrations/national-life/local-connector/runs/route.ts` | Criação de run assinada | Modificar |
| `lib/national-life/interactive-connection-service.ts` | Estado de sessão do agente | Modificar |
| `lib/national-life/local-connector/capabilities.ts` | Catálogo de capabilities do servidor + validação de parâmetro | **Criar** |
| `lib/national-life/local-connector/contracts.ts` | Schemas do envelope | Modificar |
| `lib/national-life/local-connector/raw-ingest.ts` | Despacho de linha crua para os mapeadores puros existentes | **Criar** |
| `lib/national-life/local-connector/run-service.ts` | Ciclo de vida do run e ingestão de estágio | Modificar |
| `apps/keeprone-connect/lib/capabilities.ts` | Catálogo fechado da extensão + validação | **Criar** |
| `apps/keeprone-connect/lib/normalizers.ts` | Normalização duplicada | **Deletar** |
| `apps/keeprone-connect/entrypoints/background.ts` | Laço de execução | Modificar |
| `apps/keeprone-connect/entrypoints/nlg-main.content.ts` | Captura e repaginação | Modificar |

---

# FASE 0 — Correções

### Task 1: Sessão expirada do Foresight volta a pedir login

Hoje `toPortalLayoutChanged` ([adapter.ts:761](workers/national-life/adapter.ts#L761)) devolve o código de topo `PORTAL_LAYOUT_CHANGED` e enterra `FORESIGHT_SSO_EXPIRED` em `safeDetail.safeCode`, que **nada lê**. Como `PORTAL_LAYOUT_CHANGED` está em `MANUAL_REVIEW_CODES`, três dos quatro caminhos de expiração ([adapter.ts:496](workers/national-life/adapter.ts#L496), [:529](workers/national-life/adapter.ts#L529), [:715](workers/national-life/adapter.ts#L715)) mandam o job para revisão manual em vez de `ACTION_REQUIRED`.

A correção fica no worker, não no adapter: `PORTAL_LAYOUT_CHANGED` continua descrevendo corretamente "não achei o elemento". O que faltava era o worker olhar *por que*.

**Files:**
- Modify: `workers/national-life/run-job.ts` (função `getErrorCode` região ~346-355; handler ~508-540)
- Test: `workers/national-life/run-job.test.ts`

**Interfaces:**
- Consumes: `FORESIGHT_SSO_EXPIRED` de `lib/national-life/constants.ts` (já importado em `run-job.ts:8`)
- Produces: `getErrorSafeCode(error: unknown): string | undefined`

- [ ] **Step 1: Escrever o teste que falha**

Em `workers/national-life/run-job.test.ts`, junto dos testes de roteamento de erro existentes:

```ts
it('parks a Foresight job for login when the expiry is wrapped as a layout change', async () => {
  const error = Object.assign(new Error('National Life portal layout changed'), {
    code: 'PORTAL_LAYOUT_CHANGED',
    safeDetail: { safeCode: 'FORESIGHT_SSO_EXPIRED', portalUrl: 'https://www.nationallife.com/NWI' },
  })
  const deps = createDeps({ adapter: { readForesight: () => Promise.reject(error) } })

  await runJob(foresightJob, deps)

  expect(deps.jobStore.transitionJob).toHaveBeenCalledWith(
    expect.objectContaining({ to: 'ACTION_REQUIRED', safeErrorCode: 'FORESIGHT_SSO_EXPIRED' }),
  )
})

it('still routes a genuine layout change to manual review', async () => {
  const error = Object.assign(new Error('National Life portal layout changed'), {
    code: 'PORTAL_LAYOUT_CHANGED',
    safeDetail: { safeCode: 'SELECTOR_NOT_FOUND' },
  })
  const deps = createDeps({ adapter: { readForesight: () => Promise.reject(error) } })

  await runJob(foresightJob, deps)

  expect(deps.jobStore.transitionJob).toHaveBeenCalledWith(
    expect.objectContaining({ to: 'MANUAL_REVIEW' }),
  )
})
```

Use o helper de deps e o fixture de job Foresight já presentes no arquivo; não invente novos. Se os nomes locais diferirem (`createDeps`, `foresightJob`), adapte aos existentes sem mudar a asserção.

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run workers/national-life/run-job.test.ts -t "wrapped as a layout change"`
Expected: FAIL — `transitionJob` chamado com `to: 'MANUAL_REVIEW'` em vez de `'ACTION_REQUIRED'`.

- [ ] **Step 3: Implementar**

Adicionar, ao lado de `getErrorSafeDetail` em `workers/national-life/run-job.ts`:

```ts
/// The adapter reports "I could not find the element" as PORTAL_LAYOUT_CHANGED and
/// records the underlying reason in safeDetail.safeCode. A dead Foresight session is
/// one of those reasons, and it needs a login, not a human reading a diff.
function getErrorSafeCode(error: unknown): string | undefined {
  const detail = getErrorSafeDetail(error)
  if (detail && typeof detail === 'object' && 'safeCode' in detail) {
    const safeCode = (detail as { safeCode?: unknown }).safeCode
    if (typeof safeCode === 'string') return safeCode
  }
  return undefined
}
```

E trocar a condição existente em `run-job.ts:519`:

```ts
  if (code === FORESIGHT_SSO_EXPIRED || getErrorSafeCode(error) === FORESIGHT_SSO_EXPIRED) {
```

A ordem importa: esta verificação já está **antes** do bloco `MANUAL_REVIEW_CODES`, então nada mais muda.

- [ ] **Step 4: Rodar os testes**

Run: `npx vitest run workers/national-life/run-job.test.ts`
Expected: PASS, incluindo os dois novos.

- [ ] **Step 5: Commit**

```bash
git add workers/national-life/run-job.ts workers/national-life/run-job.test.ts
git commit -m "fix: pedir login quando o Foresight expira sob layout change

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: `POST /runs` para de mascarar erro de servidor como falha de assinatura

Hoje o `catch` engole tudo em `401 DEVICE_REQUEST_REJECTED`. Falha de banco vira "assinatura inválida" — exatamente na hora do smoke test real. As rotas irmãs `fail` e `stages` já discriminam corretamente; esta copia o padrão delas.

**Files:**
- Modify: `app/api/agent/integrations/national-life/local-connector/runs/route.ts`
- Test: `app/api/agent/integrations/national-life/local-connector/runs/route.test.ts` (**criar**)

**Interfaces:**
- Consumes: `LocalConnectorSignatureError` de `lib/national-life/local-connector/device-signature.ts`

- [ ] **Step 1: Escrever o teste que falha**

Criar `app/api/agent/integrations/national-life/local-connector/runs/route.test.ts`. Seguir a montagem de mocks de `app/api/agent/integrations/national-life/local-connector/pairings/route.test.ts` (mesmo diretório, mesmo padrão de `vi.mock`).

```ts
it('returns 401 only when the signature is rejected', async () => {
  mockVerify.mockRejectedValueOnce(new LocalConnectorSignatureError())
  const response = await POST(signedRequest())
  expect(response.status).toBe(401)
  expect(await response.json()).toEqual({ error: 'DEVICE_REQUEST_REJECTED' })
})

it('does not report a server failure as a rejected device', async () => {
  mockVerify.mockResolvedValueOnce({ deviceId: 'dev_1', agentId: 'agent_1' })
  mockStartRun.mockRejectedValueOnce(new Error('database unavailable'))
  const response = await POST(signedRequest())
  expect(response.status).toBe(500)
  expect(await response.json()).toEqual({ error: 'RUN_START_FAILED' })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run app/api/agent/integrations/national-life/local-connector/runs/route.test.ts`
Expected: FAIL no segundo teste — recebe 401/`DEVICE_REQUEST_REJECTED`.

- [ ] **Step 3: Implementar**

Em `runs/route.ts`, importar o erro de assinatura junto do verificador:

```ts
import {
  LocalConnectorSignatureError,
  verifyLocalConnectorDeviceRequest,
} from '@/lib/national-life/local-connector/device-signature'
```

E trocar o `catch`:

```ts
  } catch (error) {
    if (error instanceof LocalConnectorSignatureError) {
      return Response.json(
        { error: 'DEVICE_REQUEST_REJECTED' },
        { status: 401, headers: NO_STORE },
      )
    }
    if (error instanceof LocalConnectorRequestError) {
      return Response.json({ error: 'INVALID_REQUEST' }, { status: 400, headers: NO_STORE })
    }
    return Response.json({ error: 'RUN_START_FAILED' }, { status: 500, headers: NO_STORE })
  }
```

Três classes, três códigos: assinatura rejeitada é 401, corpo malformado ou grande
demais é falha do cliente e é 400, e o resto é falha nossa e é 500. `LocalConnectorRequestError`
vem de `lib/national-life/local-connector/request.ts` e é o que `readLimitedBody` lança
como `BODY_TOO_LARGE`. `RUN_START_FAILED` é opaco de propósito: diferencia a *classe*
do erro sem vazar detalhe interno.

- [ ] **Step 4: Rodar os testes**

Run: `npx vitest run app/api/agent/integrations/national-life/local-connector/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/agent/integrations/national-life/local-connector/runs/
git commit -m "fix: distinguir falha de servidor de assinatura rejeitada no start de run

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: `illustrationSsoReachable` para de mentir

O campo é escrito **apenas** por `scripts/national-life-keep-alive.ts:166`, e a keep-alive de SSO está desligada — então ele exibe estado velho ou `null` indefinidamente. Durante o incidente de 2026-07-31 mostrou `true` enquanto os jobs falhavam com `FORESIGHT_SSO_EXPIRED`.

Passa a ser derivado de resultado de job: um job Foresight que conclui prova alcance; um que expira prova o contrário.

**Files:**
- Modify: `lib/national-life/interactive-connection-service.ts` (perto de `:922` e `:945`)
- Modify: `workers/national-life/run-job.ts`
- Test: `lib/national-life/interactive-connection-service.test.ts`

**Interfaces:**
- Produces: `recordForesightReachability(input: { agentId: string; deploymentScope: string; reachable: boolean }): Promise<void>`

- [ ] **Step 1: Escrever o teste que falha**

Em `lib/national-life/interactive-connection-service.test.ts`:

```ts
it('marks Foresight unreachable when a job reports an expired session', async () => {
  await recordForesightReachability({
    agentId: 'agent_1',
    deploymentScope: 'SINGLE_DEPLOYMENT',
    reachable: false,
  })
  const summary = await getConnectionSummary('agent_1', 'SINGLE_DEPLOYMENT')
  expect(summary.illustrationSsoReachable).toBe(false)
})

it('marks Foresight reachable when a job completes', async () => {
  await recordForesightReachability({
    agentId: 'agent_1',
    deploymentScope: 'SINGLE_DEPLOYMENT',
    reachable: true,
  })
  const summary = await getConnectionSummary('agent_1', 'SINGLE_DEPLOYMENT')
  expect(summary.illustrationSsoReachable).toBe(true)
})
```

Usar o nome real do leitor de summary presente no arquivo (perto de `:922`/`:945`) em vez de `getConnectionSummary` se diferir.

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run lib/national-life/interactive-connection-service.test.ts -t "Foresight"`
Expected: FAIL — `recordForesightReachability` não existe.

- [ ] **Step 3: Implementar o escritor**

Em `lib/national-life/interactive-connection-service.ts`, exportar:

```ts
/// Derived from job outcomes, not from the keep-alive. The keep-alive SSO jump is
/// off — it was itself burning the Auth0 session — so a field only it wrote showed
/// a stale `true` while jobs failed with FORESIGHT_SSO_EXPIRED.
export async function recordForesightReachability(input: {
  agentId: string
  deploymentScope: string
  reachable: boolean
}): Promise<void> {
  await prisma.agentIntegrationSession.updateMany({
    where: {
      agentId: input.agentId,
      deploymentScope: input.deploymentScope,
      provider: 'NATIONAL_LIFE',
    },
    data: { illustrationSsoReachable: input.reachable },
  })
}
```

Conferir o nome real do model de sessão no `prisma/schema.prisma` antes de escrever (o serviço já o usa; copiar de lá).

- [ ] **Step 4: Ligar aos resultados de job**

Em `workers/national-life/run-job.ts`, adicionar o helper tolerante:

```ts
/// Telemetry must never fail a job that already produced its answer, which is why
/// this swallows — same rule as the session-context persistence below.
async function noteForesightReachability(
  job: { agentId: string; deploymentScope: string; operation: string },
  reachable: boolean,
): Promise<void> {
  if (job.operation !== 'SYNC_FORESIGHT_READ' && job.operation !== 'GENERATE_FORESIGHT_PDF') return
  try {
    await recordForesightReachability({
      agentId: job.agentId,
      deploymentScope: job.deploymentScope,
      reachable,
    })
  } catch {
    // ignored on purpose
  }
}
```

Chamar `await noteForesightReachability(job, true)` logo após a conclusão bem-sucedida de um job Foresight, e `await noteForesightReachability(job, false)` dentro do bloco `FORESIGHT_SSO_EXPIRED` da Task 1, antes do `return`. Conferir os nomes reais dos campos de `job` (`agentId`, `deploymentScope`, `operation`) no tipo local antes de escrever.

- [ ] **Step 5: Rodar os testes**

Run: `npx vitest run lib/national-life/interactive-connection-service.test.ts workers/national-life/run-job.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/national-life/interactive-connection-service.ts lib/national-life/interactive-connection-service.test.ts workers/national-life/run-job.ts
git commit -m "fix: derivar alcance do Foresight de resultado de job

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

# FASE 1 — Capabilities e as 21 grades

### Task 4: Catálogo de capabilities do servidor

**Files:**
- Create: `lib/national-life/local-connector/capabilities.ts`
- Test: `lib/national-life/local-connector/capabilities.test.ts`

**Interfaces:**
- Consumes: `NATIONAL_LIFE_GRIDS`, `NationalLifeGridKey` de `lib/national-life/portal-grid-client.ts`
- Produces:
  - `type LocalConnectorCapabilityName = 'READ_GRID'`
  - `type ReadGridParams = { gridKey: NationalLifeGridKey; navigatePath: string }`
  - `type LocalConnectorStagePlan = { capability: 'READ_GRID'; params: ReadGridParams }`
  - `planReadGridStages(gridKeys: readonly NationalLifeGridKey[]): LocalConnectorStagePlan[]`
  - `isSafeNavigatePath(path: string): boolean`

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { describe, expect, it } from 'vitest'
import { isSafeNavigatePath, planReadGridStages } from './capabilities'

describe('isSafeNavigatePath', () => {
  it('accepts a portal agent path', () => {
    expect(isSafeNavigatePath('/agent/book-of-business/new-business/all-new-business-cases')).toBe(true)
  })

  it('rejects anything outside the agent tree', () => {
    expect(isSafeNavigatePath('/NWI/Main/Layout.aspx')).toBe(false)
    expect(isSafeNavigatePath('/agent/../admin')).toBe(false)
    expect(isSafeNavigatePath('https://evil.example/agent/x')).toBe(false)
    expect(isSafeNavigatePath('//evil.example/agent/x')).toBe(false)
    expect(isSafeNavigatePath('/agent/x?next=/y')).toBe(false)
  })
})

describe('planReadGridStages', () => {
  it('maps each grid key to its portal path', () => {
    expect(planReadGridStages(['NEW_BUSINESS'])).toEqual([
      {
        capability: 'READ_GRID',
        params: {
          gridKey: 'NEW_BUSINESS',
          navigatePath: '/agent/book-of-business/new-business/all-new-business-cases',
        },
      },
    ])
  })

  it('produces a plan every grid key can reach', () => {
    const keys = Object.keys(NATIONAL_LIFE_GRIDS) as NationalLifeGridKey[]
    const plan = planReadGridStages(keys)
    expect(plan).toHaveLength(keys.length)
    expect(plan.every((stage) => isSafeNavigatePath(stage.params.navigatePath))).toBe(true)
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run lib/national-life/local-connector/capabilities.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

```ts
import 'server-only'
import {
  NATIONAL_LIFE_GRIDS,
  type NationalLifeGridKey,
} from '@/lib/national-life/portal-grid-client'

export type LocalConnectorCapabilityName = 'READ_GRID'

export type ReadGridParams = {
  gridKey: NationalLifeGridKey
  navigatePath: string
}

export type LocalConnectorStagePlan = {
  capability: 'READ_GRID'
  params: ReadGridParams
}

/// The extension refuses anything outside the agent tree. All 21 grids hit the same
/// endpoint — only the page you open first differs — so one capability covers them
/// all, and adding a grid is a deploy rather than a Chrome Web Store review.
export function isSafeNavigatePath(path: string): boolean {
  if (!path.startsWith('/agent/')) return false
  if (path.startsWith('//')) return false
  if (path.includes('..')) return false
  if (path.includes('?') || path.includes('#')) return false
  return /^[A-Za-z0-9/_-]+$/.test(path)
}

export function planReadGridStages(
  gridKeys: readonly NationalLifeGridKey[],
): LocalConnectorStagePlan[] {
  return gridKeys.map((gridKey) => {
    const navigatePath = NATIONAL_LIFE_GRIDS[gridKey]
    if (!isSafeNavigatePath(navigatePath)) {
      throw new Error(`Unsafe navigate path for grid ${gridKey}`)
    }
    return { capability: 'READ_GRID', params: { gridKey, navigatePath } }
  })
}
```

- [ ] **Step 4: Rodar os testes**

Run: `npx vitest run lib/national-life/local-connector/capabilities.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/national-life/local-connector/capabilities.ts lib/national-life/local-connector/capabilities.test.ts
git commit -m "feat: adicionar catálogo de capabilities do connector local

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Envelope de estágio cru

Substitui os schemas tipados por grade (`newBusinessRecordSchema`, `inforceClientRecordSchema`) por linhas cruas. A validação de forma deixa de ser por campo e passa a ser por *limite*: quantidade de linhas, profundidade e tamanho.

**Files:**
- Modify: `lib/national-life/local-connector/contracts.ts`
- Test: `lib/national-life/local-connector/contracts.test.ts`

**Interfaces:**
- Produces:
  - `LOCAL_CONNECTOR_SCHEMA_VERSION = 2`
  - `LOCAL_CONNECTOR_MAX_RECORDS = 200`
  - `rawGridRowSchema: z.ZodType<Record<string, unknown>>`
  - `localConnectorRawStageEnvelopeSchema`
  - `type LocalConnectorRawStageEnvelope`

- [ ] **Step 1: Escrever o teste que falha**

```ts
it('accepts a raw carrier row untouched', () => {
  const envelope = localConnectorRawStageEnvelopeSchema.parse({
    schemaVersion: 2,
    runId: 'run_1',
    gridKey: 'NEW_BUSINESS',
    sequence: 0,
    observedAt: '2026-08-04T00:00:00.000Z',
    recordsTotal: 1,
    truncated: false,
    records: [{ PolicyNo: 'X1', SomeColumnWeDoNotKnowAbout: 42, Nested: { a: 1 } }],
  })
  expect(envelope.records[0].SomeColumnWeDoNotKnowAbout).toBe(42)
})

it('rejects more records than the page cap', () => {
  const records = Array.from({ length: 201 }, (_, i) => ({ PolicyNo: `X${i}` }))
  expect(() =>
    localConnectorRawStageEnvelopeSchema.parse({
      schemaVersion: 2, runId: 'run_1', gridKey: 'NEW_BUSINESS', sequence: 0,
      observedAt: '2026-08-04T00:00:00.000Z', recordsTotal: 201, truncated: false, records,
    }),
  ).toThrow()
})

it('rejects a grid key outside the server allowlist', () => {
  expect(() =>
    localConnectorRawStageEnvelopeSchema.parse({
      schemaVersion: 2, runId: 'run_1', gridKey: 'NOT_A_GRID', sequence: 0,
      observedAt: '2026-08-04T00:00:00.000Z', recordsTotal: 0, truncated: false, records: [],
    }),
  ).toThrow()
})

it('rejects recordsTotal below the page it carries', () => {
  expect(() =>
    localConnectorRawStageEnvelopeSchema.parse({
      schemaVersion: 2, runId: 'run_1', gridKey: 'NEW_BUSINESS', sequence: 0,
      observedAt: '2026-08-04T00:00:00.000Z', recordsTotal: 0, truncated: false,
      records: [{ PolicyNo: 'X1' }],
    }),
  ).toThrow()
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run lib/national-life/local-connector/contracts.test.ts`
Expected: FAIL — `localConnectorRawStageEnvelopeSchema` não existe.

- [ ] **Step 3: Implementar**

Em `contracts.ts`, subir a versão e a página, e adicionar o envelope cru. **Manter** os schemas tipados e `localConnectorStageEnvelopeSchema` intactos nesta task — a Task 7 os remove depois que o caminho cru estiver verde, para que nenhuma etapa deixe a árvore quebrada.

```ts
export const LOCAL_CONNECTOR_SCHEMA_VERSION = 2
/// Raw carrier rows are fatter than normalized ones. 200 rows against the 2 MiB body
/// cap leaves headroom for the widest grid; the extension pages to match.
export const LOCAL_CONNECTOR_MAX_RECORDS = 200

const rawScalar = z.union([z.string().max(4_096), z.number(), z.boolean(), z.null()])

/// One level of nesting is enough for every carrier grid observed, and bounding depth
/// keeps a hostile payload from costing us parse time.
export const rawGridRowSchema = z.record(
  z.string().max(128),
  z.union([rawScalar, z.array(rawScalar).max(64), z.record(z.string().max(128), rawScalar)]),
)

export const localConnectorRawStageEnvelopeSchema = z
  .strictObject({
    schemaVersion: z.literal(LOCAL_CONNECTOR_SCHEMA_VERSION),
    runId: z.string().min(1).max(128),
    gridKey: z.enum(
      Object.keys(NATIONAL_LIFE_GRIDS) as [NationalLifeGridKey, ...NationalLifeGridKey[]],
    ),
    sequence: z.number().int().min(0).max(10_000),
    observedAt: z.string().datetime(),
    recordsTotal: z.number().int().min(0),
    truncated: z.boolean(),
    records: z.array(rawGridRowSchema).max(LOCAL_CONNECTOR_MAX_RECORDS),
  })
  .superRefine((envelope, ctx) => {
    if (envelope.recordsTotal < envelope.records.length) {
      ctx.addIssue({ code: 'custom', message: 'recordsTotal is below the page it carries' })
    }
  })

export type LocalConnectorRawStageEnvelope = z.infer<typeof localConnectorRawStageEnvelopeSchema>
```

`NATIONAL_LIFE_GRIDS` é importado de `@/lib/national-life/portal-grid-client`.

- [ ] **Step 4: Rodar os testes**

Run: `npx vitest run lib/national-life/local-connector/contracts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/national-life/local-connector/contracts.ts lib/national-life/local-connector/contracts.test.ts
git commit -m "feat: adicionar envelope de estágio cru do connector local

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Despacho de ingestão crua

O ponto da fase inteira: as linhas cruas passam pelos **mapeadores puros que já existem** e vão para a tabela correta. Reproduz o roteamento de `lib/national-life/sync-grid.ts:20-30`.

**Restrição de integração:** `persistCaseSnapshots`, `persistInforcePolicies` e `persistReportRows` usam o `prisma` de módulo, não um cliente de transação — então **não** podem ser chamadas de dentro da transação de `ingestLocalConnectorStage`. Esta task usa apenas os mapeadores puros (`toCaseSnapshots`, `toInforcePolicySnapshots`, `toReportRows`) e deixa o upsert transacional já existente em `run-service.ts:persistRecords` fazer a escrita.

**Files:**
- Create: `lib/national-life/local-connector/raw-ingest.ts`
- Test: `lib/national-life/local-connector/raw-ingest.test.ts`

**Interfaces:**
- Consumes: `toCaseSnapshots(rows: GridRow[]): CaseSnapshot[]`, `toInforcePolicySnapshots(rows: GridRow[]): InforcePolicySnapshot[]`, `toReportRows(gridKey: NationalLifeGridKey, rows: GridRow[]): ReportRow[]`
- Produces:
  - `type RawIngestPlan = { target: 'CASE_SNAPSHOT'; snapshots: CaseSnapshot[] } | { target: 'INFORCE_POLICY'; snapshots: InforcePolicySnapshot[] } | { target: 'REPORT_ROW'; rows: ReportRow[] }`
  - `planRawIngest(gridKey: NationalLifeGridKey, rows: Record<string, unknown>[]): RawIngestPlan`

- [ ] **Step 1: Escrever o teste que falha**

```ts
it('routes new business rows to case snapshots and keeps the raw row', () => {
  const plan = planRawIngest('NEW_BUSINESS', [
    { PolicyNo: 'X1', InsuredName: 'Maria Silva', UnknownColumn: 'keep me' },
  ])
  // Narrow before touching `snapshots`: RawIngestPlan is a union and the
  // REPORT_ROW arm carries `rows`, so an unnarrowed access fails typecheck.
  if (plan.target !== 'CASE_SNAPSHOT') throw new Error('expected CASE_SNAPSHOT')
  expect(plan.snapshots[0].raw).toMatchObject({ UnknownColumn: 'keep me' })
})

it('routes inforce rows to policies', () => {
  const plan = planRawIngest('INFORCE_CLIENTS', [{ PolicyNumber: 'P1' }])
  expect(plan.target).toBe('INFORCE_POLICY')
})

it('routes commission rows to report rows', () => {
  const plan = planRawIngest('PAID_COMMISSIONS', [{ PolicyNumber: 'P1' }])
  expect(plan.target).toBe('REPORT_ROW')
})

it('rejects a grid key it does not route', () => {
  expect(() => planRawIngest('NOT_A_GRID' as never, [])).toThrow()
})
```

A asserção sobre `raw` é a que fecha o achado de `raw: {}`. Se `toCaseSnapshot` não preencher `raw`, o teste falha e é a implementação da Task 6 que está errada, não o teste.

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run lib/national-life/local-connector/raw-ingest.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

```ts
import 'server-only'
import { toCaseSnapshots, type CaseSnapshot } from '@/lib/national-life/case-snapshot-service'
import {
  toInforcePolicySnapshots,
  type InforcePolicySnapshot,
} from '@/lib/national-life/inforce-policy-service'
import { toReportRows, type ReportRow } from '@/lib/national-life/report-row-service'
import type { NationalLifeGridKey } from '@/lib/national-life/portal-grid-client'

const CASE_SNAPSHOT_GRIDS = new Set<NationalLifeGridKey>(['NEW_BUSINESS', 'RECENTLY_CLOSED'])
const INFORCE_GRIDS = new Set<NationalLifeGridKey>(['INFORCE_CLIENTS'])
const REPORT_ROW_GRIDS = new Set<NationalLifeGridKey>([
  'PAID_COMMISSIONS',
  'PROJECTED_COMMISSIONS',
  'CLIENT_INTELLIGENCE',
  'CORRESPONDENCE',
  'COMMISSIONS_PAYMENT_PORTAL',
  'PIP_PENDING',
])

export type RawIngestPlan =
  | { target: 'CASE_SNAPSHOT'; gridKey: NationalLifeGridKey; snapshots: CaseSnapshot[] }
  | { target: 'INFORCE_POLICY'; gridKey: NationalLifeGridKey; snapshots: InforcePolicySnapshot[] }
  | { target: 'REPORT_ROW'; gridKey: NationalLifeGridKey; rows: ReportRow[] }

/// Mirrors the routing in sync-grid.ts so the local and remote paths cannot drift.
/// Pure: the caller owns the write, because the persist helpers bind the module-level
/// Prisma client and cannot run inside the stage-ingest transaction.
export function planRawIngest(
  gridKey: NationalLifeGridKey,
  rows: Record<string, unknown>[],
): RawIngestPlan {
  if (CASE_SNAPSHOT_GRIDS.has(gridKey)) {
    return { target: 'CASE_SNAPSHOT', gridKey, snapshots: toCaseSnapshots(rows) }
  }
  if (INFORCE_GRIDS.has(gridKey)) {
    return { target: 'INFORCE_POLICY', gridKey, snapshots: toInforcePolicySnapshots(rows) }
  }
  if (REPORT_ROW_GRIDS.has(gridKey)) {
    return { target: 'REPORT_ROW', gridKey, rows: toReportRows(gridKey, rows) }
  }
  throw new Error(`No ingest route for grid ${gridKey}`)
}
```

Grades conhecidas por `NATIONAL_LIFE_GRIDS` mas ausentes dos três conjuntos (por exemplo `PLACEMENT_REPORT`) lançam de propósito: só entram quando alguém decidir onde persistem.

- [ ] **Step 4: Rodar os testes**

Run: `npx vitest run lib/national-life/local-connector/raw-ingest.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/national-life/local-connector/raw-ingest.ts lib/national-life/local-connector/raw-ingest.test.ts
git commit -m "feat: rotear linha crua do connector para os mapeadores existentes

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Run e estágio passam a operar sobre capabilities e linhas cruas

**Files:**
- Modify: `lib/national-life/local-connector/run-service.ts`
- Modify: `app/api/agent/integrations/national-life/local-connector/runs/[runId]/stages/[gridKey]/route.ts`
- Modify: `lib/national-life/local-connector/contracts.ts` (remover os schemas tipados)
- Test: `lib/national-life/local-connector/run-service.test.ts`

**Interfaces:**
- Consumes: `planReadGridStages`, `LocalConnectorStagePlan` (Task 4); `localConnectorRawStageEnvelopeSchema` (Task 5); `planRawIngest` (Task 6)
- Produces: `startLocalConnectorRun` passa a devolver `{ runId, schemaVersion, stages: LocalConnectorStagePlan[], duplicate }`

- [ ] **Step 1: Escrever os testes que falham**

Em `run-service.test.ts`:

```ts
it('returns a capability plan instead of bare grid keys', async () => {
  const run = await startLocalConnectorRun(prisma, device)
  expect(run.schemaVersion).toBe(2)
  expect(run.stages[0]).toEqual({
    capability: 'READ_GRID',
    params: {
      gridKey: 'NEW_BUSINESS',
      navigatePath: '/agent/book-of-business/new-business/all-new-business-cases',
    },
  })
})

it('persists the untouched carrier row', async () => {
  await ingestLocalConnectorStage(prisma, {
    ...device,
    runId: run.runId,
    gridKey: 'NEW_BUSINESS',
    idempotencyKey: 'nlc:run_1:NEW_BUSINESS:0',
    envelope: {
      schemaVersion: 2, runId: run.runId, gridKey: 'NEW_BUSINESS', sequence: 0,
      observedAt: '2026-08-04T00:00:00.000Z', recordsTotal: 1, truncated: false,
      records: [{ PolicyNo: 'X1', InsuredName: 'Maria Silva', UnknownColumn: 'keep me' }],
    },
  })
  const stored = await prisma.nationalLifeCaseSnapshot.findFirst({ where: { policyNo: 'X1' } })
  expect(stored?.raw).toMatchObject({ UnknownColumn: 'keep me' })
})

it('accepts a grid beyond the original two', async () => {
  const run = await startLocalConnectorRun(prisma, device, { gridKeys: ['PAID_COMMISSIONS'] })
  expect(run.stages).toHaveLength(1)
  expect(run.stages[0].params.gridKey).toBe('PAID_COMMISSIONS')
})
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run lib/national-life/local-connector/run-service.test.ts`
Expected: FAIL — `stages` ainda são strings; `raw` ainda é `{}`.

- [ ] **Step 3: Implementar**

Em `run-service.ts`:
1. Trocar a constante `LOCAL_CONNECTOR_GRID_KEYS` por um default derivado de `planReadGridStages`. Manter `['NEW_BUSINESS', 'INFORCE_CLIENTS']` como default para não mudar comportamento junto com estrutura; grades adicionais entram por parâmetro.
2. `startLocalConnectorRun(prisma, device, options?: { gridKeys?: readonly NationalLifeGridKey[] })` — `totalStages` passa a ser `stages.length`; `currentGridKey` é `stages[0].params.gridKey`.
3. Em `persistRecords`, substituir o mapeamento manual por `planRawIngest(gridKey, envelope.records)` e ramificar por `plan.target`, mantendo os `upsert` transacionais e o chunking de 100 que já existem. O `raw` de cada upsert passa a ser a linha crua correspondente, vinda do snapshot mapeado — **remover os dois `raw: {}`**.
4. A completude por `truncated: false` continua como está; ela agora encerra sobre `stages.length`.

Na rota de estágio, trocar `localConnectorStageEnvelopeSchema` por `localConnectorRawStageEnvelopeSchema`. A verificação cruzada de `runId`/`gridKey` contra a URL permanece.

Só depois de os testes passarem, remover de `contracts.ts`: `newBusinessRecordSchema`, `inforceClientRecordSchema`, `localConnectorStageEnvelopeSchema`, `normalizedText` e `GRID_KEYS`, mais os testes que os cobrem.

- [ ] **Step 4: Rodar a suíte inteira**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS, zero erro de tipo. Erros de tipo aqui são o sinal de que algo ainda importa os schemas removidos.

- [ ] **Step 5: Commit**

```bash
git add lib/national-life/local-connector/ app/api/agent/integrations/national-life/local-connector/
git commit -m "feat: run do connector opera sobre capabilities e linha crua

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Catálogo fechado na extensão

**Files:**
- Create: `apps/keeprone-connect/lib/capabilities.ts`
- Test: `apps/keeprone-connect/lib/capabilities.test.ts`

**Interfaces:**
- Produces: `parseStagePlan(value: unknown): StagePlan[]`, `type StagePlan = { capability: 'READ_GRID'; params: { gridKey: string; navigatePath: string } }`

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { describe, expect, it } from 'vitest'
import { parseStagePlan } from './capabilities'

it('accepts a READ_GRID stage from the server', () => {
  const plan = parseStagePlan([
    { capability: 'READ_GRID', params: { gridKey: 'PAID_COMMISSIONS', navigatePath: '/agent/compensation/commissions/paid-commissions' } },
  ])
  expect(plan[0].params.gridKey).toBe('PAID_COMMISSIONS')
})

it('refuses a capability it does not implement', () => {
  expect(() => parseStagePlan([{ capability: 'SUBMIT_APPLICATION', params: {} }])).toThrow('UNKNOWN_CAPABILITY')
})

it('refuses a path outside the agent tree', () => {
  for (const navigatePath of ['/NWI/Main/Layout.aspx', 'https://evil.example/agent/x', '//evil.example/agent/x', '/agent/../admin', '/agent/x?next=/y']) {
    expect(() =>
      parseStagePlan([{ capability: 'READ_GRID', params: { gridKey: 'X', navigatePath } }]),
    ).toThrow('UNSAFE_NAVIGATE_PATH')
  }
})

it('refuses extra properties', () => {
  expect(() =>
    parseStagePlan([{ capability: 'READ_GRID', params: { gridKey: 'X', navigatePath: '/agent/x' }, extra: 1 }]),
  ).toThrow()
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `cd apps/keeprone-connect && npx vitest run lib/capabilities.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

Sem Zod: a extensão não tem essa dependência, e `lib/messages.ts` já valida à mão com `hasExactKeys`. Seguir esse padrão.

```ts
import { hasExactKeys } from './messages'

export type StagePlan = {
  capability: 'READ_GRID'
  params: { gridKey: string; navigatePath: string }
}

const IMPLEMENTED = new Set(['READ_GRID'])
const MAX_STAGES = 32

/// The server picks which capability runs and with what parameters, but the catalogue
/// lives here. A compromised backend can reorder our own operations; it cannot invent
/// one, and it cannot point us outside the agent tree.
function isSafeNavigatePath(path: string): boolean {
  if (typeof path !== 'string') return false
  if (!path.startsWith('/agent/')) return false
  if (path.startsWith('//')) return false
  if (path.includes('..')) return false
  if (path.includes('?') || path.includes('#')) return false
  return /^[A-Za-z0-9/_-]+$/.test(path)
}

export function parseStagePlan(value: unknown): StagePlan[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_STAGES) {
    throw new Error('INVALID_RUN_RESPONSE')
  }
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object' || !hasExactKeys(entry, ['capability', 'params'])) {
      throw new Error('INVALID_RUN_RESPONSE')
    }
    const { capability, params } = entry as { capability: unknown; params: unknown }
    if (typeof capability !== 'string' || !IMPLEMENTED.has(capability)) {
      throw new Error('UNKNOWN_CAPABILITY')
    }
    if (!params || typeof params !== 'object' || !hasExactKeys(params, ['gridKey', 'navigatePath'])) {
      throw new Error('INVALID_RUN_RESPONSE')
    }
    const { gridKey, navigatePath } = params as { gridKey: unknown; navigatePath: unknown }
    if (typeof gridKey !== 'string' || gridKey.length === 0 || gridKey.length > 64) {
      throw new Error('INVALID_RUN_RESPONSE')
    }
    if (typeof navigatePath !== 'string' || !isSafeNavigatePath(navigatePath)) {
      throw new Error('UNSAFE_NAVIGATE_PATH')
    }
    return { capability: 'READ_GRID', params: { gridKey, navigatePath } }
  })
}
```

Se `hasExactKeys` não estiver exportado de `lib/messages.ts`, exportá-lo.

- [ ] **Step 4: Rodar os testes**

Run: `cd apps/keeprone-connect && npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/keeprone-connect/lib/capabilities.ts apps/keeprone-connect/lib/capabilities.test.ts apps/keeprone-connect/lib/messages.ts
git commit -m "feat: adicionar catálogo fechado de capabilities na extensão

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Extensão executa o plano do servidor e para de normalizar

**Files:**
- Modify: `apps/keeprone-connect/entrypoints/background.ts`
- Modify: `apps/keeprone-connect/entrypoints/nlg-main.content.ts`
- Modify: `apps/keeprone-connect/lib/paging.ts`
- Delete: `apps/keeprone-connect/lib/normalizers.ts`, `apps/keeprone-connect/lib/normalizers.test.ts`
- Modify: `apps/keeprone-connect/lib/constants.ts` (remover `GRID_PATHS`, `GRID_KEYS`, `GridKey`)
- Test: `apps/keeprone-connect/lib/paging.test.ts`

**Interfaces:**
- Consumes: `parseStagePlan`, `StagePlan` (Task 8)

- [ ] **Step 1: Escrever o teste que falha**

Em `apps/keeprone-connect/lib/paging.test.ts`:

```ts
it('pages at the raw-row size cap', () => {
  expect(PAGE_SIZE).toBe(200)
})

it('marks only the page that is actually short as truncated', () => {
  const page = parsePortalPage({ data: [{ PolicyNo: 'X1' }], recordsTotal: 500 })
  expect(page.truncated).toBe(false)
})

it('marks truncated when the carrier total exceeds what we will fetch', () => {
  const page = parsePortalPage({ data: [{ PolicyNo: 'X1' }], recordsTotal: 200_001 })
  expect(page.truncated).toBe(true)
})
```

O segundo teste é o que fecha a divergência de `truncated`: hoje `parsePortalPage` marca a grade inteira como truncada quando o total passa do teto, e o servidor nunca conclui o estágio.

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `cd apps/keeprone-connect && npx vitest run lib/paging.test.ts`
Expected: FAIL — `PAGE_SIZE` é 500.

- [ ] **Step 3: Implementar paginação**

Em `paging.ts`: `PAGE_SIZE = 200`, e `MAX_PORTAL_RECORDS = 200_000`. `truncated` continua derivando do teto, mas o teto passa a ser alto o bastante para que nenhuma grade real o alcance — e, quando alcançar, o servidor deixará o run em aberto de propósito, que é o comportamento correto para dado incompleto.

- [ ] **Step 4: Implementar o laço dirigido por plano**

Em `background.ts`:
1. `createRun` passa a chamar `parseStagePlan(response.stages)` e guarda o plano no estado do run (`chrome.storage.local`), em vez de validar duas chaves fixas.
2. `navigatePendingGrid` navega para `stage.params.navigatePath` do estágio corrente do plano, em vez de `GRID_PATHS[nextGrid]`.
3. `handleTabReady` compara com o `navigatePath` do estágio corrente.
4. `finishGrid` avança para o próximo índice do plano; conclui quando o índice passa do fim.
5. `uploadChunk` envia `schemaVersion: 2` e as linhas **cruas**, sem passar por normalizador.

Em `nlg-main.content.ts`: remover a chamada a `normalizeRows` e emitir as linhas como vieram de `parsePortalPage`. **Remover também a deduplicação por número de apólice** — tanto a de dentro de `normalizeRows` quanto o `Set` `seen` que atravessa páginas — porque ela dependia de conhecer o campo-chave de cada grade, que é exatamente o conhecimento que sai da extensão nesta task. A deduplicação passa a ser do servidor, pela chave de upsert. Manter os limites de tamanho na validação de chunk.

Deletar `normalizers.ts` e `normalizers.test.ts`. Remover `GRID_PATHS`, `GRID_KEYS` e `GridKey` de `constants.ts`.

- [ ] **Step 5: Rodar tudo**

Run: `cd apps/keeprone-connect && npx vitest run && cd ../.. && npx vitest run && npx tsc --noEmit`
Expected: PASS nos dois projetos, zero erro de tipo.

- [ ] **Step 6: Build da extensão**

Run: `cd apps/keeprone-connect && npx wxt build`
Expected: build sem erro. Confirmar que o manifest gerado **não** ganhou permissão nova — `permissions` continua `['storage','tabs']` e `host_permissions` continua com os dois hosts.

- [ ] **Step 7: Commit**

```bash
git add apps/keeprone-connect/
git commit -m "feat: extensão executa o plano do servidor sem normalizar

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Verificação final

- [ ] `npx vitest run` na raiz — verde
- [ ] `cd apps/keeprone-connect && npx vitest run` — verde
- [ ] `npx tsc --noEmit` — limpo
- [ ] `npx eslint .` — sem aviso novo em relação à base
- [ ] Manifest gerado sem permissão nova
- [ ] Smoke test manual com sessão real: run completa NEW_BUSINESS + INFORCE_CLIENTS, e uma grade nova (`PAID_COMMISSIONS`) alcançada **sem** recarregar a extensão

## O que este plano deliberadamente não faz

- Não implementa Foresight na extensão — plano próprio, após os dois experimentos.
- Não implementa `chrome.alarms` nem keep-alive.
- Não introduz `WAITING_FOR_CONFIRMATION` nem tira a espera humana do relógio de
  staleness. Isso pertence ao Action Center (Fase 3 da spec) e só faz sentido quando
  existir uma operação que peça confirmação — nenhuma desta fase pede.
- Não corrige o reaper preguiçoso de run parado, o `COMPLETED` grudento no storage, nem a ausência de varredor de `NationalLifeConnectorReplay`. São dívida registrada, não escopo desta fase.
- Não toca na listagem da Chrome Web Store.
- Não escreve nada no carrier.
