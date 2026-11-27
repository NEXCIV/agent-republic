import type { ReactNode } from 'react';

export default function PreviewLayout({ children }: { children: ReactNode }) {
  return <div data-fullscreen-shell lang="zh-CN">{children}</div>;
}
