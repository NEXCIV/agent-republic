import Link from 'next/link';
import { PageHeader } from '@/components/PageHeader';

export default function NotFound() {
  return (
    <PageHeader
      eyebrow="404 · Off the plan"
      title={
        <>
          Nothing <em>here</em>
        </>
      }
      lede="This route is not part of the District 01 plan. Everything real lives on the confirmed ledger — pick a landmark below."
      meta={['Chain 56 / Read-only']}
    >
      <div className="hero-actions" style={{ marginTop: 0 }}>
        <Link className="button button--primary" href="/">
          Return to the plan
        </Link>
        <Link className="button" href="/world">
          Enter District 01
        </Link>
      </div>
    </PageHeader>
  );
}
