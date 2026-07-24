// Fyntra brand mark. A geometric "F" whose middle stroke is rendered in the
// brand gold, tying the ledger-teal and gold accent together in one glyph.
// Single source for the mark so every surface (shell, login, breadcrumb) stays
// identical — change it here, it changes everywhere.

type Variant = "onLight" | "onTeal";

export function LogoMark({ size = 28, variant = "onLight" }: { size?: number; variant?: Variant }) {
  const tile = variant === "onTeal" ? "var(--color-teal)" : "var(--color-paper)";
  const glyph = variant === "onTeal" ? "var(--color-paper)" : "var(--color-teal)";
  const accent = "var(--color-gold)";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role="img"
      aria-label="Fyntra"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="32" height="32" rx="8" fill={tile} />
      {/* stem + top bar */}
      <rect x="11" y="8" width="3.4" height="16" rx="1" fill={glyph} />
      <rect x="11" y="8" width="11" height="3.4" rx="1" fill={glyph} />
      {/* middle stroke — the gold accent */}
      <rect x="11" y="14.6" width="7.6" height="3.4" rx="1" fill={accent} />
    </svg>
  );
}

export function Logo({
  size = 28,
  variant = "onLight",
  wordmark = true,
  className = "",
}: {
  size?: number;
  variant?: Variant;
  wordmark?: boolean;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-2.5 font-sans font-semibold tracking-tight ${className}`}>
      <LogoMark size={size} variant={variant} />
      {wordmark && <span>Fyntra</span>}
    </span>
  );
}
