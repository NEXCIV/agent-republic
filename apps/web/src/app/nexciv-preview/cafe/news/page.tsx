import type { Metadata } from 'next';
import { CafeNewspaper } from './CafeNewspaper';

export const metadata: Metadata = { title: 'NEXCIV · 城邦早报' };

export default async function Page({ searchParams }: { searchParams: Promise<{ issue?: string }> }) {
  const { issue } = await searchParams;
  return <CafeNewspaper requestedIssue={typeof issue === 'string' ? issue : undefined} />;
}
