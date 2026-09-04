'use client'

import Link from 'next/link'
import { useId } from 'react'
import { EmptyState } from '@/components/Table'
import { EntityCard, EntityCardList } from '@/components/EntityCard'
import { Avatar } from '@/components/Avatar'
import { useI18n } from '@/components/i18n/LanguageProvider'
import type {
  ClientDirectoryFilters,
  ClientDirectoryItem,
  ClientDirectoryOwner,
} from '@/lib/crm/client-directory'

function clientsHref(
  filters: ClientDirectoryFilters,
  changes: Partial<ClientDirectoryFilters> = {},
) {
  const next = { ...filters, ...changes }
  const params = new URLSearchParams()
  if (next.query) params.set('q', next.query)
  if (next.ownerId) params.set('owner', next.ownerId)
  if (next.contactMissing) params.set('contact', 'missing')
  if (next.sort !== 'name-asc') params.set('sort', next.sort)
  if (next.page > 1) params.set('page', String(next.page))
  const query = params.toString()
  return query ? `/agent/clients?${query}` : '/agent/clients'
}

export function ClientsList({
  items,
  total,
  page,
  pageCount,
  summary,
  filters,
  owners,
}: {
  items: ClientDirectoryItem[]
  total: number
  page: number
  pageCount: number
  summary: { total: number; withEmail: number; withoutEmail: number; assignedAgents: number }
  filters: ClientDirectoryFilters
  owners: ClientDirectoryOwner[]
}) {
  const { copy } = useI18n()
  const queryId = useId()
  const ownerId = useId()
  const sortId = useId()
  const contactId = useId()
  const firstVisible = total === 0 ? 0 : (page - 1) * 25 + 1
  const lastVisible = Math.min(page * 25, total)
  const hasFilters = Boolean(filters.query || filters.ownerId || filters.contactMissing || filters.sort !== 'name-asc')

  return (
    <section aria-labelledby="clients-list-title">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-teal">{copy('Base de clientes', 'Client base')}</p>
          <h2 id="clients-list-title" className="mt-2 text-2xl font-medium tracking-[-0.04em] text-ink sm:text-3xl">{copy('Encontre quem precisa de você.', 'Find who needs you.')}</h2>
        </div>
        <p className="font-mono text-xs tabular-nums text-ink-muted" role="status" aria-live="polite" aria-atomic="true">
          {total === 1 ? copy('1 cliente', '1 client') : copy('{count} clientes', '{count} clients', { count: total })}
        </p>
      </div>

      {summary.withoutEmail > 0 && (
        <Link
          href={clientsHref(filters, { contactMissing: !filters.contactMissing, page: 1 })}
          aria-current={filters.contactMissing ? 'page' : undefined}
          className={`mt-4 inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm transition-colors ${filters.contactMissing ? 'border-teal bg-teal/10 text-teal' : 'border-border-steel text-ink-muted hover:text-ink'}`}
        >
          <span className="font-mono tabular-nums">{summary.withoutEmail}</span>
          <span>{copy('sem e-mail cadastrado', 'without an email address')}</span>
        </Link>
      )}

      <form action="/agent/clients" method="get" className="mt-6 grid gap-3 rounded-2xl border border-border-steel/80 bg-panel/55 p-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.7fr)_minmax(180px,0.8fr)_minmax(160px,0.65fr)]">
        <label htmlFor={queryId} className="grid gap-1.5">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted">{copy('Buscar', 'Search')}</span>
          <input id={queryId} name="q" type="search" defaultValue={filters.query} placeholder={copy('Nome ou e-mail', 'Name or email')} autoComplete="off" className="min-h-11 w-full rounded-xl border border-border-steel bg-paper/85 px-3.5 py-2.5 text-sm text-ink outline-none transition-[background-color,border-color,box-shadow] placeholder:text-ink-muted/70 hover:border-teal/50 hover:bg-paper focus:border-teal focus:bg-paper focus:ring-[3px] focus:ring-teal-pale" />
        </label>
        <label htmlFor={ownerId} className="grid gap-1.5">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted">{copy('Responsável', 'Owner')}</span>
          <select id={ownerId} name="owner" defaultValue={filters.ownerId ?? ''} className="min-h-11 w-full rounded-xl border border-border-steel bg-paper/85 px-3.5 py-2.5 text-sm text-ink outline-none transition-[background-color,border-color,box-shadow] hover:border-teal/50 hover:bg-paper focus:border-teal focus:bg-paper focus:ring-[3px] focus:ring-teal-pale">
            <option value="">{copy('Todos os agentes', 'All agents')}</option>
            {owners.map((owner) => <option key={owner.id} value={owner.id}>{owner.name}</option>)}
          </select>
        </label>
        <label htmlFor={sortId} className="grid gap-1.5">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted">{copy('Ordenar', 'Sort')}</span>
          <select id={sortId} name="sort" defaultValue={filters.sort} className="min-h-11 w-full rounded-xl border border-border-steel bg-paper/85 px-3.5 py-2.5 text-sm text-ink outline-none transition-[background-color,border-color,box-shadow] hover:border-teal/50 hover:bg-paper focus:border-teal focus:bg-paper focus:ring-[3px] focus:ring-teal-pale">
            <option value="name-asc">{copy('Nome: A–Z', 'Name: A–Z')}</option>
            <option value="name-desc">{copy('Nome: Z–A', 'Name: Z–A')}</option>
          </select>
        </label>
        <label htmlFor={contactId} className="flex min-h-11 items-center gap-2 text-sm text-ink-muted">
          <input id={contactId} name="contact" type="checkbox" value="missing" defaultChecked={filters.contactMissing} />
          {copy('Somente sem e-mail', 'Only without email')}
        </label>
        <div className="flex items-end gap-3">
          <button type="submit" className="min-h-11 rounded-full bg-rail-strong px-4 py-2.5 text-sm font-semibold text-paper">{copy('Aplicar', 'Apply')}</button>
          {hasFilters && <Link href="/agent/clients" className="text-sm font-semibold text-teal">{copy('Limpar filtros', 'Clear filters')}</Link>}
        </div>
      </form>

      <div id="clients-results" className="mt-6">
        {total === 0 ? (
          <EmptyState>
            {hasFilters
              ? copy('Nenhum cliente corresponde aos filtros selecionados.', 'No client matches the selected filters.')
              : copy('Nenhum cliente está disponível nesta base. Eles aparecerão aqui quando forem vinculados à sua operação.', 'No clients are available in this base. They will appear here when linked to your operation.')}
          </EmptyState>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-0.5">
              <p className="text-xs text-ink-muted">{copy('Mostrando', 'Showing')} <span className="font-mono text-ink">{firstVisible}–{lastVisible}</span> {copy('de', 'of')} <span className="font-mono text-ink">{total}</span></p>
              {hasFilters && <Link href="/agent/clients" className="min-h-9 rounded-full border border-border-steel bg-paper/75 px-3.5 py-1.5 text-xs font-semibold text-ink-muted">{copy('Limpar filtros', 'Clear filters')}</Link>}
            </div>
            <EntityCardList>
              {items.map((client, index) => (
                <EntityCard key={client.id} index={index}>
                  <Avatar name={client.name} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-ink"><Link href={`/agent/clients/${client.id}`} className="hover:text-teal">{client.name}</Link></p>
                    <p className="truncate text-xs text-ink-muted">{client.email ?? copy('Sem e-mail cadastrado', 'No email address')}</p>
                  </div>
                  <div className="min-w-0 basis-full border-t border-border-steel/70 pt-2 sm:basis-auto sm:border-t-0 sm:pt-0 sm:text-right">
                    <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-ink-muted">{copy('Responsável', 'Owner')}</p>
                    <p className="mt-1 truncate text-xs font-medium text-ink">{client.agentName}</p>
                  </div>
                </EntityCard>
              ))}
            </EntityCardList>
            {pageCount > 1 && (
              <nav aria-label={copy('Paginação', 'Pagination')} className="mt-4 flex items-center justify-between gap-3 border-t border-border-steel pt-4">
                {page > 1 ? <Link href={clientsHref(filters, { page: page - 1 })}>{copy('Anterior', 'Previous')}</Link> : <span />}
                <span className="font-mono text-xs text-ink-muted">{copy('Página {page} de {pages}', 'Page {page} of {pages}', { page, pages: pageCount })}</span>
                {page < pageCount ? <Link href={clientsHref(filters, { page: page + 1 })}>{copy('Próxima', 'Next')}</Link> : <span />}
              </nav>
            )}
          </>
        )}
      </div>
    </section>
  )
}
