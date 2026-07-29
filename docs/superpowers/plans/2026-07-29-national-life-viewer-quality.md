# National Life Viewer Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the complete National Life login page sharply in a proportional embedded browser without changing the secure authentication or worker-session flow.

**Architecture:** One `1600x1000` profile is shared by the interactive Steel session and private Xvfb display. A dedicated fail-closed build patch changes the pinned Steel screencast JPEG quality from `75` to `92`, independent from the existing privacy patch. The existing signed broker iframe is placed in a centered, capped 16:10 viewer stage rather than stretched to arbitrary modal dimensions.

**Tech Stack:** Next.js 16, React 19, Tailwind CSS 4, TypeScript, Steel SDK 0.18, self-hosted Steel/Chromium, Xvfb, Docker Compose, Vitest.

## Global Constraints

- Product-facing copy says **Keepr One**, never Fyntra.
- Preserve the real National Life/Auth0 page; never inject carrier CSS or JavaScript.
- Interactive profile is exactly `1600x1000`, Xvfb is exactly `1600x1000x24`, device scale factor remains `1`, and screencast JPEG quality is exactly `92`.
- Do not alter restored worker sessions, authentication detection, encrypted `sessionContext`, viewer tokens, navigation allowlists, or ownership checks.
- Preserve iframe `sandbox="allow-forms allow-scripts allow-same-origin"`, `referrerPolicy="no-referrer"`, cancellation, MFA, and broker bootstrap behavior.
- Keep the quality patch independent from `deploy/national-life-steel-privacy-patch.mjs`, and make it fail closed when the pinned Steel source changes.
- Full page only: scale down proportionally on small screens, letterbox unused space, never crop, zoom, or stretch beyond the `1600x1000` source.
- Preserve unrelated local changes in `components/PublicLanding.tsx`, `Jenkinsfile`, and `.superpowers/`.
- Start from current `origin/main`, use a PR, and merge only after review; never push directly to `main`.

## File Structure

- `workers/national-life/steel-session.ts` and `.test.ts` — interactive Steel dimension contract.
- `deploy/national-life-runtime.compose.yaml` and `.test.ts` — matching private display profile.
- `deploy/national-life-steel-quality-patch.mjs` and `.test.ts` — exact-once JPEG quality patch contract.
- `Dockerfile.national-life-steel` — invokes privacy and quality patches independently during image build.
- `app/agent/integrations/national-life/NationalLifeBrowserModal.tsx` and `.test.tsx` — secure iframe inside a proportional viewer surface.
- `docs/operations/national-life-interactive-login-rollout.md` — fresh-attempt deploy proof and rollback checklist.

---

### Task 1: Match the interactive browser and private display profile

**Files:**
- Modify: `workers/national-life/steel-session.ts:91-103`
- Modify: `workers/national-life/steel-session.test.ts:178-191`
- Modify: `deploy/national-life-runtime.compose.yaml:21-32`
- Modify: `deploy/national-life-runtime.compose.test.ts:4-18`

**Interfaces:**
- Produces: `createInteractiveSteelSession(env, deps)` creates with `dimensions: { width: 1600, height: 1000 }`.
- Produces: Xvfb starts as `Xvfb :10 -screen 0 1600x1000x24`.
- Consumes: current `SteelSessionDeps`, current private Steel service, and no new environment variable.

- [ ] **Step 1: Write the failing session dimension assertion**

In `workers/national-life/steel-session.test.ts`, change the existing expected payload in `creates an interactive real Steel session with the exact safe options` to:

```ts
      dimensions: { width: 1600, height: 1000 },
```

Run: `pnpm exec vitest run workers/national-life/steel-session.test.ts`

Expected: FAIL because production code still requests `1280x800`.

- [ ] **Step 2: Implement the interactive dimension change**

In `workers/national-life/steel-session.ts`, replace only the interactive field with:

```ts
    dimensions: { width: 1600, height: 1000 },
```

Do not add dimensions to `createSteelBrowserSession`; restored background sessions remain unchanged.

- [ ] **Step 3: Verify the interactive-session boundary**

Run: `pnpm exec vitest run workers/national-life/steel-session.test.ts`

Expected: PASS, including the existing assertion that restored worker sessions have no dimensions property.

- [ ] **Step 4: Add a failing display-profile test**

Add this case to `deploy/national-life-runtime.compose.test.ts`:

```ts
  it('matches the private Xvfb display to the 1600 by 1000 interactive browser', () => {
    const compose = readFileSync('deploy/national-life-runtime.compose.yaml', 'utf8')
    expect(compose).toContain('Xvfb :10 -screen 0 1600x1000x24')
    expect(compose).not.toContain('Xvfb :10 -screen 0 1280x800x24')
  })
```

Run: `pnpm exec vitest run deploy/national-life-runtime.compose.test.ts`

Expected: FAIL because Compose still starts `1280x800x24`.

- [ ] **Step 5: Implement the matching Xvfb profile**

In `deploy/national-life-runtime.compose.yaml`, replace the command fragment with:

```yaml
        Xvfb :10 -screen 0 1600x1000x24 -ac +extension RANDR >/tmp/xvfb.log 2>&1 &
```

Do not alter the D-Bus, Nginx, private network, memory, shared memory, or read-only filesystem configuration.

- [ ] **Step 6: Run the task checks**

Run:

```bash
pnpm exec vitest run workers/national-life/steel-session.test.ts deploy/national-life-runtime.compose.test.ts
docker compose -f deploy/national-life-runtime.compose.yaml config >/tmp/national-life-runtime-compose.yml
```

Expected: all commands exit 0 and Compose shows no public Steel ports.

- [ ] **Step 7: Commit this independent profile change**

```bash
git add workers/national-life/steel-session.ts workers/national-life/steel-session.test.ts deploy/national-life-runtime.compose.yaml deploy/national-life-runtime.compose.test.ts
git commit -m "feat: raise National Life interactive display resolution"
```

### Task 2: Add a checked, independently scoped Steel screencast-quality patch

**Files:**
- Create: `deploy/national-life-steel-quality-patch.mjs`
- Create: `deploy/national-life-steel-quality-patch.test.ts`
- Modify: `Dockerfile.national-life-steel:3-4`

**Interfaces:**
- Produces: `patchSteelScreencastQuality(source: string): string`.
- Produces: one exact replacement in `/app/api/build/plugins/browser-socket/casting.handler.js`.
- Consumes: the currently pinned immutable Steel image source and no privacy-patch symbols.

- [ ] **Step 1: Write failing exact-once patch tests**

Create `deploy/national-life-steel-quality-patch.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { patchSteelScreencastQuality } from './national-life-steel-quality-patch.mjs'

describe('National Life Steel screencast-quality patch', () => {
  it('raises the reviewed JPEG screencast quality once', () => {
    const result = patchSteelScreencastQuality(
      'Page.startScreencast({ format: "jpeg", quality: 75, maxWidth, maxHeight })',
    )
    expect(result).toContain('quality: 92')
    expect(result).not.toContain('quality: 75')
  })

  it.each([
    'Page.startScreencast({ format: "jpeg", maxWidth, maxHeight })',
    'quality: 75; quality: 75',
  ])('rejects a missing or ambiguous reviewed Steel handler', (source) => {
    expect(() => patchSteelScreencastQuality(source)).toThrow(
      'Steel screencast quality did not match the reviewed Steel build',
    )
  })
})
```

Run: `pnpm exec vitest run deploy/national-life-steel-quality-patch.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 2: Implement the fail-closed patch module**

Create `deploy/national-life-steel-quality-patch.mjs`:

```js
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const reviewedQuality = 'quality: 75'
const patchedQuality = 'quality: 92'

export function patchSteelScreencastQuality(source) {
  const firstIndex = source.indexOf(reviewedQuality)
  if (firstIndex < 0 || source.indexOf(reviewedQuality, firstIndex + reviewedQuality.length) >= 0) {
    throw new Error('Steel screencast quality did not match the reviewed Steel build')
  }
  return source.replace(reviewedQuality, patchedQuality)
}

async function patchPinnedSteelBuild() {
  const castingHandlerPath = path.join(
    '/app/api/build',
    'plugins/browser-socket/casting.handler.js',
  )
  const source = await readFile(castingHandlerPath, 'utf8')
  await writeFile(castingHandlerPath, patchSteelScreencastQuality(source))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await patchPinnedSteelBuild()
}
```

This module does not import, change, or replace `national-life-steel-privacy-patch.mjs`.

- [ ] **Step 3: Verify both independent patch contracts**

Run: `pnpm exec vitest run deploy/national-life-steel-quality-patch.test.ts deploy/national-life-steel-privacy-patch.test.ts`

Expected: PASS. The missing and duplicated-source cases prove a future Steel image cannot silently receive an unreviewed replacement.

- [ ] **Step 4: Run both patches in the Steel Docker build**

Replace the existing patch lines in `Dockerfile.national-life-steel` with:

```dockerfile
COPY deploy/national-life-steel-privacy-patch.mjs /tmp/national-life-steel-privacy-patch.mjs
COPY deploy/national-life-steel-quality-patch.mjs /tmp/national-life-steel-quality-patch.mjs
RUN node /tmp/national-life-steel-privacy-patch.mjs \
  && node /tmp/national-life-steel-quality-patch.mjs \
  && rm -f /tmp/national-life-steel-privacy-patch.mjs /tmp/national-life-steel-quality-patch.mjs
```

- [ ] **Step 5: Build and inspect the patched dedicated image**

Run:

```bash
docker build -f Dockerfile.national-life-steel -t keeprone-national-life-steel:viewer-quality-test .
docker run --rm --entrypoint /bin/sh keeprone-national-life-steel:viewer-quality-test -lc "rg -n 'quality: (75|92)' /app/api/build/plugins/browser-socket/casting.handler.js"
```

Expected: the build exits 0 and the handler inspection contains `quality: 92` but not `quality: 75`.

- [ ] **Step 6: Commit the quality-patch boundary**

```bash
git add Dockerfile.national-life-steel deploy/national-life-steel-quality-patch.mjs deploy/national-life-steel-quality-patch.test.ts
git commit -m "feat: improve National Life viewer screencast quality"
```

### Task 3: Fit the secure broker iframe into a centered native-ratio surface

**Files:**
- Modify: `app/agent/integrations/national-life/NationalLifeBrowserModal.tsx:134-158`
- Modify: `app/agent/integrations/national-life/NationalLifeBrowserModal.test.tsx:52-77`

**Interfaces:**
- Produces: `data-testid="national-life-viewer-stage"` carrying `aspect-[16/10]`, `max-w-[1600px]`, and `max-h-[1000px]`.
- Consumes: existing signed `viewerUrl` and the current secure iframe attributes.
- Preserves: the existing title, sandbox, referrer policy, no `allow` permissions, cancel behavior, MFA behavior, and terminal-error behavior.

- [ ] **Step 1: Add a failing fixed-ratio-stage assertion to the first modal test**

Immediately after the existing `const frame = await ...` in `frames only the broker bootstrap`, add:

```ts
    const stage = screen.getByTestId('national-life-viewer-stage')
    expect(stage).toHaveClass('aspect-[16/10]')
    expect(stage).toHaveClass('max-w-[1600px]')
    expect(stage).toHaveClass('max-h-[1000px]')
    expect(stage).toContainElement(frame)
```

Run: `pnpm exec vitest run app/agent/integrations/national-life/NationalLifeBrowserModal.test.tsx`

Expected: FAIL because the iframe is presently the direct stretched child.

- [ ] **Step 2: Implement the proportional viewer stage**

Replace the current `viewerUrl ? (...) : (...)` content in the `relative min-h-0 flex-1` area with this `viewerUrl` branch, retaining the current loading branch after it:

```tsx
          {viewerUrl ? (
            <div className="grid h-full w-full place-items-center overflow-hidden bg-[#101512] p-2 sm:p-4">
              <div
                data-testid="national-life-viewer-stage"
                className="aspect-[16/10] h-auto max-h-[1000px] w-full max-w-[1600px] overflow-hidden bg-white shadow-2xl"
              >
                <iframe
                  title="Portal oficial da National Life"
                  src={viewerUrl}
                  className="h-full w-full border-0"
                  sandbox="allow-forms allow-scripts allow-same-origin"
                  referrerPolicy="no-referrer"
                />
              </div>
            </div>
          ) : (
```

Keep the existing loading content inside the unchanged `: (` branch. Remove the iframe `min-h-[600px]`; the stage owns its complete 16:10 geometry. Do not add `allow`, `srcDoc`, carrier URLs, zoom controls, or client-side credential fields.

- [ ] **Step 3: Verify visual component contracts and types**

Run:

```bash
pnpm exec vitest run app/agent/integrations/national-life/NationalLifeBrowserModal.test.tsx
pnpm exec tsc --noEmit
```

Expected: both exit 0; existing tests still prove the sandbox/referrer policy, MFA, cancel, and error lifecycle.

- [ ] **Step 4: Commit the proportional viewer surface**

```bash
git add app/agent/integrations/national-life/NationalLifeBrowserModal.tsx app/agent/integrations/national-life/NationalLifeBrowserModal.test.tsx
git commit -m "feat: fit National Life viewer to its native aspect ratio"
```

### Task 4: Record the production proof, submit a PR, and validate a fresh attempt

**Files:**
- Modify: `docs/operations/national-life-interactive-login-rollout.md`

**Interfaces:**
- Produces: a rollout checklist that separates container health from required browser/login/session-reuse proof.
- Consumes: dedicated `keeprone-national-life` services on `btapps` and user-controlled National Life credentials.

- [ ] **Step 1: Add this quality-profile rollout section**

Append to `docs/operations/national-life-interactive-login-rollout.md`:

```markdown
## Viewer quality profile (1600×1000 / JPEG 92)

Existing connection attempts retain their original Steel dimensions. After deployment, cancel any old attempt and start a new one.

1. On `btapps`, update the dedicated runtime source to the merged commit and rebuild the `national-life-steel` and `national-life-runtime` services with the `keeprone-national-life` Compose project.
2. Confirm both containers are running and the runtime reaches `http://national-life-steel:3000` only on the private network.
3. Start a new Keepr One connection. Confirm the complete National Life/Auth0 page is sharp, centered, and uncropped; small viewports must scale down proportionally.
4. Click username, password, and Login controls to verify pointer mapping. The agent enters credentials and MFA only in the carrier page.
5. Confirm `AUTHENTICATED`, modal closure, encrypted session persistence, and a successful read-only worker reuse.

Rollback: revert the viewer-quality PR, rebuild the same dedicated services, and use a new connection attempt. Existing encrypted contexts are unaffected.
```

- [ ] **Step 2: Run complete focused verification**

Run:

```bash
pnpm exec vitest run workers/national-life/steel-session.test.ts deploy/national-life-runtime.compose.test.ts deploy/national-life-steel-privacy-patch.test.ts deploy/national-life-steel-quality-patch.test.ts app/agent/integrations/national-life/NationalLifeBrowserModal.test.tsx
pnpm exec tsc --noEmit
docker compose -f deploy/national-life-runtime.compose.yaml config >/tmp/national-life-runtime-compose.yml
```

Expected: all commands exit 0. Build the dedicated Steel image locally when Docker is available before opening the PR.

- [ ] **Step 3: Commit the operator proof checklist**

```bash
git add docs/operations/national-life-interactive-login-rollout.md
git commit -m "docs: add National Life viewer quality rollout checks"
```

- [ ] **Step 4: Refresh, submit, and review the PR**

Run:

```bash
git fetch origin main
git rebase origin/main
gh pr create --base main --title "Improve National Life viewer quality" --body "Uses a matched 1600x1000 Steel/Xvfb profile, an independently fail-closed JPEG 92 screencast patch, and a secure capped 16:10 viewer surface. Focused Vitest, TypeScript, Compose config, and dedicated Steel image build pass. Production requires a new user-controlled connection attempt for visual, click-mapping, MFA, encrypted-session, and worker-reuse proof."
```

Expected: a PR URL is returned. Do not include credentials, session data, bearer tokens, raw Steel URLs, or internal debug endpoints in the PR.

- [ ] **Step 5: Merge after review, deploy only dedicated services, and obtain runtime proof**

Run after approval:

```bash
gh pr merge --merge --delete-branch
ssh btapps 'cd /data/keeprone-national-life-runtime && git fetch origin main && git checkout main && git pull --ff-only origin main && docker compose -p keeprone-national-life -f deploy/national-life-runtime.compose.yaml up -d --build'
ssh btapps 'docker compose -p keeprone-national-life -f /data/keeprone-national-life-runtime/deploy/national-life-runtime.compose.yaml ps'
curl -fsS https://national-life-viewer.keeprone.com/health
```

Expected: PR merges, dedicated containers run, and viewer health succeeds. If `/data/keeprone-national-life-runtime` is not the service source, inspect the existing Coolify service path before deployment.

- [ ] **Step 6: Complete fresh browser-to-worker verification without accessing credentials**

Have an agent begin a new National Life connection and enter credentials/MFA only in the rendered carrier page. Verify the full-page visual result, click mapping, `AUTHENTICATED` attempt state, encrypted session record, and one read-only worker reuse. Record only state transitions and job outcomes; never collect, display, log, or use credential values.

## Self-Review

- Spec coverage: Task 1 covers matching dimensions; Task 2 covers independent exact-once JPEG quality patch; Task 3 covers the capped 16:10 surface and secure iframe preservation; Task 4 covers rollout, fresh-attempt visual/click/MFA/session/worker proof, PR, merge, and rollback.
- Placeholder scan: every action has concrete file targets, code, command, and expected outcome; none defers work or relies on undefined interfaces.
- Type consistency: the new test imports `patchSteelScreencastQuality` under the exact export name specified by the module. Existing `createInteractiveSteelSession(env, deps)` and `viewerUrl` contracts remain unchanged.
