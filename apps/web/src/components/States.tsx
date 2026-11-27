export function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty">
      <p><strong>{title}</strong></p>
      <p>{detail}</p>
    </div>
  );
}

export function Unavailable({ resource }: { resource: string }) {
  return (
    <div className="error-banner" role="status">
      {resource} is temporarily unavailable.
    </div>
  );
}
