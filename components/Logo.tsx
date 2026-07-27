type Variant = "onLight" | "onTeal";

export function LogoMark({ size = 28, variant = "onLight" }: { size?: number; variant?: Variant }) {
  const green = variant === "onTeal" ? "var(--color-paper)" : "#42c77d";
  const greenShade = variant === "onTeal" ? "rgba(255,255,255,0.72)" : "#237f5a";
  const lowerArm = variant === "onTeal" ? "var(--color-rail-strong)" : "#ffffff";

  return (
    <svg
      width={size}
      height={size}
      viewBox="8 6 84 86"
      aria-hidden
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="shrink-0 overflow-visible drop-shadow-[0_0_8px_rgba(66,199,125,0.24)]"
    >
      <path
        d="M13 13.5C13 11.01 15.01 9 17.5 9H44L13 58V13.5Z"
        fill={green}
        stroke={greenShade}
        strokeWidth="0.7"
      />
      <path
        d="M13 64.5L60.5 9H88L13 86V64.5Z"
        fill={green}
        stroke={greenShade}
        strokeWidth="0.7"
      />
      <path
        d="M47.5 66L61.5 52L89 88H61L47.5 66Z"
        fill={lowerArm}
        stroke="rgba(8, 20, 14, 0.2)"
        strokeWidth="0.7"
      />
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
    <span
      role="img"
      aria-label="Keepr One"
      className={`inline-flex items-center gap-2 font-brand font-medium tracking-[-0.045em] ${className}`}
    >
      <LogoMark size={size} variant={variant} />
      {wordmark && (
        <span aria-hidden className="inline-flex items-baseline gap-[0.22em] leading-none">
          <span className="font-bold text-current">keepr</span>
          <span className="font-medium text-[#42c77d]">one</span>
        </span>
      )}
    </span>
  );
}
