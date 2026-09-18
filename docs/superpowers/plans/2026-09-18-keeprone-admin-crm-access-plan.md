# Keepr One Admin and CRM Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the six requested product capabilities: invite platform access from Marketing, retire Jornada from administrative provisioning, enforce the 30-day/50%-off subscription conversion flow, expose useful admin audit labels, move the public admin entrypoint away from `/admin` while preserving protection, and import CRM leads from both the agent and admin portals.

**Architecture:** Keep the existing `app/admin` route tree as the internal implementation target, expose `/backoffice` through `proxy.ts` with an authenticated rewrite, and redirect legacy `/admin` URLs to `/backoffice`. Reuse the existing managed-account provisioning conventions for Marketing invitations. Add one shared CRM CSV import service that authorizes the importing agent or an admin-selected agent, writes `Prospect` + `InsuranceCase` records transactionally, deduplicates by normalized email/phone within the target agent, and records an audit event for admin operations. Preserve the historical Prisma `JOURNEY` enum values for old rows, but remove Jornada from all current write/configuration surfaces.

**Tech Stack:** Next.js 16 App Router with `proxy.ts`, React Server Actions, Prisma 6, PostgreSQL, Better Auth, Zod, `csv-parse`, Vitest, Testing Library, TypeScript.

**Spec:** User request in the conversation (six Keepr One product requirements).

## Global Constraints

- Preserve the existing untracked `AGENTS.md`, `CLAUDE.md`, and `output/` files.
- Keep authorization inside every Server Action (`requireRole`, `requireAgentModule`, and same-origin validation where applicable).
- Do not remove historical Prisma enum values or rewrite existing production data merely to hide Jornada from the current product.
- Do not claim production deployment or real email/Stripe delivery from local tests; validate repository behavior only.
- Use `apply_patch` for edits and targeted Vitest/typecheck validation before broader checks.

---

## Task 1: Make `/backoffice` the protected canonical admin entrypoint

**Files:** `proxy.ts`, `lib/auth-navigation.ts`, `app/page.tsx`, `components/Shell.tsx`, `app/admin/login/page.tsx`, focused route/navigation tests.

- [x] Add a canonical `/backoffice` namespace to the proxy.
- [x] Redirect `/admin` and `/admin/*` to the matching `/backoffice` URL, preserving query strings.
- [x] Authenticate and authorize `/backoffice/*` exactly as the current admin boundary does, redirecting anonymous users to `/backoffice/login` and non-admin users to their own portal.
- [x] Rewrite authenticated `/backoffice/*` requests to the existing `app/admin/*` implementation.
- [x] Update portal-home, login redirect sanitization, home redirect, and visible admin navigation to use `/backoffice`.
- [x] Add/update tests for legacy redirect, canonical rewrite, anonymous redirect, non-admin rejection, and safe login `next` handling.

## Task 2: Remove Jornada from current admin provisioning writes

**Files:** `app/admin/users/[id]/ManagedUserProductAccessForm.tsx`, `app/admin/users/actions.ts`, `app/admin/users/create-actions.ts`, related tests.

- [x] Remove `JOURNEY` from module unions, selectable module catalogs, validation arrays, and onboarding-module conversion.
- [x] Keep the Prisma enum values untouched so historical records remain readable.
- [x] Assert in tests that Jornada cannot be selected or persisted by current admin forms/actions.

## Task 3: Add Marketing “send access invitation”

**Files:** `lib/admin/access-invitation.ts`, `app/admin/marketing/actions.ts`, `app/admin/marketing/LeadAccessInvite.tsx`, `app/admin/marketing/leads/[id]/page.tsx`, marketing data/types/tests, audit label maps.

- [x] Add a server-side invitation service that finds an existing agent account by lead email or provisions a standard individual agent with the existing 30-day trial/default modules, without creating duplicate users.
- [x] Request the Better Auth password-reset/access email with the existing public-header safety pattern.
- [x] Add a same-origin, admin-only Marketing action with clear results for new account, existing account, invalid role, duplicate/race, and email delivery failure.
- [x] Add the button/status UI to the lead detail page and revalidate Marketing, Users, and Audit views.
- [x] Write `MARKETING_LEAD_ACCESS_INVITE_REQUESTED`/delivery audit records without storing secrets.

## Task 4: Implement CRM lead CSV import for agent and admin

**Files:** `lib/crm/lead-import.ts`, `app/agent/cases/import/page.tsx`, `app/agent/cases/import/LeadImportForm.tsx`, `app/agent/cases/import/actions.ts`, `app/admin/import/page.tsx`, `app/admin/import/ImportForms.tsx`, `app/admin/import/actions.ts`, focused tests.

- [x] Define and document the CSV contract: `firstName,lastName,email,phone,dateOfBirth,state,tobaccoStatus,objective,productType,targetCoverage,monthlyBudget`; only name is required and optional CRM fields receive safe defaults.
- [x] Parse malformed files safely, report one-based row errors, normalize email/phone/state, and cap file/row sizes.
- [x] Create a shared transaction-safe importer that initializes the target agent’s CRM pipeline, creates a Prospect and InsuranceCase, and skips duplicates by normalized email/phone for that agent.
- [x] Add the agent upload route/action guarded by `requireAgentModule('CRM')` and the current agent context.
- [x] Add the admin upload route/action with an active-agent selector; log the batch summary in `AuditLog`.
- [x] Revalidate the agent Cases board and admin Audit/Import pages; include import result summaries in both UIs.

## Task 5: Close the billing/audit presentation gaps

**Files:** existing retention tests and `app/admin/audit/page.tsx` (plus related label maps if needed).

- [x] Preserve and regression-test the existing exact Founder 30-day trial, 50% retention/conversion coupon path, and expiration paywall dialog; do not loosen Stripe-side eligibility checks.
- [x] Add human-readable labels for Marketing invitation/import events and `BILLING_RETENTION_OFFER_GRANTED` in the admin audit panel.
- [x] Ensure the audit text makes clear that the 50% offer is time-limited and that full-price fallback remains available.

## Task 6: Documentation and focused verification

**Files:** `docs/operations/marketing.md`, relevant README/help copy, tests added above.

- [x] Document `/backoffice`, the Marketing invitation behavior, the CRM CSV columns/defaults, and the legacy `/admin` redirect.
- [x] Run focused Vitest suites for proxy/auth navigation, managed-user/invitation actions, Marketing, CRM import, billing retention, and import UI.
- [x] Run `pnpm exec tsc --noEmit` and a final `git diff --check`.
- [x] Review the diff for accidental changes to unrelated work and report local evidence separately from production evidence.

## Self-review checklist

- [x] All new actions re-check authorization and same-origin where state changes.
- [x] No current module selector or persisted write path offers Jornada.
- [x] `/admin` cannot render the admin panel directly.
- [x] CRM imports cannot assign records to an unauthorized agent.
- [x] Duplicate imports are reported as skips, not silent duplicate CRM cases.
- [x] Secrets, passwords, reset tokens, and Stripe credentials never enter audit JSON.
