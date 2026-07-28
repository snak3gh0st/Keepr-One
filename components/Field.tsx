import { InputHTMLAttributes, SelectHTMLAttributes } from "react";

const inputClass =
  "min-h-11 rounded-xl border border-border-steel bg-paper px-3.5 py-2.5 text-sm text-ink outline-none transition-[border-color,box-shadow,background-color] duration-300 hover:border-ink-muted focus-visible:border-teal focus-visible:ring-[3px] focus-visible:ring-teal-pale disabled:cursor-not-allowed disabled:bg-panel disabled:text-ink-muted";

export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
        {label}
      </span>
      {children}
    </label>
  );
}

export function Input({
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${inputClass} ${className}`} {...props} />;
}

export function Select({
  className = "",
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`${inputClass} ${className}`} {...props} />;
}
