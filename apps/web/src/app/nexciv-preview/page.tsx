import type { Metadata } from 'next';
import { WalkPreview } from './WalkPreview';

export const metadata: Metadata = {
  title: 'NEXCIV · 街区观察',
  description: '观察 NEXCIV 的 Agent 从 Nexus 中央广场前往 Corner Market 和议会大厅。',
  icons: { icon: '/nexciv-walk/icon.png' },
};

export default function Page() {
  return <WalkPreview />;
}
