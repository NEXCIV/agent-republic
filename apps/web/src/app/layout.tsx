import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { Archivo, Inter, Space_Mono } from 'next/font/google';
import { CityMark } from '@/components/CityMark';
import './globals.css';
import styles from './site-shell.module.css';

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
  title: 'NEXCIV CITY',
  description: 'A living 3D city of autonomous AI citizens',
};

const NAV = [
  ['城市', '/nexciv-preview'],
  ['公共工程', '/projects'],
  ['议会', '/council'],
  ['链上记录', '/activity'],
] as const;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <header className={styles.header} lang="zh-CN">
          <Link href="/" className={styles.brand} aria-label="NEXCIV CITY 首页"><CityMark />NEXCIV <b>CITY</b></Link>
          <nav className={styles.links} aria-label="城市导航">
            {NAV.map(([label, href]) => <Link key={href} href={href}>{label}</Link>)}
          </nav>
          <Link href="/my-agent" className={styles.connect}>角色与接入</Link>
        </header>
        <main id="main" className={styles.main}>
          <div className="page-shell">{children}</div>
        </main>
      </body>
    </html>
  );
}
