"use client";

import { useDeferredValue, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { EmptyState } from "@/components/Table";
import { IllustrationPdfButton } from "./IllustrationPdfButton";
import { useI18n } from "@/components/i18n/LanguageProvider";

export type IllustrationDocumentState =
  | "READY"
  | "WORKING"
  | "ATTENTION"
  | "NOT_REQUESTED";

export type IllustrationWorkspaceItem = {
  id: string;
  dateLabel: string;
  insuredName: string;
  insuredDetails: string;
  client: { id: string; name: string } | null;
  productName: string;
  strategy: string | null;
  faceAmount: number | null;
  premium: number | null;
  annualPremium: number | null;
  documentState: IllustrationDocumentState;
  documentMessage: string | null;
};

type DocumentFilter = "all" | "ready" | "open";
type SortMode = "recent" | "insured-asc" | "capital-desc" | "premium-asc";
type MetricKey = "all" | "ready" | "open";

const PAGE_SIZE = 8;
function paginationItems(page: number, pageCount: number) {
  const pages = Array.from(
    new Set(
      [1, page - 1, page, page + 1, pageCount].filter(
        (item) => item >= 1 && item <= pageCount,
      ),
    ),
  ).sort((left, right) => left - right);
  const items: Array<number | "ellipsis"> = [];

  pages.forEach((item, index) => {
    const previous = pages[index - 1];
    if (previous && item - previous > 1) items.push("ellipsis");
    items.push(item);
  });

  return items;
}

export function IllustrationsWorkspace({
  illustrations,
  isLimited = false,
}: {
  illustrations: IllustrationWorkspaceItem[];
  isLimited?: boolean;
}) {
  const { copy, locale } = useI18n();
  const count = useMemo(
    () => new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }),
    [locale],
  );
  const usd = useMemo(
    () => new Intl.NumberFormat(locale, {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }),
    [locale],
  );
  const documentLabel: Record<IllustrationDocumentState, string> = {
    READY: copy("PDF pronto", "PDF ready"),
    WORKING: copy("K-Bot trabalhando", "K-Bot working"),
    ATTENTION: copy("Pede atenção", "Needs attention"),
    NOT_REQUESTED: copy("PDF não solicitado", "PDF not requested"),
  };
  const formatMoney = (value: number | null) =>
    value === null || !Number.isFinite(value) ? "—" : usd.format(value);
  const root = useRef<HTMLDivElement>(null);
  const listStart = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [documentFilter, setDocumentFilter] =
    useState<DocumentFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("recent");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(
    illustrations[0]?.id ?? null,
  );
  const deferredQuery = useDeferredValue(query);

  const summary = useMemo(() => {
    let ready = 0;

    for (const illustration of illustrations) {
      if (illustration.documentState === "READY") ready += 1;
    }

    return {
      total: illustrations.length,
      ready,
      open: illustrations.length - ready,
    };
  }, [illustrations]);

  const filteredIllustrations = useMemo(() => {
    const normalizedQuery = deferredQuery.trim().toLocaleLowerCase(locale);
    const result = illustrations.filter((illustration) => {
      if (
        documentFilter === "ready" &&
        illustration.documentState !== "READY"
      ) {
        return false;
      }
      if (
        documentFilter === "open" &&
        illustration.documentState === "READY"
      ) {
        return false;
      }
      if (!normalizedQuery) return true;

      return [
        illustration.insuredName,
        illustration.client?.name,
        illustration.productName,
        illustration.strategy,
        illustration.insuredDetails,
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase(locale)
        .includes(normalizedQuery);
    });

    if (sortMode === "insured-asc") {
      return result.sort((left, right) =>
        left.insuredName.localeCompare(right.insuredName, locale),
      );
    }
    if (sortMode === "capital-desc") {
      return result.sort(
        (left, right) =>
          (right.faceAmount ?? -1) - (left.faceAmount ?? -1),
      );
    }
    if (sortMode === "premium-asc") {
      return result.sort(
        (left, right) => (left.premium ?? Infinity) - (right.premium ?? Infinity),
      );
    }
    return result;
  }, [deferredQuery, documentFilter, illustrations, locale, sortMode]);

  const pageCount = Math.max(
    1,
    Math.ceil(filteredIllustrations.length / PAGE_SIZE),
  );
  const currentPage = Math.min(Math.max(page, 1), pageCount);
  const pageStart =
    filteredIllustrations.length > 0
      ? (currentPage - 1) * PAGE_SIZE + 1
      : 0;
  const pageEnd = Math.min(
    currentPage * PAGE_SIZE,
    filteredIllustrations.length,
  );
  const pageIllustrations = filteredIllustrations.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );
  const selectedIndex = filteredIllustrations.findIndex(
    (illustration) => illustration.id === selectedId,
  );
  const activeIndex = selectedIndex >= 0 ? selectedIndex : 0;
  const selected = filteredIllustrations[activeIndex] ?? null;
  const hasActiveControls =
    query.trim().length > 0 ||
    documentFilter !== "all" ||
    sortMode !== "recent";

  useGSAP(
    () => {
      if (
        illustrations.length === 0 ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        return;
      }

      const intro = gsap.timeline({ defaults: { ease: "power3.out" } });
      intro
        .from("[data-illustration-metric]", {
          y: 20,
          scale: 0.97,
          opacity: 0,
          duration: 0.62,
          stagger: 0.07,
        })
        .from(
          "[data-illustration-control]",
          {
            y: 16,
            opacity: 0,
            duration: 0.5,
            stagger: 0.05,
          },
          "-=0.28",
        );
    },
    { scope: root },
  );

  useGSAP(
    () => {
      if (
        illustrations.length === 0 ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        return;
      }

      gsap.fromTo(
        "[data-illustration-row]",
        { y: 18, scale: 0.985, opacity: 0 },
        {
          y: 0,
          scale: 1,
          opacity: 1,
          duration: 0.42,
          stagger: 0.045,
          ease: "power3.out",
          clearProps: "transform,opacity",
        },
      );
    },
    {
      scope: root,
      dependencies: [
        currentPage,
        deferredQuery,
        documentFilter,
        sortMode,
      ],
      revertOnUpdate: true,
    },
  );

  useGSAP(
    () => {
      if (
        illustrations.length === 0 ||
        !selected ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        return;
      }

      gsap.fromTo(
        "[data-illustration-preview-content]",
        { y: 10, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.38,
          ease: "power3.out",
          clearProps: "transform,opacity",
        },
      );
    },
    {
      scope: root,
      dependencies: [selected?.id],
      revertOnUpdate: true,
    },
  );

  function clearControls() {
    setQuery("");
    setDocumentFilter("all");
    setSortMode("recent");
    setPage(1);
  }

  function chooseFilter(nextFilter: DocumentFilter) {
    setDocumentFilter(nextFilter);
    setPage(1);
  }

  function chooseMetric(metric: MetricKey) {
    setQuery("");
    setSortMode("recent");
    setDocumentFilter(
      metric === "ready" ? "ready" : metric === "open" ? "open" : "all",
    );
    setPage(1);
    window.requestAnimationFrame(() => {
      listStart.current?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        block: "start",
      });
    });
  }

  function changePage(nextPage: number) {
    const clamped = Math.min(Math.max(nextPage, 1), pageCount);
    const firstResult = filteredIllustrations[(clamped - 1) * PAGE_SIZE];
    setPage(clamped);
    setSelectedId(firstResult?.id ?? null);
    window.requestAnimationFrame(() => {
      listStart.current?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        block: "start",
      });
    });
  }

  function changeSelection(direction: -1 | 1) {
    const nextIndex = activeIndex + direction;
    const nextIllustration = filteredIllustrations[nextIndex];
    if (nextIllustration) setSelectedId(nextIllustration.id);
  }

  const metrics = [
    {
      key: "all" as const,
      label: copy("Ilustrações", "Illustrations"),
      value: count.format(summary.total),
      detail: isLimited
        ? copy("Últimas 100 cotações da sua operação", "Latest 100 quotes in your operation")
        : copy("Cotações preservadas na sua operação", "Quotes saved in your operation"),
      action: copy("Ver histórico", "View history"),
    },
    {
      key: "ready" as const,
      label: copy("PDFs prontos", "PDFs ready"),
      value: count.format(summary.ready),
      detail: copy("Documentos disponíveis para consulta", "Documents available to review"),
      action: copy("Abrir documentos", "Open documents"),
    },
    {
      key: "open" as const,
      label: copy("A concluir", "To complete"),
      value: count.format(summary.open),
      detail:
        summary.open === 1
          ? copy("Documento ainda sem PDF final", "Document still awaiting its final PDF")
          : copy("Documentos ainda sem PDF final", "Documents still awaiting their final PDFs"),
      action: copy("Revisar fila", "Review queue"),
    },
  ];

  const activeMetric: MetricKey | null =
    query.trim() !== "" || sortMode !== "recent"
      ? null
      : documentFilter === "ready"
        ? "ready"
        : documentFilter === "open"
          ? "open"
          : "all";

  if (illustrations.length === 0) {
    return (
      <section className="illustration-empty module-main-surface">
        <EmptyState>
          {copy(
            "Nenhuma ilustração ainda. Comece uma cotação para registrar o cenário, o capital e o prêmio devolvidos pela seguradora.",
            "No illustrations yet. Start a quote to record the scenario, face amount, and premium returned by the carrier.",
          )}
        </EmptyState>
        <Link href="/agent/illustrations/new">{copy("Criar primeira ilustração", "Create first illustration")}</Link>
      </section>
    );
  }

  return (
    <div ref={root} className="illustrations-workspace">
      <nav
        className="illustration-metrics"
        aria-label={copy("Atalhos das ilustrações", "Illustration shortcuts")}
      >
        {metrics.map((metric) => (
          <button
            key={metric.key}
            type="button"
            data-illustration-metric
            data-active={activeMetric === metric.key || undefined}
            aria-pressed={activeMetric === metric.key}
            aria-controls="illustration-results"
            onClick={() => chooseMetric(metric.key)}
          >
            <span>
              <strong>{metric.label}</strong>
              <small>{metric.detail}</small>
            </span>
            <b>{metric.value}</b>
            <i>
              {metric.action}
              <svg aria-hidden="true" viewBox="0 0 18 18" fill="none">
                <path d="M4.5 9h9M10 5.5 13.5 9 10 12.5" />
              </svg>
            </i>
          </button>
        ))}
      </nav>

      <section
        ref={listStart}
        className="illustration-command-deck"
        aria-labelledby="illustration-browser-title"
      >
        <header data-illustration-control>
          <div>
            <h2 id="illustration-browser-title">
              {copy("Encontre a cotação certa", "Find the right quote")}
              <span className="illustration-inline-document" aria-hidden="true">
                <svg viewBox="0 0 34 18" fill="none">
                  <path d="M8 3h13l5 5v7H8V3Z" />
                  <path d="M21 3v5h5M12 9h6M12 12h10" />
                </svg>
              </span>
            </h2>
            <p>{copy("Localize pelo segurado, cliente, produto ou estratégia.", "Search by insured, client, product, or strategy.")}</p>
          </div>
          <p className="illustration-result-count" role="status" aria-live="polite">
            <strong>{pageStart}–{pageEnd}</strong>
            <span>{copy("de {count}", "of {count}", { count: count.format(filteredIllustrations.length) })}</span>
          </p>
        </header>

        <div className="illustration-command-grid" data-illustration-control>
          <label className="illustration-command-search" htmlFor="illustration-search">
            <span>{copy("Buscar ilustração", "Search illustrations")}</span>
            <span>
              <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
                <circle cx="8.6" cy="8.6" r="5.1" />
                <path d="m12.5 12.5 4 4" />
              </svg>
              <input
                id="illustration-search"
                type="search"
                value={query}
                placeholder={copy("Segurado, cliente, produto ou estratégia", "Insured, client, product, or strategy")}
                aria-controls="illustration-results"
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape" && query) {
                    setQuery("");
                    setPage(1);
                  }
                }}
              />
              {query ? (
                <button
                  type="button"
                  aria-label={copy("Limpar busca", "Clear search")}
                  onClick={() => {
                    setQuery("");
                    setPage(1);
                  }}
                >
                  <svg aria-hidden="true" viewBox="0 0 16 16" fill="none">
                    <path d="m4 4 8 8M12 4l-8 8" />
                  </svg>
                </button>
              ) : null}
            </span>
          </label>

          <label className="illustration-command-sort" htmlFor="illustration-sort">
            <span>{copy("Ordenar resultados", "Sort results")}</span>
            <select
              id="illustration-sort"
              value={sortMode}
              onChange={(event) => {
                setSortMode(event.target.value as SortMode);
                setPage(1);
              }}
            >
              <option value="recent">{copy("Mais recentes", "Most recent")}</option>
              <option value="insured-asc">{copy("Segurado: A–Z", "Insured: A–Z")}</option>
              <option value="capital-desc">{copy("Maior capital", "Highest face amount")}</option>
              <option value="premium-asc">{copy("Menor prêmio", "Lowest premium")}</option>
            </select>
          </label>

          <button
            type="button"
            className="illustration-command-clear"
            disabled={!hasActiveControls}
            onClick={clearControls}
          >
            <svg aria-hidden="true" viewBox="0 0 18 18" fill="none">
              <path d="M4.2 5.7h9.6M7 5.7V4.1h4v1.6m-5.8 0 .6 8.2h6.4l.6-8.2" />
            </svg>
            {copy("Limpar", "Clear")}
          </button>
        </div>

        <div className="illustration-filter-bar" data-illustration-control>
          <span>{copy("Documento", "Document")}</span>
          <div role="group" aria-label={copy("Filtrar por situação do documento", "Filter by document status")}>
            <button
              type="button"
              aria-pressed={documentFilter === "all"}
              aria-controls="illustration-results"
              onClick={() => chooseFilter("all")}
            >
              {copy("Todos", "All")} <small>{count.format(summary.total)}</small>
            </button>
            <button
              type="button"
              aria-pressed={documentFilter === "ready"}
              aria-controls="illustration-results"
              onClick={() => chooseFilter("ready")}
            >
              {copy("PDF pronto", "PDF ready")} <small>{count.format(summary.ready)}</small>
            </button>
            <button
              type="button"
              aria-pressed={documentFilter === "open"}
              aria-controls="illustration-results"
              onClick={() => chooseFilter("open")}
            >
              {copy("A concluir", "To complete")} <small>{count.format(summary.open)}</small>
            </button>
          </div>
        </div>
      </section>

      {filteredIllustrations.length === 0 ? (
        <section id="illustration-results" className="illustration-no-results">
          <h3>{copy("Nenhuma cotação corresponde a esta busca.", "No quotes match this search.")}</h3>
          <p>{copy("Tente outro segurado, produto ou situação do documento.", "Try another insured, product, or document status.")}</p>
          <button type="button" onClick={clearControls}>
            {copy("Ver todas as ilustrações", "View all illustrations")}
          </button>
        </section>
      ) : (
        <div className="illustration-browser" id="illustration-results">
          <aside className="illustration-preview">
            {selected ? (
              <div data-illustration-preview-content>
                <header>
                  <span>{copy("Cotação selecionada", "Selected quote")}</span>
                  <div>
                    <button
                      type="button"
                      aria-label={copy("Ilustração anterior", "Previous illustration")}
                      disabled={activeIndex <= 0}
                      onClick={() => changeSelection(-1)}
                    >
                      <svg aria-hidden="true" viewBox="0 0 18 18" fill="none">
                        <path d="m10.5 5.5-3.5 3.5 3.5 3.5" />
                      </svg>
                    </button>
                    <small>{activeIndex + 1} / {filteredIllustrations.length}</small>
                    <button
                      type="button"
                      aria-label={copy("Próxima ilustração", "Next illustration")}
                      disabled={activeIndex >= filteredIllustrations.length - 1}
                      onClick={() => changeSelection(1)}
                    >
                      <svg aria-hidden="true" viewBox="0 0 18 18" fill="none">
                        <path d="m7.5 5.5 3.5 3.5-3.5 3.5" />
                      </svg>
                    </button>
                  </div>
                </header>

                <div className="illustration-document-visual" aria-hidden="true">
                  <span>K</span>
                  <i />
                  <i />
                  <i />
                  <strong>{formatMoney(selected.faceAmount)}</strong>
                  <small>{copy("capital simulado", "illustrated face amount")}</small>
                </div>

                <div className="illustration-preview-title" aria-live="polite">
                  <span data-state={selected.documentState}>
                    {documentLabel[selected.documentState]}
                  </span>
                  <h3>{selected.insuredName}</h3>
                  <p>{selected.insuredDetails || copy("Dados do segurado não informados", "Insured details not provided")}</p>
                </div>

                <dl>
                  <div>
                    <dt>{copy("Produto", "Product")}</dt>
                    <dd>{selected.productName}</dd>
                  </div>
                  <div>
                    <dt>{copy("Prêmio mensal", "Monthly premium")}</dt>
                    <dd>{formatMoney(selected.premium)}</dd>
                  </div>
                  <div>
                    <dt>{copy("Prêmio anual", "Annual premium")}</dt>
                    <dd>{formatMoney(selected.annualPremium)}</dd>
                  </div>
                  <div>
                    <dt>{copy("Data da cotação", "Quote date")}</dt>
                    <dd>{selected.dateLabel}</dd>
                  </div>
                </dl>

                {selected.client ? (
                  <Link
                    className="illustration-client-link"
                    href={`/agent/clients/${selected.client.id}`}
                  >
                    <span>
                      {copy("Cliente vinculado", "Linked client")}
                      <strong>{selected.client.name}</strong>
                    </span>
                    <svg aria-hidden="true" viewBox="0 0 18 18" fill="none">
                      <path d="M4.5 9h9M10 5.5 13.5 9 10 12.5" />
                    </svg>
                  </Link>
                ) : (
                  <div className="illustration-prospect-note">
                    {copy("Cotação de pré-venda ainda sem cliente vinculado.", "Pre-sale quote with no linked client yet.")}
                  </div>
                )}

                <div className="illustration-preview-action">
                  {selected.documentState === "READY" ? (
                    <a
                      href={`/api/illustrations/${selected.id}/document`}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={copy(
                        "Abrir PDF da ilustração de {name} em nova aba",
                        "Open {name}'s illustration PDF in a new tab",
                        { name: selected.insuredName },
                      )}
                    >
                      {copy("Abrir PDF", "Open PDF")}
                      <svg aria-hidden="true" viewBox="0 0 18 18" fill="none">
                        <path d="M5 13 13 5M7 5h6v6" />
                      </svg>
                    </a>
                  ) : (
                    <IllustrationPdfButton
                      illustrationId={selected.id}
                      disabled={selected.documentState === "WORKING"}
                    />
                  )}
                  {selected.documentMessage ? (
                    <p>{selected.documentMessage}</p>
                  ) : null}
                </div>
              </div>
            ) : null}
          </aside>

          <section className="illustration-results-list" aria-label={copy("Ilustrações encontradas", "Illustrations found")}>
            <header>
              <span>{isLimited ? copy("Cotações mais recentes", "Most recent quotes") : copy("Histórico de cotações", "Quote history")}</span>
              <small>
                {isLimited
                  ? copy("Exibindo as últimas 100. Use a busca para refinar.", "Showing the latest 100. Use search to narrow the results.")
                  : copy("Selecione uma linha para ver o documento.", "Select a row to view the document.")}
              </small>
            </header>
            <ul>
              {pageIllustrations.map((illustration) => (
                <li key={illustration.id} data-illustration-row>
                  <button
                    type="button"
                    data-active={selected?.id === illustration.id || undefined}
                    aria-pressed={selected?.id === illustration.id}
                    aria-label={copy(
                      "Ver cotação de {name}, {date}",
                      "View quote for {name}, {date}",
                      { name: illustration.insuredName, date: illustration.dateLabel },
                    )}
                    onClick={() => setSelectedId(illustration.id)}
                  >
                    <span className="illustration-row-date">
                      {illustration.dateLabel}
                    </span>
                    <span className="illustration-row-person">
                      <strong>{illustration.insuredName}</strong>
                      <small>{illustration.client?.name ?? copy("Prospect", "Prospect")}</small>
                    </span>
                    <span className="illustration-row-product">
                      <strong>{illustration.productName}</strong>
                      <small>{illustration.strategy ?? illustration.insuredDetails}</small>
                    </span>
                    <span className="illustration-row-money">
                      <small>{copy("Prêmio mensal", "Monthly premium")}</small>
                      <strong>{formatMoney(illustration.premium)}</strong>
                    </span>
                    <span
                      className="illustration-row-status"
                      data-state={illustration.documentState}
                    >
                      <i />
                      {documentLabel[illustration.documentState]}
                    </span>
                    <span className="illustration-row-arrow" aria-hidden="true">
                      <svg viewBox="0 0 18 18" fill="none">
                        <path d="M4.5 9h9M10 5.5 13.5 9 10 12.5" />
                      </svg>
                    </span>
                  </button>
                </li>
              ))}
            </ul>

            {pageCount > 1 ? (
              <nav className="illustration-pagination" aria-label={copy("Paginação das ilustrações", "Illustration pagination")}>
                <p>
                  <strong>{pageStart}–{pageEnd}</strong>
                  <span>{copy("de {count}", "of {count}", { count: count.format(filteredIllustrations.length) })}</span>
                </p>
                <div>
                  <button
                    type="button"
                    aria-label={copy("Página anterior", "Previous page")}
                    disabled={currentPage <= 1}
                    onClick={() => changePage(currentPage - 1)}
                  >
                    <svg aria-hidden="true" viewBox="0 0 18 18" fill="none">
                      <path d="m10.5 5.5-3.5 3.5 3.5 3.5" />
                    </svg>
                  </button>
                  {paginationItems(currentPage, pageCount).map((item, index) =>
                    item === "ellipsis" ? (
                      <span key={`ellipsis-${index}`} aria-hidden="true">…</span>
                    ) : (
                      <button
                        key={item}
                        type="button"
                        aria-label={copy("Ir para a página {page}", "Go to page {page}", { page: item })}
                        aria-current={item === currentPage ? "page" : undefined}
                        onClick={() => changePage(item)}
                      >
                        {item}
                      </button>
                    ),
                  )}
                  <button
                    type="button"
                    aria-label={copy("Próxima página", "Next page")}
                    disabled={currentPage >= pageCount}
                    onClick={() => changePage(currentPage + 1)}
                  >
                    <svg aria-hidden="true" viewBox="0 0 18 18" fill="none">
                      <path d="m7.5 5.5 3.5 3.5-3.5 3.5" />
                    </svg>
                  </button>
                </div>
              </nav>
            ) : null}
          </section>
        </div>
      )}

      <aside className="illustration-disclaimer">
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
          <circle cx="10" cy="10" r="7" />
          <path d="M10 8.5v4M10 6.2v.2" />
        </svg>
        <p>
          {copy(
            "Uso interno do agente. A ilustração apoia uma cotação verbal, mas não substitui a proposta aprovada nem deve ser entregue ao cliente.",
            "For agent internal use. The illustration supports a verbal quote, but does not replace the approved application and must not be delivered to the client.",
          )}
        </p>
      </aside>
    </div>
  );
}
