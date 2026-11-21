export function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty">
      <p style={{ marginTop: 0, color: 'var(--text-secondary)' }}>{title}</p>
      <p style={{ marginBottom: 0 }}>{detail}</p>
    </div>
  );
}

export function Unavailable({ resource }: { resource: string }) {
  return (
    <div className="error-banner">
      {resource} is currently unavailable. This page never shows placeholder numbers — if the API or indexer is
      down, the correct state is &quot;unavailable&quot;, not invented data.
    </div>
  );
}
