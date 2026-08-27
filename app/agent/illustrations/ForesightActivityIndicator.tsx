export function ForesightActivityIndicator({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="relative flex h-2 w-2" data-testid="foresight-activity-pulse" aria-hidden="true">
        <span className="absolute inset-0 animate-ping rounded-full bg-teal/45" />
        <span className="relative h-2 w-2 rounded-full bg-teal" />
      </span>
      <span>{label}</span>
    </span>
  )
}
