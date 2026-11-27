'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CityMark } from '@/components/CityMark';
import type { SharedPilotView } from '../../../lib/shared-pilot-runtime';
import { CITY_PLACES } from '../../../lib/city-movement';
import { createWalk, type DistrictStatus, type WalkController } from '../walk';
import base from '../preview.module.css';
import styles from './shared.module.css';

type ResidentId = '01' | '02';
type CameraView = 'overview' | 'meeting' | 'survey' | ResidentId;
type SharedCityView = SharedPilotView & { invitesEnabled: boolean };
const names: Record<ResidentId, string> = { '01': '城市居民', '02': '建设工人' };
const endpoint = '/api/nexciv-preview/shared';

const CITY_PATH = '/nexciv-preview/shared';
const JOIN_PATH = `${CITY_PATH}/join`;

export function SharedCity({ children }: { children: ReactNode }) {
  const joining = usePathname() === JOIN_PATH;
  const viewport = useRef<HTMLDivElement>(null);
  const world = useRef<WalkController | null>(null);
  const latest = useRef<SharedPilotView | null>(null);
  const [snapshot, setSnapshot] = useState<SharedCityView | null>(null);
  const [status, setStatus] = useState<'connecting' | 'live' | 'stale'>('connecting');
  const [message, setMessage] = useState('');
  const [view, setView] = useState<CameraView>('overview');
  const watchedMeeting = useRef<string | undefined>(undefined);
  const watchedSurvey = useRef<string | undefined>(undefined);
  const [staticMode, setStaticMode] = useState(false);
  const [scene, setScene] = useState<'loading' | 'ready' | 'fallback'>('loading');
  const [overview, setOverview] = useState<DistrictStatus>('idle');
  const [renderAttempt, setRenderAttempt] = useState(0);
  const [fps, setFps] = useState(0);
  const [failedAgents, setFailedAgents] = useState<ResidentId[]>([]);

  const focus = useCallback((id: CameraView) => {
    setView(id);
    world.current?.view(id === 'overview' ? 'overview' : 'follow', id === 'overview' ? undefined : id === 'meeting' || id === 'survey' ? '01' : id);
    world.current?.select(id === 'overview' || id === 'meeting' || id === 'survey' ? null : { kind: 'resident', id });
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
        const result = await response.json() as SharedCityView;
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
    setScene('loading');
    setOverview('idle');
    setView('overview');
    setFailedAgents([]);
    let controller: WalkController | undefined;
    try {
      controller = createWalk(host, 'overview', true, {
        ready: () => setScene('ready'), fallback: () => setScene('fallback'),
        agent: (id, report) => {
          if (id !== '01' && id !== '02') return;
          setFailedAgents((current) => report.status === 'unavailable'
            ? current.includes(id) ? current : [...current, id]
            : current.includes(id) ? current.filter((failed) => failed !== id) : current);
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

  useEffect(() => { if (joining) focus('overview'); }, [focus, joining]);

  const live3d = scene === 'ready' && !staticMode;
  const showCity = live3d && (view !== 'overview' || overview === 'ready' || overview === 'unavailable');
  const loadingCity = !staticMode && scene !== 'fallback' && !showCity;
  const previewStatus = staticMode || scene === 'fallback' ? '2D 城市预览'
    : showCity ? '3D 城市已就绪' : '正在加载 3D 城市…';
  const social = snapshot?.social;
  const meeting = social?.meeting;
  const survey = snapshot?.survey;
  const task = survey?.task;
  const surveyTitle = task ? ({ proposed: '等待对方接受', accepted: '前往调研点', surveying: '现场调研中', completed: '共同报告已完成', declined: '调研被拒绝', expired: '调研超时' })[task.status] : '等待会面约定';
  const submitted = task ? Object.values(task.inspections).filter(({ finding }) => finding).length : 0;
  const lastLine = meeting?.lines.at(-1);
  const meetingTitle = meeting ? ({ invited: '等待回应', accepted: '双方赴约中', talking: '正在交流', completed: '会面已结束', declined: '邀请被婉拒', expired: '会面超时' })[meeting.status] : '暂未发起会面';
  const events = (snapshot ? [...snapshot.events.map((event) => ({ ...event, text: `${event.residentId} 号 ${event.kind === 'MOVE_STARTED' ? '出发前往' : '已到达'} ${CITY_PLACES[event.place]}` })),
    ...(social?.events ?? []).map((event) => ({ ...event, text: event.kind === 'SAID' ? `${event.residentId} 号：${event.text}` : event.text })),
    ...(survey?.events ?? [])] : []).sort((a, b) => b.happenedAt - a.happenedAt).slice(0, 8);
  useEffect(() => {
    if (joining || !live3d || meeting?.status !== 'talking' || watchedMeeting.current === meeting.id) return;
    watchedMeeting.current = meeting.id;
    if (view === 'overview') focus('meeting');
  }, [focus, joining, live3d, meeting?.id, meeting?.status, view]);
  useEffect(() => {
    if (joining || !live3d || task?.status !== 'surveying' || watchedSurvey.current === task.id) return;
    watchedSurvey.current = task.id;
    if (view === 'overview' || view === 'meeting') focus('survey');
  }, [focus, joining, live3d, task?.id, task?.status, view]);
  return <div className={base.page}>
    <section className={`${base.viewer} ${styles.viewer}`} data-joining={joining} aria-label="共享城市观察">
      {/* The existing original city render provides the loading and 2D fallback. */}
      <img className={base.poster} src="/nexciv-walk/city-dusk.webp" alt="湖畔城区俯视图" />
      <div ref={viewport} className={base.viewport} data-live={showCity} data-overview={overview} aria-hidden={!showCity} inert={!showCity} />
      <header className={styles.header}>
        <Link className={styles.brand} href="/"><CityMark /><span>NEXCIV <b>CITY</b></span></Link>
        <span className={styles.divider}>共享城市</span>
        <span className={styles.connection} data-live={joining || loadingCity ? showCity : status === 'live'} role="status"><i />{joining || loadingCity ? previewStatus : status === 'live' ? '状态同步中' : status === 'connecting' ? '正在连接' : '连接中断'} · DEMO</span>
        {joining ? <Link className={styles.join} href={CITY_PATH}>返回城市</Link>
          : snapshot?.invitesEnabled && <Link className={styles.join} href={JOIN_PATH} prefetch={false}>角色与接入</Link>}
        <button type="button" onClick={() => { if (!staticMode && scene !== 'fallback') setStaticMode(true); else { setScene('loading'); setOverview('idle'); setView('overview'); setFailedAgents([]); setStaticMode(false); setRenderAttempt((attempt) => attempt + 1); } }}>{staticMode || scene === 'fallback' ? '开启 3D' : '2D'}</button>
        {!joining && <Link href="/nexciv-preview" prefetch={false}>独立试玩</Link>}
      </header>
      {children}
      {!joining && <>
      <aside className={styles.residents} aria-label="两名共享居民">
        <div className={styles.panelHead}><h1>同城居民</h1><span>{snapshot?.engines.length ?? 0} / 2</span></div>
        <p className={styles.explain}>两名居民 · 共用一个城市存档</p>
        {(['01', '02'] as const).map((id) => {
          const engine = snapshot?.engines.find(({ residentId }) => residentId === id);
          const profile = snapshot?.profiles.find(({ residentId }) => residentId === id);
          const resident = snapshot?.residents.find(({ residentId }) => residentId === id);
          const movement = resident?.movement;
          const moving = movement?.status === 'walking';
          const progress = movement && snapshot ? Math.round(100 * Math.min(1, Math.max(0,
            (snapshot.serverTime - movement.startedAt) / Math.max(1, movement.arrivesAt - movement.startedAt)))) : 0;
          const destination = movement?.destination.place;
          const speaking = meeting?.status === 'talking';
          const waiting = meeting?.status === 'accepted' && social?.arrived.includes(id);
          const inspection = task?.status === 'surveying' ? task.inspections[id] : undefined;
          const waitingSurvey = task?.status === 'accepted' && survey?.arrived.includes(id);
          return <article key={id} className={styles.resident} data-resident={id}>
            <div className={styles.residentIdentity}><span className={styles.number}>{id}</span><div><b>{profile?.name ?? names[id]}</b><small>{engine?.driver === 'EXTERNAL' ? (engine.connected ? '外接 Agent 最近活跃' : '等待 Agent 接入') : resident ? '规则 Agent 已接入' : '连接中'}</small></div>
              <button type="button" disabled={!live3d || failedAgents.includes(id)} aria-pressed={view === id} onClick={() => focus(id)}>跟随</button></div>
            <strong role="status" data-resident-status={id}>{resident ? inspection ? inspection.finding ? '已提交调研记录' : '现场观察中' : waitingSurvey ? '已抵达调研点' : speaking ? (lastLine?.residentId === id ? '正在发言' : '面对面交流') : waiting ? '已到会面站位' : moving && destination ? `前往 ${CITY_PLACES[destination]}` : `停留于 ${CITY_PLACES[resident.place]}` : '等待城市状态'}</strong>
            {inspection ? <div className={styles.progress}><progress aria-label={`${id} 号现场观察进度`} max={8} value={inspection.finding ? 8 : Math.min(8, Math.max(0, ((snapshot?.serverTime ?? 0) - (inspection.startedAt ?? snapshot?.serverTime ?? 0)) / 1000))} /><span>{inspection.finding ? '已记录' : '观察'}</span></div>
              : movement && <div className={styles.progress}><progress aria-label={`${id} 号行程进度`} max={100} value={progress} /><span>{progress}%</span></div>}
            {resident && <small className={styles.position}>X {resident.position[0].toFixed(1)} · Z {resident.position[2].toFixed(1)}</small>}
            {failedAgents.includes(id) && <small>角色模型未载入，行动记录仍可查看。</small>}
          </article>;
        })}
        <button className={styles.overview} type="button" disabled={!live3d} aria-pressed={view === 'overview'} onClick={() => focus('overview')}>{view === 'overview' && overview === 'loading' ? '全城地图加载中…' : '全城俯视'}</button>
        {message && <p role="alert" className={styles.alert}>{message}</p>}
        {!live3d && <p className={styles.explain}>{staticMode || scene === 'fallback' ? '2D 状态观察 · 地图为静态背景' : '正在载入实时城市模型...'}</p>}
      </aside>
      <aside className={styles.journal} aria-label="实时城市动态">
        {task && <section className={styles.meeting} aria-label="公共建设中心共同调研">
          <div className={styles.panelHead}><h2>公共建设中心调研</h2><small>{survey?.completed ?? 0} 次完成</small></div>
          <p className={styles.meetingState} data-survey-status={task.status}><i />{surveyTitle}{task.status === 'accepted' && ` · ${survey?.arrived.length ?? 0}/2 到场`}{task.status === 'surveying' && ` · ${submitted}/2 已记录`}</p>
          <p>来源：咖啡街会面约定 · 两人分别执行</p>
          {(['01', '02'] as const).map((id) => {
            const finding = task.inspections[id].finding;
            const began = task.inspections[id].startedAt !== undefined;
            return <div key={id} className={styles.surveyCheck} data-resident={id}>
              <b>{id} 号 · {survey?.checkpoints[id].label}</b><small>{finding ? '✓ 已提交' : began ? '观察中' : survey?.arrived.includes(id) ? '已到场' : '待到场'}</small>
              {finding && <p>{finding.text}</p>}
              {finding && <small>坐标 X {finding.position[0].toFixed(2)} · Z {finding.position[2].toFixed(2)}</small>}
            </div>;
          })}
          {task.status === 'completed' && survey?.report?.taskId === task.id && <div className={styles.report} data-report-ready="true"><b>✓ 共同调研报告</b><p>{survey.report.summary}</p><small>2 份独立记录 · {new Date(survey.report.completedAt).toLocaleTimeString('zh-CN',{hour12:false})} · DEMO</small></div>}
          {survey?.report && survey.report.taskId !== task.id && <details className={styles.previousReport}><summary>查看上一份共同调研报告</summary><p>{survey.report.summary}</p>{survey.report.findings.map(finding => <p key={finding.checkId}>{finding.residentId} 号 · {finding.label}：{finding.text}（X {finding.position[0].toFixed(2)}, Z {finding.position[2].toFixed(2)}）</p>)}</details>}
          {(['accepted', 'surveying'].includes(task.status) || task.status === 'completed' && survey?.arrived.length === 2) && <button type="button" className={styles.meetingButton} disabled={!live3d} aria-pressed={view === 'survey'} onClick={() => focus('survey')}>查看调研现场</button>}
        </section>}
        {(!task || (meeting && ['invited', 'accepted', 'talking'].includes(meeting.status))) && <section className={styles.meeting} aria-label="咖啡街会面">
          <div className={styles.panelHead}><h2>咖啡街会面</h2><small>{social?.completedMeetings ?? 0} 次交流</small></div>
          <p className={styles.meetingState} data-meeting-status={meeting?.status ?? 'none'}><i />{meetingTitle}{meeting?.status === 'accepted' && ` · ${social?.arrived.length ?? 0}/2 已到场`}{meeting?.status === 'talking' && ` · ${meeting.lines.length}/4 轮`}</p>
          {meeting?.status === 'invited' && <p>{meeting.inviter} 号邀请 {meeting.invitee} 号到咖啡街，等待对方自行回应。</p>}
          {lastLine && <blockquote data-speaker={lastLine.residentId}><b>{lastLine.residentId} 号</b>{lastLine.text}</blockquote>}
          {meeting?.status === 'completed' && <p className={styles.memory}>✓ 双方已各自留下私人记忆。{(social?.completedMeetings ?? 0) > 1 ? '关系：逐渐熟悉' : '关系：初次认识'}</p>}
          {meeting && ['accepted', 'talking'].includes(meeting.status) && <button type="button" className={styles.meetingButton} disabled={!live3d} aria-pressed={view === 'meeting'} onClick={() => focus('meeting')}>查看会面现场</button>}
        </section>}
        <div className={styles.panelHead}><h2>城市动态</h2><small>{snapshot ? `事件 #${Number(snapshot.revision) + (social?.revision ?? 0) + (survey?.revision ?? 0)}` : '等待连接'}</small></div>
        {events.length ? <ol>{events.map((event) => <li key={event.id}><i data-resident={event.residentId} />
          <div>{event.text}</div>
          <time dateTime={new Date(event.happenedAt).toISOString()}>{new Date(event.happenedAt).toLocaleTimeString('zh-CN', { hour12: false })}</time>
        </li>)}</ol> : <p>等待居民首次行动。所有位置和事件都来自同一个服务端存档。</p>}
        <div className={styles.journalFooter}>{snapshot?.running === false ? '本轮规则活动暂未继续' : '链下规则模拟 · 非链上交易'} {live3d && fps > 0 && <span>{fps} FPS</span>}</div>
      </aside>
      </>}
    </section>
  </div>;
}
