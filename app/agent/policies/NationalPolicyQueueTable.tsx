import Link from 'next/link'
import type { NationalPolicyQueueKey, NationalPolicyQueueRow } from '@/lib/national-life/policy-queues'

const TITLES: Record<NationalPolicyQueueKey, { pt: string; en: string }> = {
  ENTER_INFORCE: { pt: 'A entrar em vigor', en: 'Entering in force' },
  WAITING_AGENT: { pt: 'Aguardando agente', en: 'Waiting on agent' },
  WAITING_CLIENT: { pt: 'Aguardando cliente', en: 'Waiting on client' },
}

export function nationalPolicyQueueTitle(queue: NationalPolicyQueueKey, language: 'PT' | 'EN') {
  return TITLES[queue][language === 'PT' ? 'pt' : 'en']
}

export function NationalPolicyQueueTable({ rows, queue, language }: {
  rows: NationalPolicyQueueRow[]
  queue: NationalPolicyQueueKey
  language: 'PT' | 'EN'
}) {
  const copy = (pt: string, en: string) => language === 'PT' ? pt : en
  return (
    <section className="mx-auto max-w-7xl px-5 py-10 sm:px-8" aria-labelledby="national-queue-title">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border-steel pb-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-ink-muted">National Life · New Business</p>
          <h2 id="national-queue-title" className="mt-2 text-2xl font-medium tracking-[-0.035em] text-ink">
            {nationalPolicyQueueTitle(queue, language)} · {rows.length}
          </h2>
        </div>
        <Link href="/agent/policies" className="text-sm font-semibold text-teal-deep hover:text-ink">
          {copy('Ver carteira completa', 'View full portfolio')} →
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="py-14 text-sm text-ink-muted">{copy('Nenhuma apólice nesta fila.', 'No policies in this queue.')}</p>
      ) : (
        <div className="mt-6 overflow-hidden rounded-2xl border border-border-steel bg-paper">
          <div className="hidden grid-cols-[1fr_1.4fr_1.3fr_1fr] gap-4 border-b border-border-steel bg-canvas-deep px-5 py-3 text-[10px] font-semibold uppercase tracking-[0.13em] text-ink-muted md:grid">
            <span>{copy('Apólice', 'Policy')}</span><span>{copy('Cliente', 'Client')}</span>
            <span>{copy('Produto', 'Product')}</span><span>{copy('Situação National', 'National status')}</span>
          </div>
          <div className="divide-y divide-border-steel">
            {rows.map((row) => (
              <article key={row.policyNo} className="grid gap-2 px-5 py-4 text-sm md:grid-cols-[1fr_1.4fr_1.3fr_1fr] md:items-center md:gap-4">
                <p className="font-mono font-medium text-ink">{row.policyNo}</p>
                <p className="text-ink">{row.insuredName ?? '—'}</p>
                <p className="text-ink-muted">{row.product ?? '—'}</p>
                <div>
                  <p className="font-medium text-ink">{row.carrierStatus ?? '—'}</p>
                  <p className="mt-0.5 text-xs text-ink-muted">{row.deliveryStatus ?? '—'}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
