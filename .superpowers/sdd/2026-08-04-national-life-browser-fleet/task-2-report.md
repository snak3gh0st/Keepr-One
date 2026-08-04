# Task 2 report — durable attempt scheduling and shard assignment

## Implemented

- Added durable retry timing, retry count, provider/shard assignment, and last transport failure fields to `NationalLifeConnectionAttempt`.
- Added the requested migration and a scheduling index.
- Added guarded `scheduleInteractiveRetry` and `assignBrowserShard` store operations. Both require attempt ID, deployment scope, provider, purpose, current state, and lease owner.
- Transport failures now preserve `AWAITING_LOGIN`/`AWAITING_MFA`, persist bounded exponential backoff, record the failure time, and clear the lease.
- Runtime claims exclude attempts whose `nextPollAt` is in the future.
- Retry count exhaustion transitions the attempt to `FAILED` with `STEEL_RECONNECT_FAILED`.
- Interactive failures no longer release an active browser merely because a poll is not due; the durable schedule controls the next claim.

## Validation

Focused command:

```text
pnpm exec vitest run workers/national-life/runtime.test.ts workers/national-life/run-connection-attempt.test.ts
```

Result: 4 test files passed, 40 tests passed.

`pnpm exec prisma validate` passed. `pnpm exec tsc --noEmit` was attempted and reported stale generated Prisma client types for the newly added schema fields; Prisma client regeneration was interrupted before completion. No broad suite or unrelated checks were run.

## Concerns

- The retry budget is currently the Task 2 runtime constant of five reconnect attempts; provider capacity/adapters remain later-task work.
- Production migration application remains unverified. Typecheck remains blocked by the stale generated Prisma client in the local environment.
