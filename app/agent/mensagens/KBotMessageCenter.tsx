'use client'

import { useMemo, useState, useTransition } from 'react'
import { useI18n } from '@/components/i18n/LanguageProvider'
import { ApprovalQueue } from '@/components/kbot/ApprovalQueue'
import type { ApprovalProblem, ApprovalProposal } from '@/lib/kbot-templates/approval-view'
import type { ScheduledCategory } from '@/lib/kbot-templates/categories'
import type { KBotContactRow } from '@/lib/kbot-messaging/contact-list'
import { KBotContactList } from './KBotContactList'
import { approveScheduledProposals, discardScheduledProposals } from '@/app/agent/kbot/agendadas/actions'
import { enableAllKBotContacts, toggleKBotContact } from './actions'

/// A proposta já escrita, esperando o agente dizer sim ou não. `jobIds` carrega
/// todos os jobs que este cartão representa — hoje sempre um, mas a fila lê o
/// array em vez de um id solto para não amarrar a central a essa suposição.
export type KBotMessageCenterProposal = {
  jobIds: string[]
  category: ScheduledCategory
  customerName: string
  phone: string
  language: 'PT' | 'EN'
  /// O texto pronto, ou `null` quando `problem` explica por que não dá para
  /// produzi-lo — o mesmo par que `toApprovalProposal` já calcula.
  content: string | null
  createdAt: string
  /// Opcionais porque o teste do bloco monta a proposta à mão, sem passar
  /// pelo `toApprovalProposal` da página real. Ausentes, o cartão trata a
  /// proposta como sem problema e sem prazo definido.
  problem?: ApprovalProblem | null
  unknown?: string[]
  expiresAt?: string
}

/// O K-Bot dentro de Mensagens: a fila que espera decisão e, quando não há
/// nada ligado, o convite para ligar por contato ou para todos de uma vez.
/// O gate de envio continua sendo o único ponto de decisão — este bloco só
/// move a UI para onde o agente já está.
export function KBotMessageCenter({
  proposals,
  contacts,
  reach,
  contactsQuery = '',
  contactsPage = 1,
  contactsTotalPages = 1,
  conversationId,
  example,
}: {
  proposals: readonly KBotMessageCenterProposal[]
  contacts: readonly KBotContactRow[]
  /// `enabledCount` conta o agente inteiro (`kBotContactPreference` com
  /// `kbotEnabledAt` preenchido), não as linhas da página atual — o convite
  /// abaixo depende disso ser verdade para o agente, não para as 25 linhas
  /// que aconteceram de carregar. Opcional (default 0) só para o teste do
  /// bloco, que não constrói esse agregado.
  reach: { total: number; withPhone: number; enabledCount?: number }
  /// Busca e paginação vêm prontas do servidor: com 17.733 contatos por
  /// agente e a lista sem virtualização, mandar a página inteira de uma vez
  /// seria pior do que não ter tela nenhuma. Opcionais para o teste do bloco,
  /// que renderiza sem elas.
  contactsQuery?: string
  contactsPage?: number
  contactsTotalPages?: number
  /// A conversa aberta no `MessagingWorkspace` ao lado. Paginar contatos não
  /// pode fechá-la — as duas coisas coexistem na mesma tela de propósito.
  conversationId?: string
  /// O exemplo do que sairia quando nada está ligado ainda, mostrando valor
  /// antes de qualquer decisão. Opcional — se não houver contato com
  /// aniversário, o campo fica vazio.
  example?: { name: string; when: string; text: string } | null
}) {
  const { copy } = useI18n()
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()

  const unavailable = copy('Não foi possível concluir agora. Tente novamente.', 'We could not finish this right now. Please try again.')

  // Cada proposta vira um cartão com um id próprio (o primeiro job que ela
  // representa) mas guarda o array completo, para que aprovar ou descartar
  // libere todos os jobs do cartão — não só o primeiro.
  const rows: ApprovalProposal[] = useMemo(() => proposals.map((proposal) => ({
    id: proposal.jobIds[0] ?? proposal.phone,
    category: proposal.category,
    customerName: proposal.customerName,
    phone: proposal.phone,
    language: proposal.language,
    text: proposal.content,
    problem: proposal.problem ?? null,
    unknown: proposal.unknown ?? [],
    createdAt: proposal.createdAt,
    // A página real sempre calcula o prazo real via `toApprovalProposal`
    // (a mesma janela que o worker usa). Sem ele — só no teste do bloco —
    // um prazo distante evita que o cartão pareça expirado sem motivo.
    expiresAt: proposal.expiresAt ?? new Date(8.64e15).toISOString(),
  })), [proposals])

  const jobIdsByRowId = useMemo(
    () => new Map(proposals.map((proposal) => [proposal.jobIds[0] ?? proposal.phone, proposal.jobIds])),
    [proposals],
  )
  const expand = (rowIds: string[]) => rowIds.flatMap((id) => jobIdsByRowId.get(id) ?? [])

  const categoryLabels: Record<string, string> = {
    BIRTHDAY: copy('Aniversário', 'Birthday'),
    ANNUAL_REVIEW: copy('Revisão anual', 'Annual review'),
    LAPSE_RECOVERY: copy('Recuperação de lapso', 'Lapse recovery'),
  }

  function run(work: () => Promise<{ ok: boolean; message?: string }>, success: string) {
    setError('')
    setNotice('')
    startTransition(async () => {
      const result = await work()
      if (result.ok) setNotice(success)
      else setError(result.message ?? unavailable)
    })
  }

  /// Liga todos os contatos alcançáveis e mostra a contagem real — quantos
  /// foram ligados, quantos não têm telefone e quantos pediram para não
  /// receber e ficaram de fora. "Todos" nunca significou literalmente todos,
  /// e o aviso depois do clique precisa ser tão honesto quanto a tela era
  /// antes dele.
  function runEnableAll() {
    setError('')
    setNotice('')
    startTransition(async () => {
      const result = await enableAllKBotContacts({})
      if (!result.ok) { setError(result.message ?? unavailable); return }
      setNotice(copy(
        `${result.enabled} contato(s) ligado(s). ${result.withoutPhone} sem telefone e ${result.optedOut} que pediram para não receber ficaram de fora.`,
        `${result.enabled} contact(s) turned on. ${result.withoutPhone} with no phone and ${result.optedOut} who asked not to be contacted were left out.`,
      ))
    })
  }

  // Agent-wide, not page-wide: as 25 linhas em tela não dizem se algum dos
  // outros 17 mil contatos já está ligado.
  const nothingOn = (reach.enabledCount ?? 0) === 0 && reach.withPhone > 0

  // Preserva a conversa aberta ao lado ao trocar de página de contatos — as
  // duas coisas coexistem na mesma tela, e paginar não pode fechar o chat.
  function contactsHref(page: number) {
    const params = new URLSearchParams()
    if (contactsQuery) params.set('contactsQuery', contactsQuery)
    params.set('contactsPage', String(page))
    if (conversationId) params.set('conversation', conversationId)
    return `?${params.toString()}`
  }

  return <section className="my-4 rounded-2xl border border-border-steel bg-panel p-4 sm:p-6" aria-label={copy('K-Bot em Mensagens', 'K-Bot in Messages')}>
    {error && <p role="alert" className="mb-4 rounded-xl bg-danger/10 p-3 text-sm text-danger">{error}</p>}
    {notice && <p role="status" className="mb-4 rounded-xl bg-teal-pale p-3 text-sm text-teal-deep">{notice}</p>}

    <ApprovalQueue
      proposals={rows}
      categoryLabels={categoryLabels}
      pending={pending}
      onApprove={(rowIds) => run(
        () => approveScheduledProposals({ jobIds: expand(rowIds) }),
        copy('Mensagens liberadas.', 'Messages released.'),
      )}
      onDiscard={(rowIds) => run(
        () => discardScheduledProposals({ jobIds: expand(rowIds) }),
        copy('Mensagens descartadas. Nada foi enviado.', 'Messages discarded. Nothing was sent.'),
      )}
    />

    {nothingOn && <div className="mt-4 rounded-2xl border border-teal bg-teal-pale/40 p-4">
      <h3 className="text-lg font-semibold text-ink">{copy('Nenhum contato com o K-Bot ligado', 'No contact has K-Bot turned on')}</h3>
      <p className="mt-1 max-w-2xl text-sm text-ink-muted">{copy(
        `De ${reach.total.toLocaleString('pt-BR')} contatos, ${reach.withPhone.toLocaleString('pt-BR')} têm telefone cadastrado. Números inválidos serão ignorados ao ligar.`,
        `Of ${reach.total.toLocaleString('pt-BR')} contacts, ${reach.withPhone.toLocaleString('pt-BR')} have a phone on file. Invalid numbers will be skipped when turning K-Bot on.`,
      )}</p>
      {example && <div className="mt-3 rounded-xl bg-white/60 p-3">
        <p className="text-xs font-medium text-ink-muted uppercase">{copy('Exemplo', 'Example')}: {example.name}, {example.when}</p>
        <p className="mt-1 text-sm text-ink">{example.text}</p>
      </div>}
      <button
        type="button"
        disabled={pending}
        className="mt-3 inline-flex min-h-11 items-center justify-center rounded-xl bg-teal px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal-deep disabled:opacity-40"
        onClick={runEnableAll}
      >{copy('Ligar o K-Bot para todos', 'Turn K-Bot on for everyone')}</button>
    </div>}

    <div className="mt-5">
      {/* Busca server-side: 17.733 contatos por agente não cabem numa única
          página, e a lista abaixo não tem virtualização. */}
      <form className="flex flex-wrap items-center gap-2" method="get">
        <input
          type="search"
          name="contactsQuery"
          defaultValue={contactsQuery}
          placeholder={copy('Buscar por nome ou telefone', 'Search by name or phone')}
          className="min-h-11 flex-1 rounded-xl border border-border-steel bg-panel px-3 text-sm text-ink"
        />
        <button type="submit" className="inline-flex min-h-11 items-center rounded-xl border border-border-steel bg-panel px-4 text-sm font-medium text-ink">
          {copy('Buscar', 'Search')}
        </button>
      </form>

      <KBotContactList
        rows={contacts}
        onToggle={({ clientId, enabled }) => run(
          () => toggleKBotContact({ clientId, enabled }),
          enabled
            ? copy('K-Bot ligado para este contato.', 'K-Bot turned on for this contact.')
            : copy('K-Bot desligado para este contato.', 'K-Bot turned off for this contact.'),
        )}
      />

      {contactsTotalPages > 1 && <nav className="mt-3 flex items-center justify-between gap-3" aria-label={copy('Páginas de contatos', 'Contact pages')}>
        <a
          aria-disabled={contactsPage <= 1}
          className={contactsPage <= 1 ? 'pointer-events-none text-sm text-ink-muted opacity-40' : 'text-sm text-teal-deep'}
          href={contactsHref(contactsPage - 1)}
        >{copy('Anterior', 'Previous')}</a>
        <span className="text-xs text-ink-muted">{copy(`Página ${contactsPage} de ${contactsTotalPages}`, `Page ${contactsPage} of ${contactsTotalPages}`)}</span>
        <a
          aria-disabled={contactsPage >= contactsTotalPages}
          className={contactsPage >= contactsTotalPages ? 'pointer-events-none text-sm text-ink-muted opacity-40' : 'text-sm text-teal-deep'}
          href={contactsHref(contactsPage + 1)}
        >{copy('Próxima', 'Next')}</a>
      </nav>}
    </div>
  </section>
}
