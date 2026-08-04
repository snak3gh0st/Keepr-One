# Task 3 report — provider-neutral browser contract

## Scope

Implemented only the Task 3 provider boundary. Existing Steel session behavior remains the compatibility path for the current runtime.

## Delivered

- Added vendor-neutral interactive browser handle, managed browser, health, and provider interfaces.
- Added deployment-scope enforcement and idempotent managed-handle release wrapping.
- Added fail-closed provider selection for exactly `steel` and `browserless`; unknown values throw and never fall back.
- Added Steel create, attach, and release lifecycle helpers using the existing Steel options and session mechanics.
- Preserved the navigation guard, headful 1600x1000 interactive profile, no-recording configuration, and local CDP disconnect behavior.
- Added focused contract, factory, and Steel adapter tests.

## Validation

TDD red phase observed: the new focused tests initially failed because the provider modules did not exist.

Focused command:

```text
pnpm exec vitest run workers/national-life/browser-provider.test.ts workers/national-life/steel-browser-provider.test.ts workers/national-life/browser-provider-factory.test.ts workers/national-life/steel-session.test.ts
```

Result: 7 test files passed, 53 tests passed.

No broad suite was run.

## Concerns

- Browserless is selectable through the factory contract, but its concrete adapter is intentionally outside Task 3.
- Existing runtime call sites still use the legacy Steel session functions; migrating those consumers belongs to the later fleet/controller tasks.
