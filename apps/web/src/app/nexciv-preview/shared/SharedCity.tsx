'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { CityMark } from '@/components/CityMark';
import type { SharedPilotView } from '../../../lib/shared-pilot-runtime';
import { CITY_PLACES } from '../../../lib/city-movement';
import { createWalk, type DistrictStatus, type WalkController } from '../walk';
import base from '../preview.module.css';
import styles from './shared.module.css';

type ResidentId = '01' | '02';
type CameraView = 'overview' | 'meeting' | ResidentId;
const names: Record<ResidentId, string> = { '01': '城市居民', '02': '建设工人' };
const endpoint = '/api/nexciv-preview/shared';

export function SharedCity() {
  const viewport = useRef<HTMLDivElement>(null);
  const world = useRef<WalkController | null>(null);
  const latest = useRef<SharedPilotView | null>(null);
  const [snapshot, setSnapshot] = useState<SharedPilotView | null>(null);
  const [status, setStatus] = useState<'connecting' | 'live' | 'stale'>('connecting');
  const [message, setMessage] = useState('');
  const [view, setView] = useState<CameraView>('overview');
  const watchedMeeting = useRef<string | undefined>(undefined);
  const [staticMode, setStaticMode] = useState(false);
  const [scene, setScene] = useState<'loading' | 'ready' | 'fallback'>('loading');
  const [overview, setOverview] = useState<DistrictStatus>('idle');
  const [renderAttempt, setRenderAttempt] = useState(0);
  const [fps, setFps] = useState(0);
  const [failedAgents, setFailedAgents] = useState<ResidentId[]>([]);

  const focus = useCallback((id: CameraView) => {
    setView(id);
    world.current?.view(id === 'overview' ? 'overview' : 'follow', id === 'overview' ? undefined : id === 'meeting' ? '01' : id);
    world.current?.select(id === 'overview' || id === 'meeting' ? null : { kind: 'resident', id });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      let delay = 900;
      try {
        const response = await fetch(endpoint, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) {
          const error = await response.json().catch(() => null);
          delay = 3500;
          throw new Error(typeof error?.error === 'string' ? error.error : '共享城市暂不可用。');
        }
        const result = await response.json() as SharedPilotView;
        if (controller.signal.aborted) return;
        latest.current = result;
        world.current?.syncShared(result);
        setSnapshot(result);
        setStatus('live');
        setMessage('');
      } catch (error) {
        if (controller.signal.aborted) return;
        setStatus('stale');
        setMessage(error instanceof Error ? error.message : '正在连接共享城市。');
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(poll, delay);
      }
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, []);

  useEffect(() => {
    const host = viewport.current;
    if (!host || staticMode) return;
    let controller: WalkController | undefined;
    try {
      controller = createWalk(host, 'overview', true, {
        ready: () => setScene('ready'), fallback: () => setScene('fallback'),
        agent: (id, report) => {
          if ((id === '01' || id === '02') && report.status === 'unavailable') {
            setFailedAgents((previous) => [...new Set([...previous, id])]);
          }
        },
        district: () => {}, overview: setOverview, fps: setFps,
        onSelect: (item) => {
          if (item?.kind === 'resident' && (item.id === '01' || item.id === '02')) {
            setView(item.id); controller?.select(item); controller?.view('follow', item.id);
          }
        },
      }, false, true);
      world.current = controller;
      controller.syncShared(latest.current);
    } catch { setScene('fallback'); }
    return () => { controller?.dispose(); world.current = null; };
  }, [staticMode, renderAttempt]);

  const live3d = scene === 'ready' && !staticMode;
  const social = snapshot?.social;
  const meeting = social?.meeting;
  const lastLine = meeting?.lines.at(-1);
  const meetingTitle = meeting ? ({ invited: '等待回应', accepted: '双方赴约中', talking: '正在交流', completed: '会面已结束', declined: '邀请被婉拒', expired: '会面超时' })[meeting.status] : '暂未发起会面';
  const events = (snapshot ? [...snapshot.events.map((event) => ({ ...event, text: `${event.residentId} 号 ${event.kind === 'MOVE_STARTED' ? '出发前往' : '已到达'} ${CITY_PLACES[event.place]}` })),
    ...(social?.events ?? []).map((event) => ({ ...event, text: event.kind === 'SAID' ? `${event.residentId} 号：${event.text}` : event.text }))] : []).sort((a, b) => b.happenedAt - a.happenedAt).slice(0, 8);
  useEffect(() => {
    if (!live3d || meeting?.status !== 'talking' || watchedMeeting.current === meeting.id) return;
    watchedMeeting.current = meeting.id;
    if (view === 'overview') focus('meeting');
  }, [focus, live3d, meeting?.id, meeting?.status, view]);
  return <main className={base.page}>
    <section className={`${base.viewer} ${styles.viewer}`} aria-label="共享城市观察">
      {/* The existing original city render provides the loading and 2D fallback. */}
      <img className={base.poster} src="/nexciv-walk/city-dusk.webp" alt="湖畔城区俯视图" />
      <div ref={viewport} className={base.viewport} data-live={live3d} data-overview={overview} aria-hidden={!live3d} />
      <header className={styles.header}>
        <Link className={styles.brand} href="/"><CityMark /><span>NEXCIV <b>CITY</b></span></Link>
        <span className={styles.divider}>共享城市</span>
        <span className={styles.connection} data-live={status === 'live'}><i />{status === 'live' ? '状态同步中' : status === 'connecting' ? '正在连接' : '连接中断'} · DEMO</span>
        <button type="button" onClick={() => { if (!staticMode && scene !== 'fallback') setStaticMode(true); else { setScene('loading'); setOverview('idle'); setView('overview'); setFailedAgents([]); setStaticMode(false); setRenderAttempt((attempt) => attempt + 1); } }}>{staticMode || scene === 'fallback' ? '开启 3D' : '2D'}</button>
        <Link href="/nexciv-preview" prefetch={false}>独立试玩</Link>
      </header>
      <aside className={styles.residents} aria-label="两名共享居民">
        <div className={styles.panelHead}><h1>同城居民</h1><span>{snapshot?.engines.length ?? 0} / 2</span></div>
        <p className={styles.explain}>两个独立规则 Agent · 共用一个城市存档</p>
        {(['01', '02'] as const).map((id) => {
          const resident = snapshot?.residents.find(({ residentId }) => residentId === id);
          const movement = resident?.movement;
          const moving = movement?.status === 'walking';
          const progress = movement && snapshot ? Math.round(100 * Math.min(1, Math.max(0,
            (snapshot.serverTime - movement.startedAt) / Math.max(1, movement.arrivesAt - movement.startedAt)))) : 0;
          const destination = movement?.destination.place;
          const speaking = meeting?.status === 'talking';
          const waiting = meeting?.status === 'accepted' && social?.arrived.includes(id);
          return <article key={id} className={styles.resident} data-resident={id}>
            <div className={styles.residentIdentity}><span className={styles.number}>{id}</span><div><b>{names[id]}</b><small>{resident ? '规则 Agent 已接入' : '连接中'}</small></div>
              <button type="button" disabled={!live3d || failedAgents.includes(id)} aria-pressed={view === id} onClick={() => focus(id)}>跟随</button></div>
            <strong role="status" data-resident-status={id}>{resident ? speaking ? (lastLine?.residentId === id ? '正在发言' : '面对面交流') : waiting ? '已到会面站位' : moving && destination ? `前往 ${CITY_PLACES[destination]}` : `停留于 ${CITY_PLACES[resident.place]}` : '等待城市状态'}</strong>
            {movement && <div className={styles.progress}><progress aria-label={`${id} 号行程进度`} max={100} value={progress} /><span>{progress}%</span></div>}
            {resident && <small className={styles.position}>X {resident.position[0].toFixed(1)} · Z {resident.position[2].toFixed(1)}</small>}
            {failedAgents.includes(id) && <small>角色模型未载入，行动记录仍可查看。</small>}
          </article>;
        })}
        <button className={styles.overview} type="button" disabled={!live3d} aria-pressed={view === 'overview'} onClick={() => focus('overview')}>{view === 'overview' && overview === 'loading' ? '全城地图加载中…' : '全城俯视'}</button>
        {message && <p role="alert" className={styles.alert}>{message}</p>}
        {!live3d && <p className={styles.explain}>{staticMode || scene === 'fallback' ? '2D 状态观察 · 地图为静态背景' : '正在载入实时城市模型...'}</p>}
      </aside>
      <aside className={styles.journal} aria-label="实时城市动态">
        <section className={styles.meeting} aria-label="咖啡街会面">
          <div className={styles.panelHead}><h2>咖啡街会面</h2><small>{social?.completedMeetings ?? 0} 次交流</small></div>
          <p className={styles.meetingState} data-meeting-status={meeting?.status ?? 'none'}><i />{meetingTitle}{meeting?.status === 'accepted' && ` · ${social?.arrived.length ?? 0}/2 已到场`}{meeting?.status === 'talking' && ` · ${meeting.lines.length}/4 轮`}</p>
          {meeting?.status === 'invited' && <p>{meeting.inviter} 号邀请 {meeting.invitee} 号到咖啡街，等待对方自行回应。</p>}
          {lastLine && <blockquote data-speaker={lastLine.residentId}><b>{lastLine.residentId} 号</b>{lastLine.text}</blockquote>}
          {meeting?.status === 'completed' && <p className={styles.memory}>✓ 双方已各自留下私人记忆。{(social?.completedMeetings ?? 0) > 1 ? '关系：逐渐熟悉' : '关系：初次认识'}</p>}
          {meeting && ['accepted', 'talking'].includes(meeting.status) && <button type="button" className={styles.meetingButton} disabled={!live3d} aria-pressed={view === 'meeting'} onClick={() => focus('meeting')}>查看会面现场</button>}
        </section>
        <div className={styles.panelHead}><h2>城市动态</h2><small>{snapshot ? `事件 #${Number(snapshot.revision) + (social?.revision ?? 0)}` : '等待连接'}</small></div>
        {events.length ? <ol>{events.map((event) => <li key={event.id}><i data-resident={event.residentId} />
          <div>{event.text}</div>
          <time dateTime={new Date(event.happenedAt).toISOString()}>{new Date(event.happenedAt).toLocaleTimeString('zh-CN', { hour12: false })}</time>
        </li>)}</ol> : <p>等待居民首次行动。所有位置和事件都来自同一个服务端存档。</p>}
        <div className={styles.journalFooter}>{snapshot?.running === false ? '本轮规则活动暂未继续' : '链下规则模拟 · 非链上交易'} {live3d && fps > 0 && <span>{fps} FPS</span>}</div>
      </aside>
    </section>
  </main>;
}
