/// The regulated condition that must travel with every carrier-quoted number,
/// on every screen that shows one. This is regulated US insurance language,
/// stated in English on purpose — the surrounding screens render in Portuguese,
/// but this compliance condition is transcribed from the carrier's English terms
/// and may not be translated.
///
/// A condition stated in two different wordings on two screens is worse than
/// either wording alone — a reader who compares them has no way to know which
/// one is the real rule. So there is exactly one string, and both the
/// illustrations list and the quote summary page read it from here rather
/// than carrying their own copy.
export const QUOTE_DISCLAIMER =
  'Quote, not an application. Values are illustrative only — not guaranteed, ' +
  'and subject to approval of a complete application at issue. Broker internal use: ' +
  'may support a verbal quote to the client, but must not be shown to them.'

/// The condition that travels on the client summary PDF — the one artifact in
/// this system the insured is meant to receive.
///
/// A separate string from `QUOTE_DISCLAIMER` because it governs a different
/// thing, not because anyone preferred different words. `QUOTE_DISCLAIMER`
/// covers a Rapid Solve estimate the carrier has not confirmed, and says it may
/// not be shown to the client. This one covers numbers National Life already
/// produced and verified in its own official NAIC illustration, and the product
/// decision on record is that those may reach the client — provided the page
/// says whose numbers they are, that they are not guaranteed, and which
/// document is the authoritative one. Neither string may be used in the other's
/// place; `buildClientSummary` is what enforces that the values on this page
/// are the verified kind.
///
/// English on purpose, and not translated: this is transcribed US insurance
/// compliance language, and the surrounding app's Portuguese does not reach it.
export const CLIENT_SUMMARY_DISCLAIMER =
  'Prepared by Keepr One from the National Life illustration issued for this proposal. ' +
  'The values shown are National Life’s and are illustrative only — they assume ' +
  'current, non-guaranteed interest rates and charges, and will change. ' +
  'This summary is not a contract, not an offer of insurance, and not the illustration ' +
  'itself: the full National Life illustration is the only authoritative document. ' +
  'Coverage begins only upon approval of a complete application.'
