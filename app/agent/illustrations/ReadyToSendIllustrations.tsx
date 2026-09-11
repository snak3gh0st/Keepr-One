'use client'

import { useEffect, useState } from 'react'
import { useI18n } from '@/components/i18n/LanguageProvider'
import { KBotAvatar } from '@/components/kbot/KBotAvatar'
import type { ReadyToSendIllustration } from './ready-to-send'
import {
  discardReadyIllustration,
  sendReadyIllustration,
  type ReadyToSendActionResult,
} from './ready-to-send-actions'

/// The quotes waiting for the agent to say yes.
///
/// Everything the client would receive is on the card before the button: the
/// figures, and the message itself, rendered as text. The agent should never
/// press send to find out what it says.

const button = 'inline-flex min-h-11 items-center justify-center rounded-xl bg-teal px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal-deep disabled:cursor-not-allowed disabled:opacity-40'
const secondary = 'inline-flex min-h-11 items-center justify-center rounded-xl border border-border-steel bg-panel px-3 py-2 text-sm font-medium text-ink transition-colors hover:bg-teal-pale disabled:cursor-not-allowed disabled:opacity-40'

/// What happened, kept above the list rather than in the row.
///
/// Every outcome — sent, refused, discarded — closes the request, and the page
/// re-reads the waiting list straight afterwards. A message held inside the
/// card would unmount with the card, so the agent would press send and watch
/// the row vanish with nothing said. The client's name travels with it because
/// by the time it is read, the row it referred to is gone.
type Outcome = ReadyToSendActionResult & { requestId: string; clientName: string; kind: 'SEND' | 'DISCARD' }

export function ReadyToSendIllustrations({ items }: { items: ReadyToSendIllustration[] }) {
  const { copy } = useI18n()
  // Only one send runs at a time, and the row that owns it is named. A single
  // shared `pending` would grey out every button on the screen and leave the
  // agent unsure which quote the spinner belonged to.
  const [busy, setBusy] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  // The clock is read after mount. Computing "expira em 2 dias" during render
  // would make the server HTML and the first client render disagree.
  const [now, setNow] = useState<number | null>(null)

  useEffect(() => {
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])

  const run = async (
    item: ReadyToSendIllustration,
    kind: 'SEND' | 'DISCARD',
    action: (input: { requestId: string }) => Promise<ReadyToSendActionResult>,
  ) => {
    const { requestId, clientName } = item
    // The click guard. The send takes as long as a PDF in base64 takes to reach
    // the provider, which is long enough for an impatient second press; the
    // database claim in `sendIllustrationRequest` would refuse it, but the
    // agent would read that refusal as their quote having failed.
    if (busy) return
    setBusy(requestId)
    setConfirming(null)
    setOutcome(null)
    try {
      const result = await action({ requestId })
      setOutcome({ ...result, requestId, clientName, kind })
    } finally {
      setBusy(null)
    }
  }

  const timeLeft = (expiresAt: string): string => {
    if (now === null) return ''
    const remaining = new Date(expiresAt).getTime() - now
    if (remaining <= 0) return copy('o prazo terminou', 'the window has closed')
    const hours = Math.floor(remaining / 3_600_000)
    if (hours >= 24) {
      const days = Math.floor(hours / 24)
      return copy(`expira em ${days} dia${days > 1 ? 's' : ''}`, `expires in ${days} day${days > 1 ? 's' : ''}`)
    }
    if (hours >= 1) return copy(`expira em ${hours} hora${hours > 1 ? 's' : ''}`, `expires in ${hours} hour${hours > 1 ? 's' : ''}`)
    const minutes = Math.max(1, Math.floor(remaining / 60_000))
    return copy(`expira em ${minutes} min`, `expires in ${minutes} min`)
  }

  // The section survives an empty list while there is something to say: the
  // last row often leaves at the same moment its outcome arrives.
  if (!items.length && !outcome) return null

  return (
    <section className="mb-5 rounded-xl border border-border-steel bg-paper p-4" aria-label={copy('Cotações prontas para enviar', 'Quotes ready to send')}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <KBotAvatar state="idle" size="sm" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-teal-deep">K-Bot</p>
          <h2 className="mt-1 text-base font-semibold text-ink">
            {copy('Prontas para enviar', 'Ready to send')}
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-5 text-ink-muted">
            {items.length
              ? copy(
                'O K-Bot gerou estas cotações e não mandou nada. Leia os números e o texto que vai junto do PDF; se estiver certo, mande pro cliente no WhatsApp.',
                'K-Bot generated these quotes and sent nothing. Read the figures and the text that travels with the PDF; if it is right, send it to the client on WhatsApp.',
              )
              : copy('Nenhuma cotação esperando por você agora.', 'No quote is waiting for you right now.')}
          </p>
        </div>
      </div>

      {outcome && (
        <p
          className={`mt-4 rounded-lg border border-border-steel bg-panel p-3 text-sm leading-5 ${outcome.ok || outcome.reason === 'OPTED_OUT' ? 'text-ink' : 'text-red-700'}`}
          role="status"
        >
          <span className="font-semibold">{outcome.clientName}: </span>
          {!outcome.ok
            ? outcome.message
            : outcome.kind === 'SEND'
              ? copy('enviado no WhatsApp do cliente, com o PDF.', 'sent to the client on WhatsApp, with the PDF.')
              : copy('descartada. Nada foi enviado.', 'discarded. Nothing was sent.')}
        </p>
      )}

      <ul className="mt-4 grid gap-3">
        {items.map((item) => {
          const rowBusy = busy === item.requestId
          const blocked = !item.hasDocument || !item.reachable
          return (
            <li key={item.requestId} className="rounded-xl border border-border-steel bg-panel p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold text-ink">{item.clientName}</h3>
                <span className="text-xs text-ink-muted">{timeLeft(item.expiresAt)}</span>
              </div>
              <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-xs text-ink-muted">{copy('Produto', 'Product')}</dt>
                  <dd className="text-ink">{item.productName ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-muted">{copy('Cobertura', 'Coverage')}</dt>
                  <dd className="text-ink">{item.faceAmount ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-muted">{copy('Prêmio', 'Premium')}</dt>
                  <dd className="text-ink">{item.targetPremium ?? '—'}</dd>
                </div>
              </dl>

              <p className="mt-3 text-xs font-semibold uppercase tracking-[0.08em] text-ink-muted">
                {copy('O texto que vai junto do PDF', 'The text that goes with the PDF')}
              </p>
              {/* Text, never markup: this string is composed from carrier
                  figures and a client's own name. */}
              <p className="mt-1 whitespace-pre-line rounded-lg border border-border-steel bg-paper p-3 text-sm leading-5 text-ink">
                {item.message}
              </p>

              {!item.hasDocument && (
                <p className="mt-2 text-sm text-ink" role="status">
                  {copy(
                    'O PDF desta ilustração ainda não está no Keeprone, e a mensagem sem ele não é a cotação. Gere o documento antes de mandar.',
                    'The PDF for this illustration is not in Keeprone yet, and the message without it is not the quote. Generate the document before sending.',
                  )}
                </p>
              )}
              {!item.reachable && (
                <p className="mt-2 text-sm text-ink" role="status">
                  {copy(
                    'Este cliente não tem um número de WhatsApp no cadastro. Cadastre o telefone para poder mandar.',
                    'This client has no WhatsApp number on file. Add the phone number before sending.',
                  )}
                </p>
              )}

              <div className="mt-3 flex flex-wrap gap-3">
                <button
                  type="button"
                  className={button}
                  disabled={Boolean(busy) || blocked}
                  onClick={() => run(item, 'SEND', sendReadyIllustration)}
                >
                  {rowBusy
                    ? copy('Mandando…', 'Sending…')
                    : copy('Mandar pro cliente', 'Send to client')}
                </button>
                {confirming === item.requestId ? (
                  <>
                    <button
                      type="button"
                      className={secondary}
                      disabled={Boolean(busy)}
                      onClick={() => run(item, 'DISCARD', discardReadyIllustration)}
                    >
                      {copy('Sim, descartar', 'Yes, discard')}
                    </button>
                    <button type="button" className={secondary} disabled={Boolean(busy)} onClick={() => setConfirming(null)}>
                      {copy('Cancelar', 'Cancel')}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className={secondary}
                    disabled={Boolean(busy)}
                    onClick={() => setConfirming(item.requestId)}
                  >
                    {copy('Descartar', 'Discard')}
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
