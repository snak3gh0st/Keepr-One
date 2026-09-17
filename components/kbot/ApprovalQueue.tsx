'use client'

import { useState } from 'react'
import { browserClock, useBrowserClock } from '@/components/useBrowserClock'
import { useI18n } from '@/components/i18n/LanguageProvider'
import { approvalTimeLeft, canApprove, type ApprovalProposal } from '@/lib/kbot-templates/approval-view'

/// Moved out of `app/agent/ai/agendadas/` so both that screen's actions and
/// the Central de Mensagens can render the same queue instead of each keeping
/// its own copy. The send gate stays the only decision point — this component
/// only shows what a person already wrote and asks the agent to say yes or no.

const button = 'inline-flex min-h-11 items-center justify-center rounded-xl bg-teal px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal-deep disabled:opacity-40 disabled:cursor-not-allowed'
const secondary = 'inline-flex min-h-11 items-center justify-center rounded-xl border border-border-steel bg-panel px-3 py-2 text-sm font-medium text-ink transition-colors hover:bg-teal-pale disabled:opacity-40 disabled:cursor-not-allowed'

const approvalClock = browserClock(60_000)

/// The queue of messages already written, waiting for a person to say yes.
///
/// It sits above everything else because it is the only part of the screen
/// with a deadline: a proposal nobody reads is dropped after the approval
/// window, and an agent who was never told that would read it as a bug.
export function ApprovalQueue({ proposals, categoryLabels, pending, onApprove, onDiscard }: {
  proposals: ApprovalProposal[]
  categoryLabels: Record<string, string>
  pending: boolean
  onApprove: (jobIds: string[]) => void
  onDiscard: (jobIds: string[]) => void
}) {
  const { copy, locale } = useI18n()
  const [selected, setSelected] = useState<string[]>([])
  const now = useBrowserClock(approvalClock)

  const approvable = proposals.filter((proposal) => canApprove(proposal, now ?? 0))
  // Pruned against what is on screen right now. After a release the page
  // revalidates and those rows are gone; a leftover id would make the next
  // click report a send that matched nothing.
  const chosen = selected.filter((id) => proposals.some((proposal) => proposal.id === id))
  const chosenApprovable = chosen.filter((id) => approvable.some((proposal) => proposal.id === id))
  const allChosen = approvable.length > 0 && chosenApprovable.length === approvable.length

  function act(run: (jobIds: string[]) => void, jobIds: string[]) {
    if (!jobIds.length) return
    run(jobIds)
    setSelected([])
  }

  if (!proposals.length) return null

  return <section className="mt-5 rounded-2xl border border-teal bg-teal-pale/40 p-4" aria-label={copy('Mensagens esperando sua liberação', 'Messages waiting for your approval')}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 className="text-lg font-semibold text-ink">{copy('Esperando você liberar', 'Waiting for you to release')}</h3>
        <p className="mt-1 max-w-2xl text-sm text-ink-muted">{copy(
          'Estas mensagens já estão escritas com os dados de cada cliente. Leia antes de liberar — nada sai enquanto você não disser que sim.',
          'These messages are already written with each client’s details. Read them before releasing — nothing leaves until you say so.',
        )}</p>
      </div>
      <p className="text-sm font-semibold tabular-nums text-teal-deep">{proposals.length}</p>
    </div>

    <div className="mt-4 flex flex-wrap items-center gap-3">
      <button
        className={secondary}
        disabled={pending || !approvable.length}
        aria-pressed={allChosen}
        onClick={() => setSelected(allChosen ? [] : approvable.map((proposal) => proposal.id))}
      >{allChosen ? copy('Limpar seleção', 'Clear selection') : copy('Selecionar todas', 'Select all')}</button>
      <button className={button} disabled={pending || !chosenApprovable.length} onClick={() => act(onApprove, chosenApprovable)}>
        {copy('Enviar selecionadas', 'Send selected')}{chosenApprovable.length > 0 && <span className="ml-2 tabular-nums">{chosenApprovable.length}</span>}
      </button>
      <button className={secondary} disabled={pending || !chosen.length} onClick={() => act(onDiscard, chosen)}>
        {copy('Descartar selecionadas', 'Discard selected')}{chosen.length > 0 && <span className="ml-2 tabular-nums">{chosen.length}</span>}
      </button>
    </div>

    <ul className="mt-4 grid gap-3">
      {proposals.map((proposal) => {
        const left = now === null ? null : approvalTimeLeft(proposal.expiresAt, now)
        return <li key={proposal.id} className="rounded-xl border border-border-steel bg-panel p-4">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              className="mt-1 size-5 shrink-0 accent-teal"
              // A proposal whose text cannot be produced is discardable but not
              // sendable, so the box only offers the choice the agent can make.
              checked={chosen.includes(proposal.id)}
              disabled={pending}
              onChange={(event) => setSelected((previous) => event.target.checked
                ? [...previous, proposal.id]
                : previous.filter((id) => id !== proposal.id))}
            />
            <span className="min-w-0 flex-1">
              <span className="block break-words font-semibold text-ink">{proposal.customerName}</span>
              <span className="mt-1 block text-sm text-ink-muted">
                {categoryLabels[proposal.category] ?? proposal.category}
                {' · '}<span className="tabular-nums">{proposal.phone}</span>
                {' · '}{proposal.language === 'PT' ? 'Português' : 'English'}
              </span>
              <span className="mt-1 block text-xs text-ink-muted">{left === null
                ? copy('Aguardando você.', 'Waiting for you.')
                : left.expired
                  ? copy('Expirou. Não sai mais, e o crédito volta na próxima passagem.', 'Expired. It no longer goes out, and the credit comes back on the next pass.')
                  : copy(
                    `Expira em ${left.hours}h${String(left.minutes).padStart(2, '0')} — depois disso, não sai mais.`,
                    `Expires in ${left.hours}h${String(left.minutes).padStart(2, '0')} — after that it no longer goes out.`,
                  )}</span>
            </span>
          </label>
          {/* The point of the whole screen: the exact text, as the client will
              read it. Plain text, never markup. */}
          {proposal.text !== null && <p className="mt-3 whitespace-pre-wrap break-words rounded-xl bg-paper p-3 text-sm leading-relaxed text-ink">{proposal.text}</p>}
          {proposal.problem !== null && <p role="alert" className="mt-3 rounded-xl bg-danger/10 p-3 text-sm leading-relaxed text-danger">
            {proposal.problem === 'TEMPLATE_MISSING'
              ? copy(
                'O modelo desta categoria e idioma não existe mais ou está desligado. Não dá para liberar esta mensagem: escreva o texto de novo ou descarte-a.',
                'The template for this category and language is gone or switched off. This message cannot be released: write the text again or discard it.',
              )
              : proposal.unknown.length
                ? copy(
                  `O modelo mudou e pede variáveis que não existem: ${proposal.unknown.join(', ')}. Corrija o modelo ou descarte esta mensagem — ela não pode ser liberada assim.`,
                  `The template changed and asks for variables that do not exist: ${proposal.unknown.join(', ')}. Fix the template or discard this message — it cannot be released as it is.`,
                )
                : copy(
                  'O modelo tem uma chave {{ ou }} sem par, então não dá para saber o que sairia. Corrija o modelo ou descarte esta mensagem.',
                  'The template has an unmatched {{ or }}, so there is no telling what would go out. Fix the template or discard this message.',
                )}
          </p>}
          <p className="mt-2 text-xs text-ink-muted">{copy('Criada em', 'Created')} {new Date(proposal.createdAt).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' })}</p>
        </li>
      })}
    </ul>
  </section>
}
