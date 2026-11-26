import type { Metadata } from 'next';
import { WalkPreview } from '../WalkPreview';

export const metadata: Metadata = { title: 'NEXCIV · 咖啡街的一个班次' };

export default async function Page({ searchParams }: { searchParams: Promise<{ activity?: string; connect?: string }> }) {
  const { activity, connect } = await searchParams;
  return <WalkPreview cafeMode connectOnOpen={connect === '1'} requestedActivity={typeof activity === 'string' ? activity : undefined} />;
}
