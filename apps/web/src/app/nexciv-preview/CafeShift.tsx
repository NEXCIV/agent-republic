'use client';

import { useEffect, useRef, useState } from 'react';
import type { CafeSnapshot } from '../../lib/cafe-life';
import styles from './preview.module.css';

export const phaseLabel = {
  working: '在咖啡摊帮工', inviting: '邀请阿禾聊两句', chatting: '和阿禾聊天',
  walking: '走向街边长椅', resting: '坐下休息', done: '休息结束',
};
const endpoint = '/api/nexciv-preview/cafe';
type Command = { action: 'start'; busy: boolean } | { action: 'note'; suggestion: 'chat' | 'rest' | 'fish' };

export function CafeShift({ onUpdate }: { onUpdate: (data: CafeSnapshot | null) => void }) {
  const [snapshot, setSnapshot] = useState<CafeSnapshot | null>(null);
  const [busy, setBusy] = useState(true);
  const [pending, setPending] = useState(false);
  const [ready, setReady] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const revision = useRef(0);
  const inFlight = useRef(false);
  const retry = useRef<{ command: string; id: string } | null>(null);
  const run = snapshot?.run;
  const active = !!run && run.phase !== 'done';

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function read() {
      const current = revision.current;
      try {
        if (inFlight.current) return;
        const response = await fetch(endpoint, { cache: 'no-store', signal: controller.signal });
        const data = await response.json();
        if (current !== revision.current || controller.signal.aborted) return;
        if (!response.ok) throw new Error(data?.error ?? '班次暂时无法读取。');
        setReady(true);
        setSnapshot(data);
        onUpdate(data);
        setError('');
      } catch (cause) {
        if (!controller.signal.aborted && current === revision.current) setError(cause instanceof Error ? cause.message : '连接中断，正在重试。');
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(read, active ? 900 : 4000);
      }
    }
    void read();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [active, onUpdate]);

  async function send(command: Command) {
    if (inFlight.current) return;
    inFlight.current = true;
    revision.current++;
    setPending(true);
    setError('');
    const key = JSON.stringify(command);
    try {
      const id = retry.current?.command === key ? retry.current.id : crypto.randomUUID();
      retry.current = { command: key, id };
      const response = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...command, requestId: id }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error ?? '操作未送达，请重试。');
      retry.current = null;
      setSnapshot(data);
      setFeedback(data.feedback ?? '');
      onUpdate(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '操作未送达，请重试。');
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }
  return (
    <div className={styles.cafePanel}>
      <div className={styles.controls}>
        {active ? <>
          <span>给 01 号递纸条</span>
          <button disabled={pending || run.phase !== 'working'} onClick={() => send({ action: 'note', suggestion: 'chat' })}>找阿禾聊聊</button>
          <button disabled={pending || run.phase !== 'working'} onClick={() => send({ action: 'note', suggestion: 'rest' })}>早点休息</button>
          <button disabled={pending} onClick={() => send({ action: 'note', suggestion: 'fish' })}>去钓鱼</button>
        </> : <>
          <label>阿禾的班次 <select value={busy ? 'busy' : 'free'} onChange={(event) => setBusy(event.target.value === 'busy')}>
            <option value="busy">正在收摊</option><option value="free">已经下班</option>
          </select></label>
          <button disabled={pending || !ready} onClick={() => send({ action: 'start', busy })}>{run ? '再看一个班次' : '开始观察'}</button>
        </>}
        {run && <span className={styles.energy}>01 号精力 <b>{run.energy}</b> / 100</span>}
      </div>
      {(error || feedback) && <p role="status">{error || feedback}</p>}
      {run && <details className={styles.cafeLog}>
        <summary>{run.events.at(-1)?.text} · 查看经过</summary>
        <ol>{run.events.map((entry, index) => <li key={index}>
          <time>+{Math.round((entry.at - run.events[0]!.at) / 1000)} 秒</time>{entry.text}
        </li>)}</ol>
      </details>}
    </div>
  );
}
