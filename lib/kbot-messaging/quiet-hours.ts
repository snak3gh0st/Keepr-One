/// When a message may be sent, in the hour of the person receiving it.
///
/// Nothing in the book records where a client lives: `Client` has no address,
/// and none of the National grids carry state or ZIP. The phone number is the
/// only locality signal there is, so the zone is derived from its NANP area
/// code — and only from codes this table is sure of. Anything unrecognised
/// (an unknown code, a mobile ported across the country, a non-US number)
/// falls back to a band that is daytime in every mainland US zone at once.
///
/// The fallback is deliberately narrower than the derived window. Guessing wide
/// and being wrong means texting someone at 3am; guessing narrow and being
/// wrong means the message goes out after lunch.

/// Local window for a recipient whose zone is known.
export const SEND_WINDOW_START_HOUR = 9
export const SEND_WINDOW_END_HOUR = 20

/// Window used when the zone is unknown, expressed in US Eastern. 12:00–17:00
/// ET is 09:00–14:00 Pacific, so it is inside business hours from coast to
/// coast no matter where the recipient actually is.
export const FALLBACK_ZONE = 'America/New_York'
export const FALLBACK_WINDOW_START_HOUR = 12
export const FALLBACK_WINDOW_END_HOUR = 17

/// NANP area codes whose zone is unambiguous. States split across two zones
/// (Florida's panhandle, western Kansas, the Texas mountain corner, Indiana,
/// Oregon, Idaho, the Dakotas, Nebraska) are deliberately absent: a code that
/// spans a zone boundary cannot answer this question, and the fallback is the
/// honest result for it.
const AREA_CODE_ZONES: Record<string, string[]> = {
  'America/New_York': [
    '201', '202', '203', '207', '212', '215', '216', '223', '220', '227', '234', '239', '240', '248', '267', '272', '276', '301', '302',
    '305',
    '304', '315', '317', '321', '326', '330', '332', '336', '339', '347', '351', '352', '380', '386',
    '401', '404', '407', '410', '412', '413', '419', '434', '440', '443', '445', '470', '475', '478', '484',
    '502', '508', '513', '516', '518', '540', '551', '561', '567', '570', '571', '585', '603',
    '607', '609', '610', '614', '617', '631', '646', '667', '678', '680', '681', '689', '703', '704',
    '706', '656', '716', '717', '718', '727', '724', '732', '740', '743', '754', '757', '762', '770', '772', '774', '781',
    '786', '787', '803', '804', '810', '813', '814', '828', '838', '843', '845', '848', '854', '856',
    '857', '860', '862', '863', '864', '878', '904', '908', '910', '912', '914', '917', '919', '929',
    '937', '940', '941', '943', '945', '947', '954', '959', '973', '978', '980', '984',
  ],
  'America/Chicago': [
    '205', '210', '214', '217', '218', '224', '225', '251', '256', '262', '270', '281', '309', '312',
    '314', '318', '319', '320', '331', '337', '346', '361', '364', '409', '414', '417', '430', '432',
    '469', '479', '501', '504', '507', '512', '515', '531', '534', '563', '573', '580', '601', '605',
    '608', '612', '618', '620', '630', '636', '641', '651', '660', '662', '682', '708', '713', '731',
    '763', '769', '773', '779', '785', '806', '815', '816', '817', '830', '832', '847', '870', '872',
    '901', '903', '913', '918', '920', '936', '952', '956', '972', '979',
  ],
  'America/Denver': [
    '303', '307', '385', '406', '435', '505', '575', '719', '720', '915', '801', '970',
  ],
  'America/Phoenix': ['480', '520', '602', '623', '928'],
  'America/Los_Angeles': [
    '206', '209', '213', '253', '279', '310', '323', '341', '360', '408', '415', '424', '425', '442',
    '509', '510', '530', '559', '562', '619', '626', '628', '650', '657', '661', '669', '702', '707',
    '714', '725', '747', '760', '775', '805', '818', '820', '831', '858', '909', '916', '925', '949',
    '951',
  ],
  'America/Anchorage': ['907'],
  'Pacific/Honolulu': ['808'],
}

const ZONE_BY_AREA_CODE = new Map<string, string>(
  Object.entries(AREA_CODE_ZONES).flatMap(([zone, codes]) => codes.map((code) => [code, zone] as const)),
)

/// The NANP area code of a US number in E.164, or null for anything else.
export function areaCodeFromPhone(phone: string | null | undefined): string | null {
  if (typeof phone !== 'string') return null
  const digits = phone.replace(/\D/g, '')
  // 11 digits starting with the country code, or a bare 10-digit number.
  const national = digits.length === 11 && digits.startsWith('1') ? digits.slice(1)
    : digits.length === 10 ? digits
    : null
  if (!national) return null
  const area = national.slice(0, 3)
  // N-A-X: the first digit is 2-9 and the second is not 9 (N9X is unassigned).
  if (!/^[2-9][0-8][0-9]$/.test(area)) return null
  return area
}

export function timeZoneForPhone(phone: string | null | undefined): string | null {
  const area = areaCodeFromPhone(phone)
  return area ? ZONE_BY_AREA_CODE.get(area) ?? null : null
}

function hourInZone(instant: Date, timeZone: string): number {
  const hour = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    hour12: false,
  }).format(instant)
  // `hour12: false` yields "24" for midnight in some ICU versions.
  return Number(hour) % 24
}

export type QuietHoursDecision = {
  allowed: boolean
  /// The zone the decision was made in, so a log can say why.
  timeZone: string
  /// Whether the zone came from the area code or from the fallback band.
  derived: boolean
}

/// Whether a message to `phone` may be sent at `now`.
export function withinSendWindow(phone: string | null | undefined, now: Date): QuietHoursDecision {
  const derivedZone = timeZoneForPhone(phone)
  if (derivedZone) {
    const hour = hourInZone(now, derivedZone)
    return {
      allowed: hour >= SEND_WINDOW_START_HOUR && hour < SEND_WINDOW_END_HOUR,
      timeZone: derivedZone,
      derived: true,
    }
  }
  const hour = hourInZone(now, FALLBACK_ZONE)
  return {
    allowed: hour >= FALLBACK_WINDOW_START_HOUR && hour < FALLBACK_WINDOW_END_HOUR,
    timeZone: FALLBACK_ZONE,
    derived: false,
  }
}
