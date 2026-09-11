/// A quote the client asked for: generated on its own, sent by a person.
///
/// The two halves are deliberately different. Generating an illustration
/// happens inside Keeprone — it costs a carrier run and produces a document the
/// agent can look at, and nothing leaves the building. Putting it in the
/// client's WhatsApp is the part that cannot be taken back, so that half waits
/// for the agent to press send.
///
/// Consent sits underneath both: a client who asked not to be contacted is not
/// messaged even after the agent presses send. That is the client's own
/// instruction, not a review step, and it outlives the request.

export const GENERATING = 'GENERATING'
/// The numbers exist in Keeprone and the agent can read them. Nothing has been
/// sent, and nothing will be until they say so.
export const READY_TO_SEND = 'READY_TO_SEND'
export const DELIVERING = 'DELIVERING'
export const DELIVERED = 'DELIVERED'
export const BLOCKED = 'BLOCKED'
export const FAILED = 'FAILED'

export const DISCARDED = 'DISCARDED'
export const EXPIRED = 'EXPIRED'

export type IllustrationRequestStatus =
  | typeof GENERATING
  | typeof READY_TO_SEND
  | typeof DELIVERING
  | typeof DELIVERED
  | typeof BLOCKED
  | typeof DISCARDED
  | typeof EXPIRED
  | typeof FAILED

/// States that still occupy the client-and-product slot, so a second request
/// for the same pair must not be raised: a connector run is a browser session
/// driving the carrier, which is the expensive thing here.
export const IN_FLIGHT_STATUSES = [GENERATING, READY_TO_SEND, DELIVERING] as const

/// How long a request may sit in GENERATING before the slot is released. It
/// matches the connector command's own expiry: once the command can no longer
/// run, holding the slot only blocks the client from asking again.
export const GENERATION_WINDOW_MS = 60 * 60_000

/// Why an illustration was not raised. Codes, not sentences: the caller decides
/// how to say it, and these travel into logs.
export type IllustrationRefusal =
  | 'ILLUSTRATIONS_MODULE_DISABLED'
  | 'CLIENT_NOT_FOUND'
  | 'CLIENT_NOT_IN_BOOK'
  | 'CLIENT_DATE_OF_BIRTH_MISSING'
  | 'CLIENT_NAME_INCOMPLETE'
  | 'ALREADY_IN_FLIGHT'
  | 'CARRIER_RUN_IN_PROGRESS'
  | 'CONNECTOR_NOT_CONNECTED'
  | 'PRODUCT_NOT_SUPPORTED'
  | 'QUOTE_INPUT_INVALID'
  | 'DISPATCH_FAILED'

/// How long generated numbers wait for the agent to send them. The carrier's
/// assumptions age, so an illustration nobody sent within this window stops
/// being sendable rather than going out stale weeks later.
export const SEND_WINDOW_MS = 3 * 86_400_000

/// Why a delivery did not happen.
///
/// `OPTED_OUT` is the one that is not a failure: the client asked not to be
/// contacted, and the request is closed rather than retried.
export type DeliveryRefusal =
  | 'NOT_READY_TO_SEND'
  | 'OPTED_OUT'
  | 'CLIENT_UNREACHABLE'
  | 'ILLUSTRATION_MISSING'
  | 'TRANSPORT_FAILED'

/// What the client receives: the figures and the document, nothing composed.
export type IllustrationDeliveryEnvelope = {
  requestId: string
  agentId: string
  clientId: string
  clientName: string
  phone: string
  /// The agent's language, the same one the scheduled messages are written in.
  /// Carried on the envelope so the sender does not have to ask the database
  /// a second time, and so the figures are formatted the way this agent's
  /// clients read them.
  language: string
  illustrationId: string
  productName: string | null
  faceAmount: string | null
  /// The premium the carrier came back with, monthly. `targetPremium` is only
  /// what was asked for, so it is the fallback and never preferred: telling a
  /// client the number we requested as though it were the answer would be a
  /// quote they cannot hold anyone to.
  premium: string | null
  targetPremium: string | null
  documentUrl: string | null
}
