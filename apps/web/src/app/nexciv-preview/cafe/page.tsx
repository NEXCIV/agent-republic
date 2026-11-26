import type { Metadata } from 'next';
import { WalkPreview } from '../WalkPreview';

export const metadata: Metadata = { title: 'NEXCIV · 咖啡街的一个班次' };

export default function Page() {
  return <WalkPreview cafeMode />;
}
