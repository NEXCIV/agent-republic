'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useContext, type ReactNode } from 'react';
import { CITY_PREVIEW, CITY_GUIDE, CITY_NEWS, CITY_LEDGER } from '@/lib/site-routes';
import { CityMark } from './CityMark';
import styles from './site-navigation.module.css';

type Destinations = { city: string; join: string | null };
const CityNavigation = createContext<Destinations>({ city: CITY_PREVIEW, join: null });
const useCityNavigation = () => useContext(CityNavigation);

export function SiteNavigationProvider({ destinations, children }: { destinations: Destinations; children: ReactNode }) {
  return <CityNavigation.Provider value={destinations}>{children}</CityNavigation.Provider>;
}

export function CityEntryLink({ children, className }: { children: ReactNode; className?: string }) {
  const { city } = useCityNavigation();
  return <Link href={city} className={className} prefetch={false}>{children}</Link>;
}

const ledger = [
  ['公共工程', CITY_LEDGER],
  ['议会', '/council'],
  ['链上记录', '/activity'],
  ['公民身份', '/identity'],
  ['链上世界', '/world'],
  ['Agent 工作台', '/agent-console'],
] as const;

function within(pathname: string, route: string) {
  return pathname === route || pathname.startsWith(route + '/');
}

export function SiteHeader({ className, controls, back }: { className?: string; controls?: ReactNode; back?: string }) {
  const pathname = usePathname();
  const { city, join } = useCityNavigation();
  const current = within(pathname, CITY_NEWS) ? 'news' : within(pathname, CITY_GUIDE) ? 'guide'
    : within(pathname, CITY_PREVIEW) ? 'city'
      : ledger.some(([, href]) => within(pathname, href)) || within(pathname, '/tx') ? 'ledger' : null;

  return (
    <header className={className ? `${styles.header} ${className}` : styles.header} lang="zh-CN" data-site-header>
      <Link href="/" className={styles.brand} aria-label="NEXCIV CITY 首页" aria-current={pathname === '/' ? 'page' : undefined}>
        <CityMark /><span>NEXCIV <b>CITY</b></span>
      </Link>
      {back ? <Link className={styles.back} href={back} prefetch={false}>返回城市</Link> : (
        <nav className={styles.primary} aria-label="主导航">
          <Link href={city} prefetch={false} aria-current={current === 'city' ? pathname === city ? 'page' : 'location' : undefined}>城市</Link>
          <Link href={CITY_NEWS} prefetch={false} aria-current={current === 'news' ? 'page' : undefined}>城邦早报</Link>
          <Link href={CITY_LEDGER} aria-current={current === 'ledger' ? pathname === CITY_LEDGER ? 'page' : 'location' : undefined}>公共账本</Link>
          <Link href={CITY_GUIDE} aria-current={current === 'guide' ? 'page' : undefined}>试玩指南</Link>
          {join && <Link className={styles.join} href={join} prefetch={false}>角色与接入</Link>}
        </nav>
      )}
      {controls && <div className={styles.controls}>{controls}</div>}
    </header>
  );
}

export function SiteChrome() {
  const pathname = usePathname();
  if (pathname === '/' || within(pathname, CITY_PREVIEW)) return null;
  const onLedger = ledger.some(([, href]) => within(pathname, href)) || within(pathname, '/tx');
  return <>
    <SiteHeader />
    {onLedger && <nav className={styles.ledger} aria-label="公共账本导航" lang="zh-CN">
      {ledger.map(([label, href]) => <Link key={href} href={href}
        aria-current={pathname === href ? 'page' : within(pathname, href) || (href === '/activity' && within(pathname, '/tx')) ? 'location' : undefined}>{label}</Link>)}
    </nav>}
  </>;
}
