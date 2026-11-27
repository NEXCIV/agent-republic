import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Archivo, Inter, Space_Mono } from 'next/font/google';
import path from 'node:path';
import { SiteNavigationProvider, SiteChrome } from '@/components/SiteNavigation';
import { SHARED_PILOT_SECRET } from '@/lib/shared-pilot-profiles';
import { CITY_PREVIEW, JOIN_CITY, SHARED_CITY } from '@/lib/site-routes';
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

export default function RootLayout({ children }: { children: ReactNode }) {
  const file = process.env.NEXCIV_SHARED_PILOT_DB;
  const keys = [process.env.NEXCIV_SHARED_AGENT_01_KEY, process.env.NEXCIV_SHARED_AGENT_02_KEY || process.env.NEXCIV_SHARED_AGENT_KEY]
    .filter((key): key is string => Boolean(key));
  const shared = process.env.NODE_ENV !== 'production' && file && path.isAbsolute(file)
    && path.extname(file).toLowerCase() === '.sqlite' && keys.every((key) => SHARED_PILOT_SECRET.test(key))
    && new Set(keys).size === keys.length;
  const navigation = { city: shared ? SHARED_CITY : CITY_PREVIEW, join: shared && keys.length < 2 ? JOIN_CITY : null };
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <SiteNavigationProvider destinations={navigation}>
          <SiteChrome />
          <main id="main" className={styles.main}>
            <div className="page-shell">{children}</div>
          </main>
        </SiteNavigationProvider>
      </body>
    </html>
  );
}
