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
