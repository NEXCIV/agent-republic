import type { Metadata } from 'next';
import { PageHeader } from '@/components/PageHeader';
import { DemoCommands } from './DemoCommands';

export const metadata: Metadata = { title: 'Agent 指令试玩 · NEXCIV CITY' };

export default function DemoPage() {
  return (
    <>
      <PageHeader eyebrow="本机规则模拟 · DEMO" title="Agent 指令试玩"
        back={{ href: '/agent-console', label: 'Agent 工作台' }}
        lede="给 Ada 一条任务，查看每步执行记录与报告。Borealis 会按自己的规则回应。" />
      <DemoCommands />
    </>
  );
}
