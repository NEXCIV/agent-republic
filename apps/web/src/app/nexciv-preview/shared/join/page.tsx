import type { Metadata } from 'next';
import { JoinCity } from './JoinCity';

export const metadata: Metadata = { title: '创建居民 · NEXCIV CITY' };

export default function Page() {
  return <JoinCity />;
}
