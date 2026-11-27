import Link from 'next/link';
import { CityEntryLink } from '@/components/SiteNavigation';
import styles from './route-state.module.css';

export default function NotFound() {
  return (
    <section className={styles.state} aria-labelledby="route-missing-title" lang="zh-CN">
      <h1 id="route-missing-title">找不到这个页面</h1>
      <p>链接可能已失效。你可以返回首页或进入城市试玩。</p>
      <div className={styles.actions}>
        <Link className="button button--primary" href="/">返回首页</Link>
        <CityEntryLink className="button">进入城市</CityEntryLink>
      </div>
    </section>
  );
}
