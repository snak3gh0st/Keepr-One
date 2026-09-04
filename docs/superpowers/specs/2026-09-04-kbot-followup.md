# K-Bot follow-up: product and execution contract

## Accepted experience
Alerts and manual outreach remain available without AI credits. Each alert has a manual action and a one-click AI action with its maximum credit reservation shown. No chat, typing, browser automation, or second approval screen. A click authorizes only the displayed recipients, language and maximum cost. Jobs run on the server after the page closes. Results live in Activities and existing notifications; conversations remain in Messages.

## Sources and ownership
Only the signed-in agent's own clients/cases are actionable, even when the dashboard can show agency totals. Module permissions apply to source data and messaging. Current LAPSED/Pending Lapse policies, recent National Life payment-risk events and OPEN application requirements supply deterministic alerts. Requirements are described as pending items, not all assumed to be client documents. Events older than 30 days are not active triggers. Carrier data older than 72 hours requires sync before AI; manual access remains. A newer healthy policy snapshot suppresses an older warning. Telephone must have an explicit country code; never guess a country. Group by customer/phone; a shared phone across distinct customers blocks AI. Seven-day cooldown covers tracked manual/AI contact and recent outgoing messages found in Chatwoot.

## Tokens and customer-facing credits — revised by owner
The ledger stores integer input/output tokens. **1 displayed credit = 100 tokens**, displayed as whole numbers rounded to the nearest integer. Maximum reservations are rounded upward for display, so the displayed ceiling never understates the authorization. No per-contact charge, no rounding of the underlying ledger. Each job reserves at most 192 tokens (1.92 credits); actual usage settles after generation and the remainder returns to the wallet. A later send failure does not refund generation already performed. Sending or reconciling a prepared message never generates again. A provider usage anomaly is capped at the customer's authorized reservation; the app absorbs the difference and retains actual token counts.

Free grants: default 1,000 tokens = 10 credits per agent/calendar month (UTC), configurable, no rollover. Paid grants: unique per paid Stripe invoice, valid through the invoiced period. Free and paid grant fragments can fund the same reservation. Checkout, redirect and subscription activation alone never grant credits. No overage billing. Paid catalog defaults are a proposal only: 100,000 tokens = 1,000 credits at USD 9/month. Checkout is unavailable until actual reviewed Stripe product/price ids are configured. No live product or price was created.

## Execution and accounting
PostgreSQL stores authorization batches, per-recipient jobs, credit grants/allocations and contact preferences. Agent transactions serialize scheduling, credit reservation, cancellation and settlement. Reservation and authorization are committed together. Request keys make repeated clicks idempotent; source fingerprints prevent execution of a changed selection.

States: PENDING -> PREPARING -> DISPATCHING -> ACCEPTED -> SENT/DELIVERED/READ. Generation is persisted and billed before dispatch. Cancellation of PENDING releases its reservation. Cancellation during PREPARING becomes CANCEL_REQUESTED; any completed generation is billed, then dispatch is cancelled. Expired preparation fails without retry; unused reservation is released. Pending authorizations expire after 24 hours.

Timeout/crash after DISPATCHING becomes UNKNOWN and is reconciled without resending. Gateway acceptance is not delivery. SENT requires a provider reference and status. Reconciliation continues from SENT through DELIVERED/READ without another send or token charge; stale concurrent checks cannot erase confirmed delivery. Incoming opt-outs detected during checks persist locally. Reconciliation is bounded (10 jobs per pass, at most 10 message pages per job, at most 24 hours of automatic checks). Unconfirmed sends remain visible for manual investigation. Notifications report recorded outcomes, never imply the underlying policy/requirement is resolved.

## AI scope
Official OpenAI Node SDK and Responses API with Structured Outputs. Tested default: gpt-4o-mini. The initially researched gpt-4.1-mini snapshot was unavailable to the configured project (403 model_not_found), so model choice was verified against available models before a synthetic smoke test.

The model selects the greeting/closing approach using the controlled reason and PT/EN language. The app composes the actual message from reviewed phrases and first names. This is deliberately bounded AI personalization, not free-form financial advice or an autonomous conversation agent. No names, phone numbers, policy numbers, health data, document contents or arbitrary carrier descriptions are sent to OpenAI. No tools or conversation history. `store: false`, 32-output-token ceiling, 20-second timeout, zero SDK retries. Re-evaluate token ceilings and phrasing quality before changing model/prompt/schema.

Generation is allowed only after source, sender, contact, cooldown and opt-out checks. A global daily ceiling defaults to 1,000 attempted generations, and a grant-based attempt ceiling limits repeated refunded failures. Invalid/refused outputs block sending; known actual usage is recorded. No live customer messages were used in development.

## Messaging and manual route
Account/inbox derive from the agent, never the request body. Contact search uses exact normalized phone; ambiguous or blocked contacts fail closed. Reuse/create a contact and conversation in the agent's Chatwoot account. Manual action opens that conversation without sending; external WhatsApp is an explicit fallback. Opening is not completion. Manual completion is user-asserted and labeled. Missing requested conversations never silently open a different customer's composer.

AI initially supports Evolution only. Meta Cloud free-text initiation is blocked pending approved-template support. Live Evolution connection and sender identity are verified before generation and again before dispatch. Generated messages use the existing Chatwoot-to-Evolution path, not a browser or desktop session. Actual provider roundtrip/receipt behavior must be verified with an authorized test recipient before rollout.

## Interface
Reuse existing typography, teal/mint surfaces and KBotAvatar. Dashboard entry, /agent/kbot activities page and avatar shortcut. Show names, motives, source timestamp, credits, manual action, AI action, snooze, opt-out and manual contact recording. PT/EN is explicit per run. Results survive refresh. Sensitive operational detail and provider error text are not surfaced. The user can continue working while the server processes the batch.

## Acceptance tests
- Own-agent and module-restricted source queries; current versus obsolete warnings; stale/missing-phone/shared-phone behavior.
- Manual path needs no credits and causes no send; deep link cannot silently select a different client.
- Concurrent reservations never overdraw; repeated request never duplicates; grant fragments settle exactly once.
- Generation bills actual tokens; cancellation before generation releases reservation; cancellation during generation cannot dispatch.
- Provider failure after generation does not refund tokens; uncertain dispatch never retries.
- Paid invoice only, exact account/price/quantity, no proration refill, replay-safe grants.
- UI shows 671 tokens as 7 credits; 329 remaining tokens display as 3 credits; no-credit state preserves manual contact; no chat/second confirmation.

## Measurement, 2026-09-04
Five real API calls with synthetic cases and no WhatsApp sending: input tokens 123/124/122/123/124; output tokens 11 each. Total **616 input + 55 output = 671 tokens = 6.71 credits**. This measures the bounded personalization described above, not arbitrary long conversations. After this measurement the output ceiling was tightened from 128 to 32; the final configuration is rechecked separately.

At official GPT-4o mini rates of USD 0.15/M input and USD 0.60/M output, these five calls are approximately USD 0.0001254 in model usage before possible cache discounts. Infrastructure, messaging provider, support and taxes are separate. Rates are not stored as a promise of product margin. https://developers.openai.com/api/docs/models/gpt-4o-mini

## Rollout boundaries
KBOT_FOLLOWUP_ENABLED defaults false until migration and provider verification. KBOT_FOLLOWUP_AI_ENABLED separately enables generation/dispatch. Manual remains independent of AI enablement and balance. Migrations are additive; tested against a disposable local PostgreSQL only. Production DB changes, deployment, real customer sends, Stripe catalog creation and real charges require separate rollout work. Credential values never enter docs, test fixtures or logs.

## Local validation completed, 2026-09-04
- 39 targeted tests across 9 files passed; 11 isolated PostgreSQL integration tests passed.
- TypeScript, targeted ESLint, Prisma schema validation, production build and git diff whitespace checks passed.
- Additive migration applied successfully to an isolated database initialized with the prior schema.
- Desktop (1440px) and mobile (390px) synthetic browser preview: no browser errors or horizontal overflow; manual button enabled with zero balance. Temporary preview route removed before production build.
- Final 32-output-token configuration: synthetic call used 122 input + 11 output tokens and prepared a valid message.
- Production migration/deployment, paid catalog creation and real WhatsApp delivery remain unexecuted. Local changes are not evidence of live provider delivery.
