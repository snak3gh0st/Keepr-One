/**
 * Global switch for the K-Bot iGO application add-on.
 *
 * Entitlement answers "did this agent pay for it"; this answers "is the feature
 * open at all". They are deliberately separate: an agent can hold a current
 * paid subscription while the feature is closed for everyone, and the product
 * surface has to say "temporarily unavailable" rather than "you don't have this
 * add-on" — there is a paying subscriber today, and telling them they lack
 * something they bought would be wrong.
 *
 * Absent means closed. Re-open by setting KBOT_IGO_APPLICATION_ENABLED=true.
 */
export function isKBotApplicationEnabled(): boolean {
  const value = process.env.KBOT_IGO_APPLICATION_ENABLED
  if (value === undefined || value === '') return false
  if (value !== 'true' && value !== 'false') {
    throw new Error('KBOT_IGO_APPLICATION_ENABLED must be true or false')
  }
  return value === 'true'
}
