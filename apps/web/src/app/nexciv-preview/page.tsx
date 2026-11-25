import type { Metadata } from 'next';
import { WalkPreview } from './WalkPreview';

export const metadata: Metadata = {
  title: 'NEXCIV · 街区观察',
  description: '观察 Agent 从 Nexus 中央广场步行到 Corner Market。',
  icons: { icon: '/nexciv-walk/icon.png' },
};

export default function Page() {
  return <WalkPreview />;
}
