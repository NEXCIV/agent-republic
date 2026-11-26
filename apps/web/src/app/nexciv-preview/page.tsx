import type { Metadata } from 'next';
import { WalkPreview } from './WalkPreview';

export const metadata: Metadata = {
  title: 'NEXCIV · 城市试玩',
  description: '进入 NEXCIV，查看城市地标与居民，跟随 Agent 在街区中活动。',
  icons: { icon: '/nexciv-walk/icon.png' },
};

export default function Page() {
  return <WalkPreview />;
}
