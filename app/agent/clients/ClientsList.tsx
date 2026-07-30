"use client";

import { useId, useMemo, useState } from "react";
import { EmptyState } from "@/components/Table";
import { EntityCard, EntityCardList } from "@/components/EntityCard";
import { Avatar } from "@/components/Avatar";
import { Pagination, clampPage } from "@/components/Pagination";

type Client = {
  id: string;
  name: string;
  email: string | null;
  agentId: string;
  agentName: string;
};

type SortDirection = "asc" | "desc";

const CLIENTS_PER_PAGE = 12;
const ALL_AGENTS = "__all__";
const collator = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });

export function ClientsList({ clients }: { clients: Client[] }) {
  const queryId = useId();
  const agentSelectId = useId();
  const sortId = useId();
  const [query, setQuery] = useState("");
  const [selectedAgentId, setSelectedAgentId] = useState(ALL_AGENTS);
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [onlyMissingEmail, setOnlyMissingEmail] = useState(false);
  const [page, setPage] = useState(1);

  const agents = useMemo(
    () =>
      Array.from(
        new Map(
          clients.map((client) => [
            client.agentId,
            { id: client.agentId, name: client.agentName },
          ]),
        ).values(),
      ).sort((left, right) => collator.compare(left.name, right.name)),
    [clients],
  );

  const filteredClients = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");
    const direction = sortDirection === "asc" ? 1 : -1;

    return clients
      .filter((client) => {
        const matchesAgent =
          selectedAgentId === ALL_AGENTS || client.agentId === selectedAgentId;
        const matchesQuery =
          normalizedQuery.length === 0 ||
          client.name.toLocaleLowerCase("pt-BR").includes(normalizedQuery) ||
          (client.email ?? "").toLocaleLowerCase("pt-BR").includes(normalizedQuery);

        const matchesContact = !onlyMissingEmail || !client.email;

        return matchesAgent && matchesQuery && matchesContact;
      })
      .sort((a, b) => {
        const byName = collator.compare(a.name, b.name);
        if (byName !== 0) return direction * byName;
        return direction * collator.compare(a.agentName, b.agentName);
      });
  }, [clients, query, selectedAgentId, sortDirection, onlyMissingEmail]);

  const missingEmailCount = useMemo(
    () => clients.filter((client) => !client.email).length,
    [clients],
  );

  const pageCount = Math.max(1, Math.ceil(filteredClients.length / CLIENTS_PER_PAGE));
  const currentPage = clampPage(page, pageCount);
  const pageClients = filteredClients.slice(
    (currentPage - 1) * CLIENTS_PER_PAGE,
    currentPage * CLIENTS_PER_PAGE,
  );
  const firstVisible = filteredClients.length === 0 ? 0 : (currentPage - 1) * CLIENTS_PER_PAGE + 1;
  const lastVisible = Math.min(currentPage * CLIENTS_PER_PAGE, filteredClients.length);
  const hasActiveFilters =
    query.trim().length > 0 ||
    selectedAgentId !== ALL_AGENTS ||
    sortDirection !== "asc" ||
    onlyMissingEmail;

  function clearFilters() {
    setQuery("");
    setSelectedAgentId(ALL_AGENTS);
    setSortDirection("asc");
    setOnlyMissingEmail(false);
    setPage(1);
  }

  return (
    <section aria-labelledby="clients-list-title">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-teal">
            Base de clientes
          </p>
          <h2
            id="clients-list-title"
            className="mt-2 text-2xl font-medium tracking-[-0.04em] text-ink sm:text-3xl"
          >
            Encontre quem precisa de você.
          </h2>
        </div>
        <p
          className="font-mono text-xs tabular-nums text-ink-muted"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {filteredClients.length === clients.length
            ? `${clients.length} ${clients.length === 1 ? "cliente" : "clientes"}`
            : `${filteredClients.length} de ${clients.length} clientes`}
        </p>
      </div>

      {/* A client with no email cannot be reached, and that is the agent's
          problem to fix rather than a gap to scroll past. The carrier has no
          more to give: its service log was already matched into these records
          and covers nobody new. */}
      {missingEmailCount > 0 && (
        <button
          type="button"
          onClick={() => {
            setOnlyMissingEmail((value) => !value);
            setPage(1);
          }}
          aria-pressed={onlyMissingEmail}
          className={`mt-4 inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm transition-colors ${
            onlyMissingEmail
              ? "border-teal bg-teal/10 text-teal"
              : "border-border-steel text-ink-muted hover:text-ink"
          }`}
        >
          <span className="font-mono tabular-nums">{missingEmailCount}</span>
          <span>sem e-mail cadastrado</span>
        </button>
      )}

      {clients.length > 0 && (
        <div className="mt-6 grid gap-3 rounded-2xl border border-border-steel/80 bg-panel/55 p-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.7fr)_minmax(180px,0.8fr)_minmax(160px,0.65fr)]">
          <label htmlFor={queryId} className="grid gap-1.5">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
              Buscar
            </span>
            <input
              id={queryId}
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
              placeholder="Nome ou e-mail"
              autoComplete="off"
              aria-controls="clients-results"
              className="min-h-11 w-full rounded-xl border border-border-steel bg-paper/85 px-3.5 py-2.5 text-sm text-ink outline-none transition-[background-color,border-color,box-shadow] placeholder:text-ink-muted/70 hover:border-teal/50 hover:bg-paper focus:border-teal focus:bg-paper focus:ring-[3px] focus:ring-teal-pale"
            />
          </label>

          <label htmlFor={agentSelectId} className="grid gap-1.5">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
              Responsável
            </span>
            <select
              id={agentSelectId}
              value={selectedAgentId}
              onChange={(event) => {
                setSelectedAgentId(event.target.value);
                setPage(1);
              }}
              aria-controls="clients-results"
              className="min-h-11 w-full rounded-xl border border-border-steel bg-paper/85 px-3.5 py-2.5 text-sm text-ink outline-none transition-[background-color,border-color,box-shadow] hover:border-teal/50 hover:bg-paper focus:border-teal focus:bg-paper focus:ring-[3px] focus:ring-teal-pale"
            >
              <option value={ALL_AGENTS}>Todos os agentes</option>
              {agents.map((agentItem) => (
                <option key={agentItem.id} value={agentItem.id}>
                  {agentItem.name}
                </option>
              ))}
            </select>
          </label>

          <label htmlFor={sortId} className="grid gap-1.5 sm:col-span-2 xl:col-span-1">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
              Ordenar
            </span>
            <select
              id={sortId}
              value={sortDirection}
              onChange={(event) => {
                setSortDirection(event.target.value as SortDirection);
                setPage(1);
              }}
              aria-controls="clients-results"
              className="min-h-11 w-full rounded-xl border border-border-steel bg-paper/85 px-3.5 py-2.5 text-sm text-ink outline-none transition-[background-color,border-color,box-shadow] hover:border-teal/50 hover:bg-paper focus:border-teal focus:bg-paper focus:ring-[3px] focus:ring-teal-pale"
            >
              <option value="asc">Nome: A–Z</option>
              <option value="desc">Nome: Z–A</option>
            </select>
          </label>
        </div>
      )}

      <div id="clients-results" className="mt-6">
        {clients.length === 0 ? (
          <EmptyState>
            Nenhum cliente está disponível nesta base. Eles aparecerão aqui quando forem vinculados à sua operação.
          </EmptyState>
        ) : filteredClients.length === 0 ? (
          <div className="module-empty-state">
            <span aria-hidden>
              <i />
              <i />
              <i />
            </span>
            <div>
              <p>Nenhum cliente corresponde à busca ou ao agente selecionado.</p>
              <button
                type="button"
                onClick={clearFilters}
                className="mt-4 inline-flex min-h-11 items-center justify-center rounded-full bg-rail-strong px-5 py-2.5 text-sm font-semibold text-paper transition-[background-color,transform] hover:-translate-y-0.5 hover:bg-rail focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-teal-pale"
              >
                Limpar busca e filtros
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-0.5">
              <p className="text-xs text-ink-muted">
                Mostrando <span className="font-mono text-ink">{firstVisible}–{lastVisible}</span> de{" "}
                <span className="font-mono text-ink">{filteredClients.length}</span>
              </p>
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="min-h-9 rounded-full border border-border-steel bg-paper/75 px-3.5 py-1.5 text-xs font-semibold text-ink-muted transition-colors hover:border-teal hover:text-teal focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-teal-pale"
                >
                  Limpar filtros
                </button>
              )}
            </div>

            <EntityCardList>
              {pageClients.map((client, index) => (
                <EntityCard key={client.id} index={index}>
                  <Avatar name={client.name} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-ink">{client.name}</p>
                    <p className="truncate text-xs text-ink-muted">
                      {client.email ?? "Sem e-mail cadastrado"}
                    </p>
                  </div>
                  <div className="min-w-0 basis-full border-t border-border-steel/70 pt-2 sm:basis-auto sm:border-t-0 sm:pt-0 sm:text-right">
                    <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
                      Responsável
                    </p>
                    <p className="mt-1 truncate text-xs font-medium text-ink">
                      {client.agentName}
                    </p>
                  </div>
                </EntityCard>
              ))}
            </EntityCardList>

            <Pagination
              page={currentPage}
              pageCount={pageCount}
              onPageChange={setPage}
            />
          </>
        )}
      </div>
    </section>
  );
}
