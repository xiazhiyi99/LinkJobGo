export function OverviewCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return <article className="overview-card"><span>{label}</span><strong>{value}</strong><small>{hint}</small></article>;
}
