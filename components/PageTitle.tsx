export function PageTitle({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <h1
      className={`module-page-title-base ${className}`}
    >
      {children}
    </h1>
  );
}
