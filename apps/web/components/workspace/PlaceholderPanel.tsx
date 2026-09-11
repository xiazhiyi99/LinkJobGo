export function PlaceholderPanel({ title, description }: { title: string; description: string }) {
  return <section className="placeholder-panel"><span className="placeholder-mark">即将开放</span><h2>{title}</h2><p>{description}</p></section>;
}
