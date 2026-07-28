"use client";

export function Pagination({
  page,
  pageCount,
  onPageChange,
  className = "",
}: {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  className?: string;
}) {
  if (pageCount <= 1) return null;
  return (
    <nav
      aria-label="Paginação"
      className={`mt-4 flex items-center justify-between gap-3 border-t border-border-steel pt-4 ${className}`}
    >
      <button
        type="button"
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-border-steel bg-paper px-4 py-2.5 text-sm font-semibold text-ink transition-[border-color,background-color,transform] duration-300 hover:-translate-y-0.5 hover:border-teal hover:bg-panel focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-teal-pale disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 disabled:hover:border-border-steel"
      >
        <span aria-hidden>←</span> Anterior
      </button>
      <span className="font-mono text-xs text-ink-muted">
        Página {page} de {pageCount}
      </span>
      <button
        type="button"
        onClick={() => onPageChange(page + 1)}
        disabled={page >= pageCount}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-border-steel bg-paper px-4 py-2.5 text-sm font-semibold text-ink transition-[border-color,background-color,transform] duration-300 hover:-translate-y-0.5 hover:border-teal hover:bg-panel focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-teal-pale disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 disabled:hover:border-border-steel"
      >
        Próxima <span aria-hidden>→</span>
      </button>
    </nav>
  );
}

/** ponytail: clamps a page number into [1, pageCount] range that may itself be 0 (empty list). */
export function clampPage(page: number, pageCount: number): number {
  return Math.min(Math.max(1, page), Math.max(1, pageCount));
}
