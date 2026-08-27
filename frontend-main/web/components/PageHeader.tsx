/** One heading shape for every screen, so pages open the same way. */
export function PageHeader({
  title, sub, children,
}: {
  title: string; sub?: React.ReactNode; children?: React.ReactNode;
}) {
  return (
    <div className="bx-rise flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">{title}</h1>
        {sub && <p className="mt-1 text-sm text-ink-3">{sub}</p>}
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  );
}
