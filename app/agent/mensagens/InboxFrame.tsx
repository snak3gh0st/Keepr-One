'use client'

/// The inbox runs on its own origin and is embedded rather than linked, so the
/// agent never leaves Keepr One or sees a second address. The proxy in front of it
/// answers `frame-ancestors https://app.keeprone.com`, which is what permits this
/// frame and forbids anyone else's.
///
/// `sandbox` is deliberately absent: the inbox needs scripts, forms, popups for
/// attachments and its own storage, and enumerating those permissions would be a
/// longer list than it removes.
export function InboxFrame({ src }: { src: string }) {
  return (
    <div className="module-panel" style={{ padding: 0, overflow: 'hidden' }}>
      <iframe
        src={src}
        title="Mensagens"
        style={{ width: '100%', height: 'calc(100vh - 260px)', minHeight: 520, border: 0, display: 'block' }}
        allow="clipboard-write; microphone; camera"
      />
    </div>
  )
}
