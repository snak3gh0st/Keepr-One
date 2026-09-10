export default function MarketingLoading() {
  return <div className="mx-auto max-w-6xl animate-pulse px-6 py-12" role="status" aria-label="Marketing">
    <div className="mb-8 h-28 rounded-xl bg-panel" />
    <div className="mb-6 h-12 rounded-lg bg-panel" />
    <div className="h-64 rounded-xl bg-panel" />
    <span className="sr-only">Marketing…</span>
  </div>
}
