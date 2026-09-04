# K-Bot Follow-up Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task in this session. User already authorized implementation; no additional execution-choice gate.

**Goal:** Free manual follow-up and optional credit-funded AI outreach in the background.

**Architecture:** Keep deterministic eligibility, durable execution and credits in KeeprOne/PostgreSQL. OpenAI writes bounded messages; existing Chatwoot/Evolution performs transport. UI consumes persisted results.

**Tech Stack:** Next.js, TypeScript, Prisma/PostgreSQL, OpenAI Node SDK, Stripe, Vitest.

**Spec:** docs/superpowers/specs/2026-09-04-kbot-followup.md

## Global Constraints
- No customer messages or real Stripe mutations during implementation.
- Own-agent actions only; one click; manual without credits; no browser automation.
- Feature flags default false; no automatic retry after uncertain dispatch.
- Free allowance configurable (proposed 1,000 tokens/month = 10 credits); 1 displayed credit = 100 tokens; paid catalog is configuration, not an invented live product.

## Task 1: Eligibility and persistence
- [x] Add Prisma models/migration for grants, jobs and preferences; preserve existing models.
- [x] Implement `getFollowupCandidates(agentId)` and phone/reason helpers in lib/kbot-followup.
- [x] Test old warnings, phone ambiguity, ownership, grouping and resolved signals.

## Task 2: Scoped conversation entry
- [x] Implement contact search/create and inbox-specific conversation reuse in messaging transport.
- [x] Add POST manual route using source ids only; navigate Messages using conversation id.
- [x] Test exact telephone matching, blocked contacts and no send on manual opening.

## Task 3: Credit authorization
- [x] Atomic monthly grant, balance, reservation and per-phone cooldown.
- [x] Job creation compares displayed source fingerprint with current candidate.
- [x] Test repeat clicks, concurrent reservations, insufficient credits and terminal settlement.

## Task 4: AI and background execution
- [x] Add pinned OpenAI dependency and structured message validation.
- [x] Add scheduler and durable worker with persisted dispatch boundary/reconciliation.
- [x] Test timeout after send, provider failure, expired lease, cancellation and spending caps.

## Task 5: Paid add-on
- [x] Configured monthly Stripe catalog, authenticated checkout and signed webhook dispatch.
- [x] Grant only from verified paid invoice, idempotently.
- [x] Test no grant from unpaid subscription and repeated webhook handling.

## Task 6: Product surface
- [x] Dashboard card, /agent/kbot page, avatar shortcut, manual/AI/credits/results.
- [x] Reuse PT/EN copy and style tokens. Add explicit recipient language selection.
- [x] Test no-credit manual behavior, single-click actions and partial outcomes.

## Task 7: Validation and handoff
- [x] Run targeted Vitest, Prisma validation, TypeScript and build as needed.
- [x] Inspect desktop/mobile browser fixture; exercise disposable PostgreSQL concurrency.
- [x] Record actual results, configuration and live-provider gaps in spec; keep external work gated.

## Verification record
Completed locally: 39 targeted tests, 11 PostgreSQL integration tests, TypeScript, targeted ESLint, Prisma validation, production build, additive migration check, desktop/mobile synthetic browser inspection. Exact evidence and rollout boundaries are recorded in the spec. No real customer sends or Stripe charges occurred.

Pre-publication review: current main integrated without conflicts; final targeted run passed 86 tests in 13 files (16 with isolated PostgreSQL), and the production build passed. Receipt progression, opt-out persistence, notification counts and whole-number reservation ceilings were corrected. Live provider and paid-catalog gates remain in docs/operations/kbot-followup.md.
