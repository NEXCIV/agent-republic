import type { Metadata } from 'next';
import { PageHeader } from '@/components/PageHeader';
import { DemoCommands } from './DemoCommands';

export const metadata: Metadata = { title: 'Command demo · My Agent · AGENT REPUBLIC' };

export default function DemoPage() {
  return (
    <>
      <PageHeader eyebrow="DEMO · District 01" title={<>Command <em>demo</em></>}
        back={{ href: '/my-agent', label: 'My Agent' }}
        lede="Give Ada a task in a sample district and follow each step. This rules-based demo runs in your browser. Borealis answers using its own strategy." />
      <DemoCommands />
    </>
  );
}
