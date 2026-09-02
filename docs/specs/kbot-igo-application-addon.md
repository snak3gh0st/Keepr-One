# K-Bot iGO Application Add-on

Commercial contract: US$ 12.99 per month per agent, with a 14-day Stripe trial.
The add-on is a separate licensed subscription; opening Checkout never grants
access before Stripe reports the subscription as trialing or active.

## Goal

Let an entitled KeeprOne agent prepare and submit a National Life iGO application through K-Bot without coupling that work to National Life sync or Foresight illustration execution.

Every Application starts from exactly one completed official Illustration. The
Illustration is the source of the product, Term duration when applicable,
carrier-confirmed face amount and premium, insured identity, and immutable input
hash. A case is linked or created from that Illustration; selecting an unrelated
case is not the entry point.

The agent request remains sealed for audit. Carrier-confirmed values are stored
as a separate result and drive the Application. When National Life confirms a
different valid Term duration, KeeprOne shows requested versus confirmed and
uses the confirmed duration in the official PDF and iGO draft.

## Product boundary

- KeeprOne owns intake, readiness, consent, document inventory, paid entitlement, audit history, and user-facing status.
- K-Bot owns browser work inside the signed-in agent's National Life/iGO session.
- National Life/iGO owns carrier questions, validation, signature, submission, official receipt, and authoritative status.
- K-Bot never invents a response. An unknown or newly required carrier question pauses only the Application lane and returns the missing item to KeeprOne.
- Sync, Illustration, and Application are independent lanes. One lane waiting for login, confirmation, or carrier response does not erase or stop another lane.

## Commercial model

`K_BOT_APPLICATION` is a separately entitled monthly add-on per agent. The server checks entitlement when an Application draft is created, when a K-Bot command is issued, and again before final submission. Browser-side UI is never an authorization boundary. Agency-wide licensing can be added later as a distinct commercial rule; it is not inferred from agency membership.

Stripe product and price IDs come from dedicated environment variables. A missing or mismatched live recurring price fails closed. Subscription webhooks persist the add-on state, and cancellation removes access at the end of the paid period without deleting application history.

## Application lifecycle

1. **Illustration ready** — the official PDF and carrier-confirmed values are present; show the Application action on that Illustration.
2. **Collecting information** — agent completes the KeeprOne intake and uploads required documents.
3. **Ready for review** — all locally required fields are present; show a human-readable review.
4. **Preparing in iGO** — explicit confirmation creates one idempotent K-Bot draft command.
5. **Needs information** — iGO returned an unanswered or changed question; KeeprOne records it as an open requirement.
6. **Draft ready** — carrier draft ID and read-back summary are persisted.
7. **Ready to submit** — agent reviews carrier-confirmed values and documents.
8. **Submitting** — a second, distinct confirmation authorizes submission.
9. **Submitted** — receipt, external ID, timestamp, and carrier status are persisted and later refreshed by sync.

## Intake data

The initial version collects only bounded, validated fields that are known before authenticated iGO mapping:

- identity and contact information;
- residential address and state;
- product and coverage/funding intent;
- owner and insured relationship;
- beneficiary identity and relationship;
- replacement/existing coverage indication;
- consent and agent review timestamps;
- document inventory with content hashes and review state.

Medical, financial, suitability, replacement, and state-specific carrier questions are represented as versioned, typed answers only after their exact iGO labels and allowed values are mapped. Unknown questions become requirements; they are never accepted as arbitrary automation instructions.

## Data and security

- Every row is scoped through the owning case and assigned agent.
- Application intake is a versioned JSON snapshot with a server-computed SHA-256 hash. Commands reference the snapshot hash and cannot silently switch inputs after approval.
- Documents use the existing KeeprOne storage boundary and record filename, MIME type, size, SHA-256, uploader, and review state. K-Bot receives a short-lived, command-bound transfer, not a public URL.
- National Life credentials, cookies, MFA secrets, and passwords are not stored by KeeprOne. The agent's trusted browser session remains the authentication boundary.
- Safe errors shown to users contain no carrier HTML, credentials, health data, or document contents.

## Connector protocol

The extension must use an explicit executor registry. Unsupported capabilities fail with `CAPABILITY_NOT_IMPLEMENTED`; they never fall through to another executor.

Three application commands remain separate:

- `PREPARE_APPLICATION_DRAFT`: creates or resumes one iGO draft and reads values back.
- `UPLOAD_APPLICATION_DOCUMENT`: uploads one reviewed document to that exact draft.
- `SUBMIT_APPLICATION`: submits the reviewed snapshot and stores the carrier receipt.

Each command is tenant-scoped, device-bound, idempotent, expiring, and independently confirmed according to its risk class.

## Release gates

Application is not called live until all of these are proven:

- sync completes a representative six-source run while an illustration command exists;
- IUL and LSW Term each produce an official carrier PDF with read-back values;
- authenticated iGO mapping identifies every field, allowed value, transition, validation message, and receipt needed by the first supported product/state path;
- an entitled test account prepares one draft without submitting;
- an unentitled account is blocked server-side;
- an unknown iGO question pauses and appears in KeeprOne;
- explicit submit confirmation produces exactly one carrier receipt;
- Store package, deployed server commit, extension ID, and observed provider evidence are recorded separately.
