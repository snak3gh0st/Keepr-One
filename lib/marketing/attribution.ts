export const FOUNDERS_CAMPAIGN_ID = 'founders-program'
export const FOUNDERS_CAMPAIGN_SLUG = 'founders'
export const ATTRIBUTION_FIELDS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const

/** Public attribution is untrusted, length-limited metadata, never account state. */
export function readLeadAttribution(form: FormData) {
  const read = (key: string, max: number) => {
    const value = form.get(key)
    if (typeof value !== 'string') return null
    return value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) || null
  }
  const slug = read('marketing_campaign', 100)
  return {
    campaignSlug: slug && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ? slug : null,
    utmSource: read('utm_source', 200),
    utmMedium: read('utm_medium', 200),
    utmCampaign: read('utm_campaign', 200),
    utmContent: read('utm_content', 200),
    utmTerm: read('utm_term', 200),
  }
}
