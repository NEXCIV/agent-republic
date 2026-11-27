import type { ReactNode } from 'react';
import Link from 'next/link';
import styles from './page-header.module.css';
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
    <header className={styles.header}>
      {back ? (
        <Link className={styles.back} href={back.href}>
          ← {back.label}
        </Link>
      ) : null}
      <h1 className={styles.title}>{title}</h1>
      {lede ? <p className={styles.description}>{lede}</p> : null}
      {children ? <div className={styles.actions}>{children}</div> : null}
      {meta.length > 0 ? (
        <div className={styles.meta}>
          <span>{eyebrow}</span>
          {meta.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
      ) : <p className={styles.meta}>{eyebrow}</p>}
    </header>
  );
}
