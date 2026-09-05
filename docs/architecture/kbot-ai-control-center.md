# K-Bot AI control center

The personal AI menu at `/agent/ai` shows the signed-in agent's follow-up activity, confirmed messaging outcomes and credit consumption. The existing `/agent/kbot` workspace remains the entry point for choosing and authorizing contacts. Both surfaces use the shared K-Bot avatar.

## Data contract

- `/api/agent/ai` derives the agent exclusively from the authenticated session. Query parameters allow `period=month|7d|30d`, `filter=all|working|attention|completed`, and a zero-based page. Responses are private and never cached.
- Usage is the sum of `billedTokens` for `SPENT` generations started in the selected UTC period. Legacy jobs without `generationStartedAt` use `createdAt`. Failures and cancellations after generation retain their consumption. Expired credit grants do not remove historical consumption.
- The wallet follows the existing account lock and monthly free-grant contract. Available balance excludes spent, reserved and expired credits. Its next expiration is the earliest expiration of a grant with spendable balance; it is not a promise of renewal or a new charge.
- Impact counts current outcomes for actions created during the selected UTC period. `SENT`, `DELIVERED`, and `READ` count as confirmed sends; `DELIVERED` and `READ` as deliveries; only `READ` as a read. These are cumulative milestones. `ACCEPTED` and `UNKNOWN` never count as confirmed sends. No recovered-policy, reply, revenue, or time-saving claims are inferred.
- Live pending work and unconfirmed sends are counted independently of the history period. History is paginated in the database; aggregates cover the whole matching period, including records beyond the displayed page.
- One displayed credit equals 100 ledger tokens. Presentation rounding does not change accounting. Positive values that would round to zero appear as `<1`; reservation ceilings round up.
- Subscription prices are labeled as monthly plan prices. Actual invoices remain in the existing billing portal. A configured price or subscription state is never presented as money paid.

## Controls and states

The dashboard polls every 15 seconds while visible, refreshes on focus and provides manual refresh. Failed refreshes retain the last snapshot with a visible warning and timestamp. Disabled features show an unavailable state rather than fabricated zero balances.

Activity details show authorization, message preparation, confirmed send and confirmed delivery. Pending/preparing jobs expose **Stop batch** through the existing same-origin cancellation endpoint. This stops eligible jobs in that batch; it does not recall messages or refund generation already consumed. The dashboard never starts generation or sends messages on load. Per-contact limits reflect the existing authorization reservation ceiling; this change adds no new billing policy or schema migration.

Local validation covers account scoping, period boundaries, receipt classification, historical consumption versus wallet balance, paging, failures and cancellation. Browser validation uses synthetic fixtures for desktop/mobile, Portuguese/English, activity expansion, filters, empty, unavailable and unconfirmed states. Provider sending, live charges and deployed behavior require separate evidence.
