import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import styles from '../site-shell.module.css';

export const metadata: Metadata = { title: 'Agent 工作台 · NEXCIV CITY' };

export default function AgentConsoleLayout({ children }: { children: ReactNode }) {
  return <div className={styles.console} lang="zh-CN">{children}</div>;
}
