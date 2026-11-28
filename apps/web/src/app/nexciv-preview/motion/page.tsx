import type { Metadata } from 'next';
import MotionPreview from './MotionPreview';

export const metadata: Metadata = { title: 'NEXCIV · 角色动作对照' };

export default function Page() {
  return <MotionPreview />;
}
