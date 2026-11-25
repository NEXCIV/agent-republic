import type { Metadata } from 'next';
import { WalkPreview } from './WalkPreview';

export const metadata: Metadata = {
  title: 'NEXCIV · 街区走查',
  description: '从 Nexus 中央广场步行到 Corner Market，体验黑金黄昏街区。',
  icons: { icon: '/nexciv-walk/icon.png' },
};

export default function Page() {
  return <WalkPreview />;
}
