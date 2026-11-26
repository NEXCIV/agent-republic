import type { Metadata } from 'next';
import { SharedCity } from './SharedCity';

export const metadata: Metadata = { title: 'NEXCIV · 双 Agent 共享城市' };

export default function Page() { return <SharedCity />; }
