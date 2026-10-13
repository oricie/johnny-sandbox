export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header style={{ marginBottom: 16 }}>
      <h1 style={{ margin: 0, fontSize: 22 }}>{title}</h1>
      {subtitle && <p style={{ margin: "4px 0 0", color: "var(--color-text-muted)" }}>{subtitle}</p>}
    </header>
  );
}
