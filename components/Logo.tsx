type Variant = "onLight" | "onTeal";
export type LogoTone = "default" | "blue" | "red" | "green" | "purple" | "black";

const LOGO_TONES: Record<Exclude<LogoTone, "default">, {
  accent: string;
  shade: string;
  glow: string;
}> = {
  blue: {
    accent: "#56aaf0",
    shade: "#a8d7fa",
    glow: "rgba(86, 170, 240, 0.28)",
  },
  red: {
    accent: "#ff746c",
    shade: "#ffc1bd",
    glow: "rgba(255, 116, 108, 0.26)",
  },
  green: {
    accent: "#55d789",
    shade: "#b8f1cd",
    glow: "rgba(85, 215, 137, 0.26)",
  },
  purple: {
    accent: "#b48bed",
    shade: "#dcc5fa",
    glow: "rgba(180, 139, 237, 0.28)",
  },
  black: {
    accent: "#edf3ef",
    shade: "#9ba69f",
    glow: "rgba(237, 243, 239, 0.22)",
  },
};

export function LogoMark({
  size = 28,
  variant = "onLight",
  tone = "default",
}: {
  size?: number;
  variant?: Variant;
  tone?: LogoTone;
}) {
  const palette = tone === "default" ? null : LOGO_TONES[tone];
  const green = palette?.accent ?? (variant === "onTeal" ? "var(--color-paper)" : "#42c77d");
  const greenShade = palette?.shade ?? (variant === "onTeal" ? "rgba(255,255,255,0.72)" : "#237f5a");
  const glow = palette?.glow ?? "rgba(66, 199, 125, 0.24)";
  const lowerArm = variant === "onTeal" ? "var(--color-rail-strong)" : "#ffffff";

  return (
    <svg
      data-logo-mark
      width={size}
      height={size}
      viewBox="8 6 84 86"
      aria-hidden
      data-logo-tone={tone}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="shrink-0 overflow-visible"
      style={{ filter: `drop-shadow(0 0 8px ${glow})` }}
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
  tone = "default",
  wordmark = true,
  className = "",
}: {
  size?: number;
  variant?: Variant;
  tone?: LogoTone;
  wordmark?: boolean;
  className?: string;
}) {
  const wordmarkAccent = tone === "default" ? "#42c77d" : LOGO_TONES[tone].accent;

  return (
    <span
      data-logo-root
      data-logo-tone={tone}
      data-logo-variant={variant}
      role="img"
      aria-label="Keepr One"
      className={`inline-flex items-center gap-2 font-brand font-medium tracking-[-0.045em] ${className}`}
    >
      <LogoMark size={size} variant={variant} tone={tone} />
      {wordmark && (
        <span
          aria-hidden
          className="inline-flex items-baseline gap-[0.22em] leading-none"
          data-logo-wordmark
        >
          <span className="font-bold text-current">keepr</span>
          <span className="font-medium" style={{ color: wordmarkAccent }}>one</span>
        </span>
      )}
    </span>
  );
}
