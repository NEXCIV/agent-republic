/**
 * Route-level loading state. Text only — no skeleton numbers that could be
 * mistaken for data before the real ledger arrives.
 */
export default function Loading() {
  return (
    <div className="panel" role="status" aria-live="polite">
      <p className="hint" style={{ margin: 0 }}>
        Reading confirmed chain data…
      </p>
    </div>
  );
}
