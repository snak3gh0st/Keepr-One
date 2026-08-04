# Task 2 report: pure Foresight contract boundary

## Scope

Implemented only the pure Foresight read contract and updated the three existing discovery scripts to use it. No authenticated-session code, runtime worker, schema, migration, UI, or Rapid Solve code was changed.

## Changed files

- `lib/national-life/foresight-sync.ts`
  - Added the five-service `FORESIGHT_READ_SERVICES` allowlist.
  - Added read-only case listing parsing for `a[id*="lnkCaseName"]` anchors.
  - Added depth-limited shape description, payload redaction, explicit summary extraction, and service validation.
- `lib/national-life/foresight-sync.test.ts`
  - Added pure contract tests for the required fixtures and boundary behavior.
- `scripts/national-life-describe-foresight-data.ts`
  - Removed its duplicate service list and shape implementation.
  - Uses the shared case parser, service allowlist, and shape helper.
  - Preserves the existing read-only service probe behavior.
- `scripts/national-life-describe-foresight-newcase.ts`
  - Reuses the shared read-service predicate when classifying discovered endpoints.
- `scripts/national-life-describe-foresight-services.ts`
  - Reuses the shared read-service predicate when reporting discovered endpoints.

## Commit

`HEAD` after the atomic commit (`feat: define Foresight read contract`); the final SHA is reported in the handoff below.

## Tests and output

Focused command:

```text
pnpm exec vitest run lib/national-life/foresight-sync.test.ts scripts/national-life-describe-foresight-data.test.ts scripts/national-life-describe-foresight-newcase.test.ts scripts/national-life-describe-foresight-services.test.ts
```

Result:

```text
Test Files  3 passed (3)
Tests       21 passed (21)
```

The brief names `scripts/national-life-describe-foresight-data.test.ts`, but that file is absent at baseline; Vitest therefore ran the three existing matching test files.

Additional verification:

- Targeted ESLint: passed with no output.
- `pnpm exec tsc --noEmit --pretty false`: passed with no output.
- `git diff --check`: passed.

## Self-review

- The contract rejects unknown services and does not expand the existing service call set.
- Case parsing ignores arbitrary links, trims visible labels, classifies `-QQ-` labels as `QUICK_QUOTE`, and uses the visible label only as the Foresight lookup key when no separate identifier is present.
- Redaction covers the requested sensitive-key families, truncates strings at 2,000 characters, and stops nested traversal at depth 8.
- Summary extraction reads only direct, explicit carrier-named fields and returns `null` when they are absent.
- The discovery scripts remain discovery-only: they do not create cases, render reports, launch e-App, or import Rapid Solve.
- The final diff is limited to the contract, its tests, the three named discovery scripts, and this report.

## Concerns

- No live Foresight session was used; verification is pure/local only.
- The existing data discovery script still uses the carrier client's POST transport for the already-allowlisted `Get*` reads. This task did not add or broaden those calls.
- The baseline lacks the data-script test file named by the brief; the missing path is documented above rather than creating an unrelated test file.

## Review round 1 fix report

### Findings addressed

- Empty matching case anchors no longer create an index gap. The data discovery script now retains each matching anchor’s ID and HTML together, parses that anchor independently, and only then filters empty listings. A regression test covers an empty `lnkCaseName` anchor before a valid case.
- `classifyEndpoints(...).data` now contains only discovered members of `FORESIGHT_READ_SERVICES`. Broad discovery heuristics remain available in `product` and `newCase`, but `GetProductList` and other non-allowlisted endpoints are no longer advertised as operational reads. Tests cover both allowlisted and heuristic-only endpoints.
- The shape-only observation concern is deferred. Constructing `ForesightServiceObservation` belongs with the later browser adapter/worker boundary and would widen this pure contract/discovery fix.

### Fix verification

Focused command:

```text
pnpm exec vitest run lib/national-life/foresight-sync.test.ts scripts/national-life-describe-foresight-data.test.ts scripts/national-life-describe-foresight-newcase.test.ts scripts/national-life-describe-foresight-services.test.ts
```

Result:

```text
Test Files  3 passed (3)
Tests       22 passed (22)
```

Additional fix checks:

- Targeted ESLint: passed with no output.
- `pnpm exec tsc --noEmit --pretty false`: passed with no output.
- `git diff --check`: passed.
- Touched discovery scripts still contain no new report/e-App/case-creation call and no Rapid Solve import.

### Fix commit

The fix will be included in the atomic commit recorded as `HEAD` after this report append; the final SHA is returned in the handoff.
