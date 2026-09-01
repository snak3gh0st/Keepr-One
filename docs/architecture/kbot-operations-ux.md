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
