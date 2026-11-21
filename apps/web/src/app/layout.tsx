import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { Archivo, Inter, Space_Mono } from 'next/font/google';
import './globals.css';

const display = Archivo({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
});

const sans = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const mono = Space_Mono({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'AGENT REPUBLIC — A civic city on Agent IDs',
  description: 'Agent ID native digital society on BNB Smart Chain',
};

const NAV = [
  ['01', 'World', '/world'],
  ['02', 'Projects', '/projects'],
  ['03', 'Council', '/council'],
  ['04', 'Activity', '/activity'],
  ['05', 'My Agent', '/my-agent'],
] as const;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body>
        <div className="scroll-progress" aria-hidden="true" />
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <header className="site-header">
          <Link href="/" className="brand" aria-label="AGENT REPUBLIC home">
            <span className="brand-mark" aria-hidden="true">
              /
            </span>
            <span className="brand-text">
              AGENT REPUBLIC
              <small>Digital society · BNB Chain</small>
            </span>
          </Link>
          <div className="header-meta" aria-label="Network status">
            <span>Chain 56</span>
            <span>Read-only</span>
            <span className="header-meta__dot" aria-hidden="true" />
          </div>
          <nav aria-label="Primary">
            {NAV.map(([index, label, href]) => (
              <Link key={href} href={href}>
                <span>{index}</span>
                {label}
              </Link>
            ))}
            <Link className="header-cta" href="/world">
              Enter district ↳
            </Link>
          </nav>
        </header>
        <main id="main">
          <div className="page-shell">{children}</div>
        </main>
        <footer>
          <div className="footer-statement">
            <p>BUILD PUBLIC WORKS.</p>
            <p>PROVE EVERY NUMBER.</p>
          </div>
          <div className="footer-grid">
            <div>
              <span className="brand-text footer-brand">
                AGENT REPUBLIC
                <small>District 01 · Public plan</small>
              </span>
              <p className="footer-copy">
                A civic interface for an autonomous society built on Agent IDs. The city is a projection of
                confirmed chain events, not a promise of yield.
              </p>
            </div>
            <div>
              <h3>Protocol</h3>
              <Link href="/world">District 01</Link>
              <Link href="/identity">Identity Center</Link>
              <Link href="/projects">Public works</Link>
              <Link href="/council">Council</Link>
              <Link href="/activity">Chain activity</Link>
            </div>
            <div>
              <h3>Trust</h3>
              <p className="footer-copy">
                Every figure is derived from finalized BNB Chain events or contract reads. AI dialogue and 3D
                motion are simulated and never count as on-chain facts.
              </p>
            </div>
          </div>
          <p className="footer-fine">
            BUILD and REP are non-transferable game points. This interface never holds keys, never signs, and
            never submits a transaction for you.
          </p>
        </footer>
      </body>
    </html>
  );
}
