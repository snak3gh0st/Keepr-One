export function ContextPanel({
  eyebrow,
  title,
  children,
  as = "aside",
}: {
  eyebrow?: string
  title: string
  children: React.ReactNode
  as?: "aside" | "section" | "div"
}) {
  const Component = as

  return (
    <Component
      className="module-context-panel keepr-noise"
      aria-label={as === "aside" ? title : undefined}
    >
      <div className="module-context-heading">
        {eyebrow && <p>{eyebrow}</p>}
        <h2>{title}</h2>
      </div>
      <div className="module-context-body">{children}</div>
      <div className="module-context-status" aria-hidden="true">
        <span>
          <i />
          Operação conectada
        </span>
        <b>keepr one</b>
      </div>
    </Component>
  );
}
