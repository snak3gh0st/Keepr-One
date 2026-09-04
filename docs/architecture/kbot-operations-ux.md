# K-Bot operations UX

K-Bot is the user-facing identity for Keepr One's browser automation. It is not
a chatbot and it never invents progress. Existing sync, document, and Foresight
commands remain the product actions; K-Bot makes their state understandable.

## Contract

- Every action starts from an explicit user click or an approved schedule.
- Sync and illustration are independent jobs. One may wait for National Life
  while the other continues, and neither may overwrite the other's browser tab
  or durable cursor.
- The UI renders persisted server or extension state. Animation is decoration,
  never proof that work is happening.
- Remaining time is a range derived from recent runs for the same account. When
  no useful history exists, the UI says that it is preparing instead of showing
  a fabricated countdown.
- With explicit Settings consent, K-Bot may submit a Vault-protected credential
  once for the exact active operation/authentication epoch. Without consent, on
  broker failure, on unknown/CAPTCHA pages, or after rejection, login remains
  manual. MFA is always a user action on National Life. K-Bot pauses the same
  job, asks for attention once, and resumes from its saved checkpoint only after
  an authenticated carrier probe.
- Completed means the carrier response was validated and saved. For official
  illustrations, it additionally means that the confirmed values and PDF were
  received.
- Status is always expressed with text, not color or motion alone. Live updates
  use polite status announcements and all animation honors reduced-motion.

## Activity center

`/agent/kbot?view=activities` combines the latest sync, illustration and
application operation with up to 100 recent follow-up jobs. It is a bounded
operational view, not a complete carrier audit ledger. Attention comes first,
then active work, then history; each carrier row links to its existing workflow.

Carrier status comes from the existing user-owned `/api/agent/carrier-sync`
snapshot. Refresh errors preserve the last known state and show an unavailable
notice. Partial or failed syncs never receive a completion message. An installed
extension does not establish an authenticated carrier session, and a completed
previous sync is identified as the last update rather than a new verification.

Follow-up status keeps preparation, provider acceptance, sending and delivery
separate. An unconfirmed send requires review and never triggers an automatic
resend. Generation credits are shown separately from message delivery. The
activity center introduces no new executor or automatic provider action.

## Naming boundary

`K-Bot by KeeprOne` is the public product name. Internal package names,
extension protocols, storage keys, and compatibility identifiers may continue
to use `keeprone-connect`; renaming those is a migration, not a visual change.

## Credential UX boundary

Settings is the only credential-management surface. It requires the current
Keepr One password plus fresh, unchecked consent to save or replace a National
Life credential. It shows only a masked username, readiness state and safe
timestamps. Users can replace or revoke; they can never reveal or copy the
saved password. A rejection disables automatic login until replacement.

The popup distinguishes automatic login in progress, MFA, rejected/disabled
credential, private-broker failure, no configured credential and ordinary
manual login. These are persisted safe states, not inferred animations.

## Contact quality and follow-up results

Phone review distinguishes missing numbers, unconfirmed country codes and invalid
or shared contacts. The UI preserves the current number for review, requires an
explicit country selection for national numbers and previews the exact value to
save. Contact diagnostics do not participate in authorization fingerprints.

The activity center compares the latest 100 follow-ups with currently owned,
module-accessible records. Only confirmed sends are tracked; repeated contacts
for one policy or requirement count once. A lapse is considered resolved only
when a later National Life observation reports a recognized normal in-force
status. Cancellation, missing records, future timestamps, manual source data,
and delivery receipts are not recovery evidence. The comparison uses the last
job update as a conservative boundary for subsequent carrier evidence.

Payment notices and application requirements remain subject to review: a normal
policy status does not prove payment of a bill, and requirement statuses can be
edited manually. The result measures observed state, not attribution to K-Bot.

The selected smooth avatar shares its drawing across compact and floating sizes.
Its idle breathing is one pixel over six seconds, work movement stays below two
pixels, blinking is occasional, and completion gets one short lift. Errors stay
still. Existing pointer tracking, announcements, focus/keyboard behavior and
reduced-motion support remain intact. The pixel alternative is retained only in
the local comparison preview.
