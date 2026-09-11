/// A quote the client asked for, on its way back to them.
///
/// There is no approval step. The bot is answering a question the client just
/// asked in a conversation, so the numbers go back as soon as the carrier
/// produces them — the same way an agent who ran the illustration by hand would
/// paste the PDF into the chat.
///
/// One refusal survives that: a client who asked not to be contacted is not
/// messaged, whatever they asked for before. Consent is not approval; it is the
/// client's own instruction, and it outlives the request.

export const GENERATING = 'GENERATING'
export const DELIVERING = 'DELIVERING'
export const DELIVERED = 'DELIVERED'
export const BLOCKED = 'BLOCKED'
export const FAILED = 'FAILED'

export type IllustrationRequestStatus =
  | typeof GENERATING
  | typeof DELIVERING
  | typeof DELIVERED
  | typeof BLOCKED
  | typeof FAILED

/// States that still occupy the client-and-product slot, so a second request
/// for the same pair must not be raised: a connector run is a browser session
/// driving the carrier, which is the expensive thing here.
export const IN_FLIGHT_STATUSES = [GENERATING, DELIVERING] as const

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

/// Why a delivery did not happen.
///
/// `OPTED_OUT` is the one that is not a failure: the client asked not to be
/// contacted, and the request is closed rather than retried.
export type DeliveryRefusal =
  | 'NOT_GENERATING'
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
  targetPremium: string | null
  documentUrl: string | null
}
