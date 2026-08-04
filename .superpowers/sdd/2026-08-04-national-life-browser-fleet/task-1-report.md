# Task 1 implementation report

Date: 2026-08-04
Task: Close the National Life portal-origin and capacity configuration boundary

## Result

Implemented and committed the Task 1 configuration boundary. The runtime parser now produces the browser provider, shard, capacity, and reconnect-delay values; accepts only `steel` and `browserless`; rejects invalid capacities/delays and capacity inversions; and preserves exact HTTPS-origin validation.

The compose runtime now includes the observed exact origins `https://nlg-prod.us.auth0.com` and `https://mfa.nationallife.com`. No wildcard origin was added, no secrets were logged, and no production deployment was performed.

## Changed files

- `lib/national-life/env.ts`
  - Added `NATIONAL_LIFE_BROWSER_PROVIDER` with `steel`/`browserless` validation.
  - Added shard ID, positive capacity, and ordered reconnect-delay parsing.
  - Production capacities are required by the compose environment; provider, shard, and retry values have non-secret local-safe defaults.
  - `getNationalLifeEnv()` returns the complete configured environment shape.
- `lib/national-life/env.test.ts`
  - Added provider, capacity, delay, and exact-origin contract tests.
- `lib/national-life/constants.ts`
  - Added the non-secret provider/shard/retry defaults.
- `.env.example`
  - Documented the browser fleet variables and local-safe example values.
- `deploy/national-life-runtime.compose.yaml`
  - Added the exact Auth0 and MFA origins.
  - Added browser fleet variables, with explicit production capacity requirements.
- `deploy/national-life-runtime.compose.test.ts`
  - Added the exact-origin compose assertion.

## Verification

### TDD RED

Command:

```text
pnpm exec vitest run lib/national-life/env.test.ts deploy/national-life-runtime.compose.test.ts
```

Initial result: FAIL, 6 tests failed. The failures were the expected missing environment fields and missing exact compose origins.

### Focused tests and typecheck

Command:

```text
pnpm exec vitest run lib/national-life/env.test.ts deploy/national-life-runtime.compose.test.ts && pnpm exec tsc --noEmit
```

Result:

```text
Test Files  4 passed (4)
Tests       53 passed (53)
Typecheck   passed with no output
```

Additional checks:

```text
git diff --check                         passed
```

## Commits

- `bee03f5cac66e6368ba82fec6471b0fe0ec48a22` — `feat: configure National Life browser capacity`
- This report is committed separately so the implementation commit hash above remains stable.

## Concerns and boundaries

- The existing worker tests construct legacy `NationalLifeEnv` fixtures without the new fields. To keep those out-of-scope fixtures unchanged, the base type permits omitted fleet fields while `getNationalLifeEnv()` returns a `ConfiguredNationalLifeEnv` with all six fields required. Future fleet code should consume the factory return type rather than hand-built legacy fixtures.
- This task is configuration-only. Browser provider adapters, durable shard scheduling, capacity admission, reconnect orchestration, load testing, and production deployment remain outside Task 1.
