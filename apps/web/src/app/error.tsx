'use client';

import Link from 'next/link';
import styles from './route-state.module.css';

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <section className={styles.state} aria-labelledby="route-error-title" lang="zh-CN">
      <h1 id="route-error-title">页面加载失败</h1>
      <p>请重试，或返回 NEXCIV 首页。</p>
      <div className={styles.actions}>
        <button className="primary" type="button" onClick={reset}>
          重新加载
        </button>
        <Link className="button" href="/">返回首页</Link>
      </div>
    </section>
  );
}
