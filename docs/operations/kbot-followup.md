# K-Bot follow-up operations

Read `docs/superpowers/specs/2026-09-04-kbot-followup.md` before enabling.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| KBOT_FOLLOWUP_ENABLED | false | API/dashboard and background maintenance after migration |
| KBOT_FOLLOWUP_AI_ENABLED | false | Allow AI generation and dispatch |
| OPENAI_API_KEY | none | Server-only key; never expose to the browser |
| KBOT_FOLLOWUP_MODEL | gpt-4o-mini | Recalibrate budget/output tests before changing |
| KBOT_FOLLOWUP_FREE_TOKENS | 1000 | Monthly free grant, equivalent to 10 displayed credits |
| KBOT_FOLLOWUP_PAID_TOKENS | 100000 | Proposed paid cycle grant (1,000 displayed credits) |
| KBOT_FOLLOWUP_MONTHLY_CENTS | 900 | Proposed USD monthly price; must match configured Stripe price |
| KBOT_FOLLOWUP_DAILY_GENERATIONS | 1000 | Global generation attempts per UTC day |
| STRIPE_KBOT_FOLLOWUP_PRODUCT_ID | none | Reviewed Stripe product; absence disables checkout |
| STRIPE_KBOT_FOLLOWUP_PRICE_ID | none | Reviewed active USD monthly licensed price |

Existing Chatwoot/Evolution settings and agent-specific account/channel records remain authoritative. Meta Cloud automation is intentionally unavailable until template initiation is implemented. Require signed Stripe `invoice.paid`, checkout and subscription lifecycle webhooks; only full paid invoice cycles grant tokens. The add-on has its own customer-portal route so legacy agents can manage it without a founder base subscription.

## Controlled activation

1. Apply `20260904000000_kbot_followup` before enabling either flag. Generate matching Prisma client.
2. Confirm assigned agent, explicit-country phone, connected inbox, actual sender identity and a fresh source record.
3. With an authorized internal recipient, test manual conversation opening without sending, then one AI authorization. Verify message in Chatwoot and WhatsApp, the Evolution message id and ACK for the exact recipient, token allocation settlement and notification.
4. Simulate a provider timeout after acceptance. Confirm no second send and reconcile the original id/correlation attribute. If the installed provider does not preserve correlation metadata or message source ids, keep AI disabled until an adapter is verified.
5. Turn on the UI/manual flag, then AI only after the roundtrip gate. Configure a paid catalog only after price/allowance approval and a Stripe test-mode paid/unpaid/renewal/cancellation exercise.

Unknown sends are not permission to resend. Inspect the gateway message id, provider source id and recipient conversation. Automatic reconciliation stops after 24 hours; unresolved entries remain visible. Tokens already used for generation remain spent regardless of later send failure. Stop pending batches to release unused reservations. Turning off AI prevents new processing; maintenance can continue with the feature flag on.

Evolution 2.3.7 does not populate Chatwoot `source_id` when Chatwoot initiates a message unless its direct database import path is enabled. Do not grant Evolution direct access to the Chatwoot database for this purpose. K-Bot automation sends through Evolution's internal API, persists the returned provider id and reads its exact `SERVER_ACK`, `DELIVERY_ACK` or `READ` progression. Evolution remains responsible for mirroring the message into Chatwoot.

## Local validation

Unit/UI: `pnpm exec vitest run lib/kbot-followup app/agent/kbot/FollowupWorkspace.test.tsx app/api/agent/kbot/followups/route.test.ts`

PostgreSQL integration tests run only with `KBOT_TEST_DATABASE_URL` pointing at `127.0.0.1` and database `followup_test`. Use an isolated disposable database; never set this to production. Tests use synthetic agents and mocked generation/messaging; cleanup is scoped to those agents.

Use `pnpm exec tsc --noEmit`, targeted ESLint, and the migration verification recorded in the implementation plan. No live contact smoke test should be inferred from a passing local suite.

## Pre-publication review, 2026-09-04

Local review corrected receipt progression (sent to delivered/read), concurrent stale receipt updates, persistent incoming opt-outs, opt-out precedence for shared phone numbers, complete failure/cancellation notification counts, and upward rounding of advertised reservation limits. The token ledger remains exact. `.env.example` now documents configuration without credential values.

The implementation uses bounded AI style selection and reviewed message phrases; it does not conduct an ongoing autonomous conversation. User-authorized batches persist in PostgreSQL and process in the application server. Keep the current Node server running; this scheduler is not a serverless background job.

Release gates still open:
- Apply the additive migration and provide server-side configuration in the deployed environment. Presence of a key in local `.env` does not establish production configuration. The Docker startup runs `prisma migrate deploy` before serving.
- Complete an authorized internal-recipient roundtrip through the deployed Chatwoot/Evolution bridge, confirming visibility in WhatsApp, provider receipt/correlation, token settlement and notification. Local mocks do not close this gate.
- Approve monthly price/allowance, configure Stripe product/price and test checkout, paid invoice, renewal and cancellation in Stripe test mode before selling credits. USD 9 / 100,000 tokens remains a proposal.

A release with both feature flags false can ship the inactive foundation. Enabling automated sending or paid purchases requires the gates above.

Final local checks after merging current `origin/main` (`1a71ad4`): 86 tests passed across 13 files, including 16 PostgreSQL integration tests and 6 checkout boundary tests; production build (including TypeScript) passed. Targeted ESLint passed before the merge; the merge did not change the follow-up modules. Main integrated without conflicts. No push, production deployment, live charge or real client message was performed.

## Controlled live roundtrip, 2026-09-04

One background message was authorized to the connected agent's own WhatsApp number using a synthetic requirement. Generation consumed 123 input and 11 output tokens. Chatwoot accepted the message, Evolution stored the exact provider id with `SERVER_ACK`, and the recipient confirmed that it appeared on the device. No retry occurred. The initial Chatwoot path did not return its provider id, so the job correctly remained unconfirmed rather than claiming delivery.

The receipt adapter was then changed to send automated messages through Evolution's authenticated internal API and reconcile its exact provider id, phone and ACK. The existing provider id was read successfully through that adapter without another send. The confirmed test job was closed as delivered, the result notification reported one sent message, and its exact token charge remained unchanged. Both global follow-up flags remained disabled. Publish this adapter and perform one final authorized roundtrip through the new send path before enabling automation broadly.
