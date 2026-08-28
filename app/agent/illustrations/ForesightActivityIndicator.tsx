import { KBotAvatar } from '@/components/kbot/KBotAvatar'

export function ForesightActivityIndicator({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-2" role="status" aria-live="polite">
      <span data-testid="foresight-activity-pulse" aria-hidden="true">
        <KBotAvatar state="working" size="xs" />
      </span>
      <span>{label}</span>
    </span>
  )
}
