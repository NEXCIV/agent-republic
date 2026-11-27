import styles from './route-state.module.css';

export default function Loading() {
  return (
    <div className={styles.pending} role="status" lang="zh-CN">
      <span className={styles.indicator} aria-hidden="true" />
      正在打开页面…
    </div>
  );
}
