type SummaryTone = "neutral" | "green" | "gold" | "danger";

type SummaryItem = {
  label: string;
  value: React.ReactNode;
  detail: string;
  tone?: SummaryTone;
  compact?: boolean;
};

export function ModuleSummary({
  items,
  label = "Resumo do módulo",
}: {
  items: SummaryItem[];
  label?: string;
}) {
  const countClass =
    items.length === 4
      ? "module-summary--four"
      : items.length === 2
        ? "module-summary--two"
        : items.length === 1
          ? "module-summary--one"
          : "module-summary--three";

  return (
    <section className={`module-summary ${countClass}`} aria-label={label}>
      {items.map((item) => (
        <div
          key={item.label}
          className="module-summary-card"
          data-tone={item.tone ?? "neutral"}
          data-compact={item.compact || undefined}
        >
          <div>
            <span>{item.label}</span>
            <p>{item.detail}</p>
          </div>
          <strong>{item.value}</strong>
        </div>
      ))}
    </section>
  );
}
