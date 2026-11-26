'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { CafeShiftKind, CafeSnapshot, CafeSuggestion, CafeView } from '../../lib/cafe-life';
import type { CafePostcard } from '../../lib/cafe-postcard';
import { OBSERVER_QUESTIONS, OBSERVER_SPEAKERS, OBSERVER_TOPIC } from '../../lib/cafe-observer';
import styles from './preview.module.css';

export const phaseLabel = {
  working: '在咖啡摊帮工', inviting: '邀请阿禾聊两句', chatting: '和阿禾聊天',
  reconnecting: '阿禾认出了 01 号',
  walking: '走向街边长椅', resting: '坐下休息', done: '休息结束',
  toPier: '前往北岸码头 · 行程快进', casting: '在北岸码头抛竿', fishing: '等鱼咬钩', reeling: '收线起竿',
  briefing: '准备采访', waitingForAhe: '等阿禾收摊', interviewing: '正在采访', toCounter: '返回咖啡摊 · 行程快进',
};
export function shiftLabel(run: CafeView) {
  if (run.phase === 'briefing' && run.observer?.driver === 'external') return '等待外部 Agent 决定';
  if (run.observer && run.phase === 'done') return '采访已完成';
  if (run.phase === 'interviewing') return run.place === 'pier' ? '采访码头常客' : '采访阿禾';
  if (run.phase === 'done' && run.fishResult) return run.fishResult === 'released' ? '钓到小鱼，已放回湖里' : '这一竿没钓到鱼';
  return phaseLabel[run.phase];
}
const endpoint = '/api/nexciv-preview/cafe';
const seenKey = 'nexciv-cafe-seen-at';
type Command = { action: 'start'; busy: boolean; kind: CafeShiftKind } | { action: 'note'; suggestion: CafeSuggestion };

function savedCheckpoint() {
  try {
    const value = window.localStorage.getItem(seenKey);
    return value && /^\d{1,15}$/.test(value) ? Number(value) : undefined;
  } catch { return undefined; }
}

function markShown(data: CafeSnapshot | null) {
  if (document.visibilityState !== 'visible') return;
  try {
    if (!data) window.localStorage.removeItem(seenKey);
    else if (data.serverTime > (savedCheckpoint() ?? 0)) window.localStorage.setItem(seenKey, String(data.serverTime));
  } catch { /* The active shift is still readable with browser storage disabled. */ }
}

export function CafeShift({ onUpdate }: { onUpdate: (data: CafeSnapshot | null) => void }) {
  const [snapshot, setSnapshot] = useState<CafeSnapshot | null>(null);
  const [busy, setBusy] = useState(true);
  const [kind, setKind] = useState<CafeShiftKind>('cafe');
  const [pending, setPending] = useState(false);
  const [ready, setReady] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const [postcard, setPostcard] = useState<CafePostcard | null>(null);
  const onReturn = useRef(true);
  const activity = useRef<HTMLDetailsElement>(null);
  const revision = useRef(0);
  const inFlight = useRef(false);
  const retry = useRef<{ command: string; id: string } | null>(null);
  const run = snapshot?.run;
  const active = !!run && run.phase !== 'done';

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let reading = false;
    let visibilityVersion = 0;
    async function read() {
      if (reading || document.visibilityState !== 'visible') return;
      reading = true;
      const current = revision.current;
      const visibility = visibilityVersion;
      try {
        if (inFlight.current) return;
        const seenAt = onReturn.current ? savedCheckpoint() : undefined;
        const response = await fetch(seenAt === undefined ? endpoint : `${endpoint}?seenAt=${seenAt}`,
          { cache: 'no-store', signal: controller.signal });
        const data = await response.json();
        if (current !== revision.current || visibility !== visibilityVersion || controller.signal.aborted) return;
        if (!response.ok) throw new Error(data?.error ?? '班次暂时无法读取。');
        if (data?.postcard) setPostcard(data.postcard);
        onReturn.current = false;
        markShown(data);
        setReady(true);
        setSnapshot(data);
        onUpdate(data);
        setError('');
      } catch (cause) {
        if (!controller.signal.aborted && current === revision.current) setError(cause instanceof Error ? cause.message : '连接中断，正在重试。');
      } finally {
        reading = false;
        if (!controller.signal.aborted && document.visibilityState === 'visible') timer = setTimeout(read, active ? 900 : 4000);
      }
    }
    function visibilityChanged() {
      visibilityVersion++;
      clearTimeout(timer);
      if (document.visibilityState === 'visible') {
        onReturn.current = true;
        void read();
      }
    }
    document.addEventListener('visibilitychange', visibilityChanged);
    void read();
    return () => {
      document.removeEventListener('visibilitychange', visibilityChanged);
      controller.abort();
      clearTimeout(timer);
    };
  }, [active, onUpdate]);

  async function send(command: Command) {
    if (inFlight.current) return;
    inFlight.current = true;
    revision.current++;
    setPending(true);
    setError('');
    const payload = command.action === 'note' ? { ...command, shiftStartedAt: run?.events[0]?.at } : command;
    const key = JSON.stringify(payload);
    try {
      const id = retry.current?.command === key ? retry.current.id : crypto.randomUUID();
      retry.current = { command: key, id };
      const response = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, requestId: id }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error ?? '操作未送达，请重试。');
      retry.current = null;
      markShown(data);
      if (command.action === 'start') setPostcard(null);
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
      {postcard && <details key={postcard.events.at(-1)?.at} className={styles.postcard} open>
        <summary>回访明信片 · {postcard.eventCount} 条新进展</summary>
        {postcard.before && <p>上次看到 01 号时 · {postcard.before.text}</p>}
        <ul>
          {postcard.events.map((event, index) => <li key={index}>{event.text}</li>)}
        </ul>
        <div className={styles.postcardLinks}>
          {postcard.issue && <Link href={`/nexciv-preview/cafe/news?issue=${postcard.issue.id}`}>阅读早报《{postcard.issue.headline}》</Link>}
          {run?.events[0]?.at === postcard.shiftStartedAt && <a href="#cafe-activity" onClick={() => {
            if (activity.current) activity.current.open = true;
          }}>查看班次经过</a>}
        </div>
      </details>}
      <div className={styles.controls}>
        {active && run.observer ? <>
          {run.phase === 'briefing' ? <>
            <span>给 01 号递纸条</span>
            <button disabled={pending} aria-pressed={run.observer.preferredSource === 'ahe'} onClick={() => send({ action: 'note', suggestion: 'aheFirst' })}>先采访阿禾</button>
            <button disabled={pending} aria-pressed={run.observer.preferredSource === 'regular'} onClick={() => send({ action: 'note', suggestion: 'regularFirst' })}>先采访常客</button>
            <button disabled={pending} aria-pressed={run.observer.angle === 'safety'} onClick={() => send({ action: 'note', suggestion: 'askSafety' })}>问哪里看不清</button>
            <button disabled={pending} aria-pressed={run.observer.angle === 'impact'} onClick={() => send({ action: 'note', suggestion: 'askImpact' })}>问加灯有什么影响</button>
          </> : <span>已记录 {run.observer.sources.length} / 2 位受访者</span>}
        </> : active ? <>
          <span>给 01 号递纸条</span>
          <button disabled={pending || run.phase !== 'working'} onClick={() => send({ action: 'note', suggestion: 'chat' })}>找阿禾聊聊</button>
          <button disabled={pending || run.phase !== 'working'} onClick={() => send({ action: 'note', suggestion: 'rest' })}>早点休息</button>
          <button disabled={pending || run.phase !== 'working'} onClick={() => send({ action: 'note', suggestion: 'fish' })}>去北岸钓鱼</button>
        </> : <>
          <label>阿禾的班次 <select value={busy ? 'busy' : 'free'} onChange={(event) => setBusy(event.target.value === 'busy')}>
            <option value="busy">正在收摊</option><option value="free">已经下班</option>
          </select></label>
          <label>班次 <select value={kind} onChange={(event) => setKind(event.target.value === 'observer' ? 'observer' : 'cafe')}>
            <option value="cafe">咖啡摊帮工</option><option value="observer">城邦观察员</option>
          </select></label>
          <button disabled={pending || !ready} onClick={() => send({ action: 'start', busy, kind })}>{kind === 'observer' ? '开始采访班次' : run ? '再看一个班次' : '开始观察'}</button>
        </>}
        {run && <span className={styles.energy}>01 号精力 <b>{run.energy}</b> / 100</span>}
      </div>
      {(run?.observer || (!active && kind === 'observer')) && <span>采访议题 · {OBSERVER_TOPIC}</span>}
      <Link className={styles.cafeLink} href="/nexciv-preview/cafe/news">
        {run?.observer && run.phase === 'done' ? '阅读本班次的《城邦早报》' : '阅读《城邦早报》'}
      </Link>
      {(error || feedback) && <p role="status">{error || feedback}</p>}
      {!!run?.observer?.sources.length && <details className={styles.cafeLog}>
        <summary>采访记录（{run.observer.sources.length}）</summary>
        {run.observer.sources.map((source) => {
          const speaker = OBSERVER_SPEAKERS[source.speaker];
          return <div key={source.id} id={source.id} tabIndex={-1}>
            <strong>{speaker.name} · {speaker.location}</strong>
            <time> · +{Math.round((source.at - run.events[0]!.at) / 1000)} 秒</time>
            <div>{OBSERVER_QUESTIONS[source.angle]}</div>
            <blockquote>{source.quote}</blockquote>
          </div>;
        })}
      </details>}
      {run && <details ref={activity} id="cafe-activity" className={styles.cafeLog}>
        <summary>{run.events.at(-1)?.text} · 查看经过</summary>
        <ol>{run.events.map((entry, index) => <li key={index}>
          <time>+{Math.round((entry.at - run.events[0]!.at) / 1000)} 秒</time>{entry.text}
          {entry.sourceId && <a className={styles.cafeLink} href={`#${entry.sourceId}`} onClick={() => {
            const card = document.getElementById(entry.sourceId!);
            const panel = card?.closest('details');
            if (panel) panel.open = true;
          }}>查看原话</a>}
        </li>)}</ol>
      </details>}
    </div>
  );
}
