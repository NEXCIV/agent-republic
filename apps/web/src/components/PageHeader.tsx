import type { ReactNode } from 'react';
import Link from 'next/link';

/**
 * Shared header band for inner pages — a compact echo of the homepage hero
 * (dark ground, eyebrow, display title, lede, meta strip) so every route
 * lands on the same visual language.
 */
export function PageHeader({
  eyebrow,
  title,
  lede,
  meta = [],
  back,
  children,
}: {
  eyebrow: string;
  title: ReactNode;
  lede?: ReactNode;
  meta?: readonly string[];
  back?: { href: string; label: string };
  children?: ReactNode;
}) {
  return (
    <header className="page-hero">
      {back ? (
        <Link className="page-hero__back" href={back.href}>
          ← {back.label}
        </Link>
      ) : null}
      <p className="eyebrow">{eyebrow}</p>
      <h1 className="page-hero__title">{title}</h1>
      {lede ? <p className="lede">{lede}</p> : null}
      {children ? <div className="page-hero__children">{children}</div> : null}
      {meta.length > 0 ? (
        <div className="page-hero__meta">
          {meta.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
      ) : null}
    </header>
  );
}
