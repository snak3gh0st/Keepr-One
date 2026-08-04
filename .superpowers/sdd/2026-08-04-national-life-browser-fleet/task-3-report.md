# Task 3 report — provider-neutral browser contract

## Scope

Implemented only the Task 3 provider boundary. Existing Steel session behavior remains the compatibility path for the current runtime.

## Delivered

- Added vendor-neutral interactive browser handle, managed browser, health, and provider interfaces.
- Added deployment-scope and provider ownership enforcement, including rejection of Browserless handles by the Steel adapter.
- Made provider release idempotent under concurrent calls by sharing the in-flight release promise.
- Added fail-closed provider selection for exactly `steel` and `browserless`; unknown values throw and never fall back.
- Added Steel create, attach, and release lifecycle helpers using the existing Steel options and session mechanics.
- Preserved the navigation guard, headful 1600x1000 interactive profile, no-recording configuration, and local CDP disconnect behavior.
- Added focused contract, factory, and real Steel adapter tests for create/attach/release, navigation guarding, the headful 1600x1000 profile, no-recording options, and local-only disconnect behavior.

## Validation

TDD red phases observed: the original focused tests failed because the provider modules did not exist, and the review regression tests failed before the provider/scope guard and concurrent-release fixes.

Focused command:

```text
pnpm exec vitest run workers/national-life/browser-provider.test.ts workers/national-life/steel-browser-provider.test.ts workers/national-life/browser-provider-factory.test.ts workers/national-life/steel-session.test.ts
```

Result: 7 test files passed, 56 tests passed.

Typecheck:

```text
pnpm exec tsc --noEmit
```

Result: passed.

No broad suite was run.

## Concerns

- Browserless is selectable through the factory contract, but its concrete adapter is intentionally outside Task 3 and remains Task 7.
- Existing runtime call sites still use the legacy Steel session functions; migrating those consumers belongs to the later fleet/controller tasks.
