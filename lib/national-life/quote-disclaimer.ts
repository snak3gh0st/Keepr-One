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

/// The two conditions that travel on the client summary PDF — the one artifact
/// in this system the insured is meant to receive.
///
/// Separate from `QUOTE_DISCLAIMER` because it governs a different thing, not
/// because anyone preferred different words. `QUOTE_DISCLAIMER` covers a Rapid
/// Solve estimate the carrier has not confirmed, and says it may not be shown
/// to the client. These cover numbers National Life already produced and
/// verified in its own official NAIC illustration, and the product decision on
/// record is that those may reach the client — provided the page says whose
/// numbers they are, what kind of numbers they are, and which document is the
/// authoritative one. Neither may be used in `QUOTE_DISCLAIMER`'s place;
/// `buildClientSummary` is what enforces that the values on this page are the
/// verified kind.
///
/// There are two because the products differ in a way the words cannot paper
/// over. A permanent policy's values rest on an assumed interest rate that is
/// not guaranteed. A term policy credits no interest at all — so telling its
/// reader that the figures "assume current, non-guaranteed interest rates"
/// describes something the contract does not contain, and invites them to
/// discount contractual maximums as speculation. What the two share is stated
/// once, below, so the parts that are common cannot drift apart.
///
/// English on purpose, and not translated: this is transcribed US insurance
/// compliance language, and the surrounding app's Portuguese does not reach it.
const CLIENT_SUMMARY_SOURCE =
  'Prepared by Keepr One from the National Life illustration issued for this proposal. ' +
  'The values shown are National Life’s.'

const CLIENT_SUMMARY_AUTHORITY =
  'This summary is not a contract, not an offer of insurance, and not the illustration ' +
  'itself: the full National Life illustration is the only authoritative document. ' +
  'Coverage begins only upon approval of a complete application.'

/// For a policy whose values depend on an assumed rate the carrier does not
/// guarantee.
export const CLIENT_SUMMARY_DISCLAIMER = [
  CLIENT_SUMMARY_SOURCE,
  'They are illustrative only — they assume current, non-guaranteed interest ' +
  'rates and charges, and will change.',
  CLIENT_SUMMARY_AUTHORITY,
].join(' ')

/// For term, where there is no credited rate to assume and nothing accumulates:
/// the premiums are the maximums the contract allows and the death benefit is
/// guaranteed, so the only thing that can still move them is the rate class,
/// which underwriting settles.
export const CLIENT_SUMMARY_TERM_DISCLAIMER = [
  CLIENT_SUMMARY_SOURCE,
  'A term policy credits no interest and accumulates no cash value: the premiums ' +
  'shown are the guaranteed maximums set by the contract and the death benefit ' +
  'shown is guaranteed, for as long as the premium is paid. They assume the rate ' +
  'class in the illustration, which underwriting determines and may change.',
  CLIENT_SUMMARY_AUTHORITY,
].join(' ')
