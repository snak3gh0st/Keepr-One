// Annual policy review scheduling. A review recurs yearly: scheduling anchors
// one year out, and completing one rolls the next anniversary forward. Pure so
// it's testable without the DB.
export function nextAnnualReview(from: Date): Date {
  const next = new Date(from)
  next.setFullYear(next.getFullYear() + 1)
  return next
}

// Due = the review's date has arrived (or passed). Callers pass end-of-day as
// `now` when they want "due today" to count.
export function isReviewDue(dueAt: Date, now: Date): boolean {
  return dueAt.getTime() <= now.getTime()
}

// First review date when seeding from a policy: the next upcoming anniversary of
// its effective date (so a 3-year-old policy isn't scheduled overdue). With no
// effective date, fall back to one year out.
export function nextReviewFrom(effectiveDate: Date | null, now: Date): Date {
  if (!effectiveDate) return nextAnnualReview(now)
  const anniversary = new Date(effectiveDate)
  anniversary.setFullYear(now.getFullYear())
  if (anniversary.getTime() < now.getTime()) anniversary.setFullYear(anniversary.getFullYear() + 1)
  return anniversary
}
