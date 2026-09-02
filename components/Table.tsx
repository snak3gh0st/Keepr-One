"use client";

import { TdHTMLAttributes, ThHTMLAttributes } from "react";
import { motion, useReducedMotion } from "motion/react";
import { useI18n } from "@/components/i18n/LanguageProvider";

export function Table({
  children,
  label,
}: {
  children: React.ReactNode;
  label?: string;
}) {
  const { copy } = useI18n();
  const accessibleLabel = label ?? copy("Tabela de dados", "Data table");

  return (
    <div
      className="module-table-shell"
      role="region"
      aria-label={accessibleLabel}
      tabIndex={0}
    >
      <table>
        <caption className="sr-only">{accessibleLabel}</caption>
        {children}
      </table>
    </div>
  );
}

export function Thead({ children }: { children: React.ReactNode }) {
  return <thead>{children}</thead>;
}

export function Th({
  className = "",
  ...props
}: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={`module-table-heading ${className}`}
      {...props}
    />
  );
}

export function ThSort({
  className = "",
  active = false,
  direction = "desc",
  numeric = false,
  onClick,
  children,
  ...props
}: ThHTMLAttributes<HTMLTableCellElement> & {
  active?: boolean;
  direction?: "asc" | "desc";
  numeric?: boolean;
  onClick?: () => void;
}) {
  return (
    <th
      className={`module-table-sort-heading ${active ? "is-active" : ""} ${className}`}
      aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}
      {...props}
    >
      <button
        type="button"
        onClick={onClick}
        className={`module-table-sort ${numeric ? "justify-end" : "justify-start text-left"}`}
      >
        {numeric && (
          <span aria-hidden className={`text-[9px] transition-opacity ${active ? "opacity-100" : "opacity-0"}`}>
            {direction === "asc" ? "▲" : "▼"}
          </span>
        )}
        {children}
        {!numeric && (
          <span aria-hidden className={`text-[9px] transition-opacity ${active ? "opacity-100" : "opacity-0"}`}>
            {direction === "asc" ? "▲" : "▼"}
          </span>
        )}
      </button>
    </th>
  );
}

export function Tr({
  className = "",
  index = 0,
  children,
}: {
  className?: string;
  index?: number;
  children: React.ReactNode;
}) {
  const reducedMotion = useReducedMotion() ?? false;
  return (
    <motion.tr
      initial={reducedMotion ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reducedMotion ? { duration: 0 } : { duration: 0.2, delay: Math.min(index, 30) * 0.015, ease: "easeOut" }}
      className={`module-table-row ${className}`}
    >
      {children}
    </motion.tr>
  );
}

export function Td({
  className = "",
  ...props
}: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={`module-table-cell ${className}`}
      {...props}
    />
  );
}

export function TdNum({
  className = "",
  ...props
}: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <Td
      className={`text-right font-mono font-medium tabular-nums ${className}`}
      {...props}
    />
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="module-empty-state">
      <span aria-hidden>
        <i />
        <i />
        <i />
      </span>
      <p>{children}</p>
    </div>
  );
}
