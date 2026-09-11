/// An illustration the K-Bot raised, and the agent who has to read it first.
///
/// The product decision this module encodes: the K-Bot may *generate* an
/// illustration, and only the agent may *deliver* it. An illustration carries a
/// face amount and a premium under the agent's name, so a wrong number sent
/// straight from a conversation is the agent's mistake, not the bot's.
///
/// That rule is held in two places on purpose. `ApprovedIllustration` is the
/// only argument the delivery function accepts and it cannot be written down
/// outside `approval.ts`, so no call site can even compile a delivery that
/// skipped approval; and every write re-asserts the status and the owning agent
/// in its own `where`, so a value approved and then discarded still delivers
/// nothing.

export const GENERATING = 'GENERATING'
export const AWAITING_APPROVAL = 'AWAITING_APPROVAL'
export const APPROVED = 'APPROVED'
export const DELIVERING = 'DELIVERING'
export const DELIVERED = 'DELIVERED'
export const DISCARDED = 'DISCARDED'
export const EXPIRED = 'EXPIRED'
export const FAILED = 'FAILED'

export type IllustrationRequestStatus =
  | typeof GENERATING
  | typeof AWAITING_APPROVAL
  | typeof APPROVED
  | typeof DELIVERING
  | typeof DELIVERED
  | typeof DISCARDED
  | typeof EXPIRED
  | typeof FAILED

/// States that still occupy the client-and-product slot, so a second request
/// for the same pair must not be raised: a connector run is a browser session
/// driving the carrier, which is the expensive thing here.
export const IN_FLIGHT_STATUSES = [GENERATING, AWAITING_APPROVAL, APPROVED, DELIVERING] as const

/// How long a request may sit in GENERATING before the slot is released. It
/// matches the connector command's own expiry: once the command can no longer
/// run, holding the slot only blocks the agent from asking again.
export const GENERATION_WINDOW_MS = 60 * 60_000

/// How long generated numbers wait for the agent. Longer than a message
/// proposal — an illustration keeps its meaning for days, and the agent may be
/// waiting to talk to the client — but not forever: carrier rates move, and an
/// unread illustration must not be deliverable weeks later.
export const APPROVAL_WINDOW_MS = 3 * 86_400_000

/// Why an illustration was not raised. Codes, not sentences: the caller decides
/// how to say it, and nothing here should leak carrier wording into a chat.
export type IllustrationRefusal =
  | 'CONNECTOR_NOT_CONNECTED'
  | 'ILLUSTRATIONS_MODULE_DISABLED'
  | 'CLIENT_NOT_IN_BOOK'
  | 'CLIENT_DATE_OF_BIRTH_MISSING'
  | 'CLIENT_NAME_INCOMPLETE'
  | 'PRODUCT_NOT_SUPPORTED'
  | 'QUOTE_INPUT_INVALID'
  | 'ALREADY_IN_FLIGHT'
  | 'CARRIER_RUN_IN_PROGRESS'
  | 'DISPATCH_FAILED'

/// Why a delivery was refused. `NOT_APPROVED` covers the case that matters: the
/// request moved on — discarded, expired, already delivered — between the
/// agent's approval and this attempt.
export type DeliveryRefusal = 'NOT_APPROVED' | 'ILLUSTRATION_MISSING' | 'TRANSPORT_FAILED'

declare const approvedByAgent: unique symbol

/// Proof that a named agent read these numbers and released them.
///
/// The brand is a symbol that exists only in the type system and is not
/// exported, so this shape cannot be constructed anywhere but in `approval.ts`
/// — not by a cast in a call site, not by a test helper. Getting one requires
/// calling `approveIllustrationRequest`, which is the point.
export type ApprovedIllustration = {
  readonly [approvedByAgent]: true
  readonly requestId: string
  readonly agentId: string
  readonly clientId: string
  readonly illustrationId: string
  readonly approvedByUserId: string
}

/// What the client would receive. Built only from an approved request.
export type IllustrationDeliveryEnvelope = {
  requestId: string
  agentId: string
  clientId: string
  illustrationId: string
  productName: string | null
  faceAmount: string | null
  targetPremium: string | null
  documentUrl: string | null
}
