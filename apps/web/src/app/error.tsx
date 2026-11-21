'use client';

import { PageHeader } from '@/components/PageHeader';

/**
 * Route-level error boundary. Kept honest: the error is surfaced, never
 * masked by placeholder data (AGENTS.md §4).
 */
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <>
      <PageHeader
        eyebrow="Error · Unexpected"
        title={
          <>
            Something <em>broke</em>
          </>
        }
        lede="This page failed to render. Nothing was invented to fill the gap — retry, or go back to a confirmed view."
        meta={['Chain 56 / Read-only']}
      />
      <div className="panel">
        <button className="primary" type="button" onClick={reset}>
          Retry
        </button>
      </div>
    </>
  );
}
