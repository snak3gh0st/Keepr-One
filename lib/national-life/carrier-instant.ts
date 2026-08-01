/// Formats a carrier-quote timestamp — `illustration.createdAt` — for display.
///
/// `createdAt` is an instant, the moment this quote was saved, not a calendar
/// date. It is deliberately NOT pinned to `timeZone: 'UTC'`: it renders in
/// whatever timezone the server process runs in, and both screens that show
/// it (`app/agent/illustrations/page.tsx` and
/// `app/agent/illustrations/[id]/page.tsx`) import this one function so they
/// can never drift apart the way they did before this existed — one screen
/// pinned to UTC, the other reading the server's local time, agreeing only by
/// accident while the container happened to run UTC.
///
/// Contrast `insuredDateOfBirth`, which each page still formats with its own
/// `timeZone: 'UTC'` call: it is stored as a UTC-midnight calendar date (see
/// `parseCarrierDate` in `illustration-service.ts`), not an instant, so
/// pinning it to UTC is the only way to keep the calendar day the carrier
/// sent from shifting under a non-UTC server clock. The two fields need
/// different treatment because they are not the same kind of value.
export function formatCarrierInstant(value: Date): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(value)
}
