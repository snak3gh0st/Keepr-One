import {
  InputHTMLAttributes,
  SelectHTMLAttributes,
  type ReactNode,
} from "react";

const inputClass =
  "min-h-11 rounded-xl border border-border-steel bg-paper px-3.5 py-2.5 text-sm text-ink outline-none transition-[border-color,box-shadow,background-color] duration-300 hover:border-ink-muted focus-visible:border-teal focus-visible:ring-[3px] focus-visible:ring-teal-pale disabled:cursor-not-allowed disabled:bg-panel disabled:text-ink-muted";

export function Field({
  label,
  children,
  htmlFor,
  hint,
  error,
  required = false,
}: {
  label: ReactNode;
  children: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
}) {
  const labelContent = (
    <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
      {label}
      {required ? (
        <span aria-hidden="true" className="ml-1 text-danger">*</span>
      ) : null}
    </span>
  );
  const feedback = hint || error ? (
    <>
      {hint ? (
        <p id={htmlFor ? `${htmlFor}-hint` : undefined} className="text-xs leading-5 text-ink-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={htmlFor ? `${htmlFor}-error` : undefined} role="alert" className="text-xs leading-5 text-danger">
          {error}
        </p>
      ) : null}
    </>
  ) : null;

  if (htmlFor) {
    return (
      <div className="flex flex-col gap-2">
        <label htmlFor={htmlFor}>{labelContent}</label>
        {children}
        {feedback}
      </div>
    );
  }

  return (
    <label className="flex flex-col gap-2">
      {labelContent}
      {children}
      {feedback}
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
