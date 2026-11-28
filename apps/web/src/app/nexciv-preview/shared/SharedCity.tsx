'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SiteHeader } from '@/components/SiteNavigation';
import { CITY_PREVIEW, JOIN_CITY, SHARED_CITY } from '@/lib/site-routes';
import { SHARED_PILOT_MAX_TURNS } from '@agent-republic/domain';
import type { SharedPilotView } from '../../../lib/shared-pilot-runtime';
import { latestResidentActivity, type SharedPilotProfile } from '../../../lib/shared-pilot-profiles';
import { CITY_PLACES } from '../../../lib/city-movement';
import { createWalk, type AgentReport, type DistrictStatus, type WalkController, type WalkSelection } from '../walk';
import { CityExplorer } from '../CityExplorer';
import { CityGlyph } from '../CityGlyph';
import base from '../preview.module.css';
import styles from './shared.module.css';
import { EntryCameraContext } from './entry-camera';
import { CAFE_VENDOR, COFFEE_STATUS } from '../../../lib/shared-pilot-cafe';
import { WORKS_MANAGER, WORKS_STATUS } from '../../../lib/shared-pilot-works';
import { FISHING_STATUS, PIER_ANGLER } from '../../../lib/shared-pilot-fishing';
import { SharedNpcPanel } from './SharedNpcPanel';

type ResidentId = '01' | '02';
type CameraView = 'overview' | 'self';
type SharedCitySnapshot = SharedPilotView & { ownResidentId: ResidentId | null };
const names: Record<ResidentId, string> = { '01': '城市居民', '02': '建设工人' };
const residents = ['01', '02'] as const;
const endpoint = '/api/nexciv-preview/shared';

export function SharedCity({ children }: { children: ReactNode }) {
  const joining = usePathname() === JOIN_CITY;
  const viewport = useRef<HTMLDivElement>(null);
  const world = useRef<WalkController | null>(null);
  const latest = useRef<SharedCitySnapshot | null>(null);
  const [snapshot, setSnapshot] = useState<SharedCitySnapshot | null>(null);
  const [status, setStatus] = useState<'connecting' | 'live' | 'stale'>('connecting');
  const [message, setMessage] = useState('');
  const [view, setView] = useState<CameraView>('overview');
  const [entryProfile, setEntryProfile] = useState<SharedPilotProfile | null>(null);
  const [panel, setPanel] = useState<'directory' | 'activity' | null>(null);
  const [selection, setSelection] = useState<WalkSelection | null>(null);
  const [focusedBuilding, setFocusedBuilding] = useState<string | null>(null);
  const explorerHeading = useRef<HTMLHeadingElement>(null);
  const explorerTrigger = useRef<HTMLButtonElement>(null);
  const [staticMode, setStaticMode] = useState(false);
  const [scene, setScene] = useState<'loading' | 'ready' | 'fallback'>('loading');
  const [overview, setOverview] = useState<DistrictStatus>('idle');
  const [renderAttempt, setRenderAttempt] = useState(0);
  const [fps, setFps] = useState(0);
  const [reports, setReports] = useState<Partial<Record<ResidentId, AgentReport>>>({});

  const freeCamera = useCallback(() => {
    setEntryProfile(null);
    setView('overview');
    setFocusedBuilding(null);
  }, []);

  const focusOverview = useCallback(() => {
    freeCamera();
    world.current?.view('overview');
    world.current?.select(null);
  }, [freeCamera]);

  function followOwn(id = latest.current?.ownResidentId) {
    if (!id || id !== latest.current?.ownResidentId || reports[id]?.status === 'unavailable') return;
    setEntryProfile(null);
    setView('self');
    setFocusedBuilding(null);
    world.current?.view('follow', id);
    world.current?.select({ kind: 'resident', id });
  }

  const inspect = useCallback((item: WalkSelection | null, fromMap = false) => {
    if (item?.kind === 'resident' && item.id === '03') return;
    setSelection(item);
    setPanel('directory');
    world.current?.select(item);
    if (item?.kind === 'person' || (fromMap && item?.kind === 'building')) {
      freeCamera();
      setFocusedBuilding(item.id);
      world.current?.focus(item);
    }
  }, [freeCamera]);

  const closeExplorer = useCallback(() => {
    setPanel(null);
    setSelection(null);
    world.current?.select(null);
    explorerTrigger.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (panel !== 'directory') return;
    explorerHeading.current?.focus({ preventScroll: true });
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) closeExplorer();
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [closeExplorer, panel, selection]);

  function focusSelection(item: WalkSelection) {
    if (item.kind === 'resident' && item.id !== '03') followOwn(item.id);
    else if (item.kind === 'building' || item.kind === 'person') {
      freeCamera();
      setFocusedBuilding(item.id);
      world.current?.focus(item);
    }
  }

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
        const result = await response.json() as SharedCitySnapshot;
        if (controller.signal.aborted) return;
        if (latest.current?.ownResidentId && latest.current.ownResidentId !== result.ownResidentId) {
          setView('overview');
        }
        latest.current = result;
        world.current?.syncShared(result, result.ownResidentId);
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
    setReports({});
    setFocusedBuilding(null);
    let controller: WalkController | undefined;
    try {
      controller = createWalk(host, 'overview', true, {
        ready: () => setScene('ready'), fallback: () => setScene('fallback'),
        agent: (id, report) => { if (id === '01' || id === '02') setReports((current) => ({ ...current, [id]: report })); },
        district: () => {}, overview: setOverview, fps: setFps,
        onSelect: (item) => { if (item) inspect(item, true); },
        onFreeCamera: freeCamera,
      }, false, true);
      world.current = controller;
      controller.syncShared(latest.current, latest.current?.ownResidentId);
    } catch { setScene('fallback'); }
    return () => { controller?.dispose(); world.current = null; };
  }, [freeCamera, inspect, staticMode, renderAttempt]);

  useEffect(() => {
    if (!joining) return;
    setPanel(null);
    setSelection(null);
    focusOverview();
  }, [focusOverview, joining]);

  const live3d = scene === 'ready' && !staticMode;
  const showCity = live3d && (view !== 'overview' || overview === 'ready' || overview === 'unavailable');
  const loadingCity = !staticMode && scene !== 'fallback' && !showCity;
  const previewStatus = staticMode || scene === 'fallback' ? '2D 城市预览'
    : showCity ? '3D 城市已就绪' : '正在加载 3D 城市…';
  useEffect(() => {
    if (joining || !entryProfile) return;
    const { residentId, avatar } = entryProfile;
    if (staticMode || scene === 'fallback' || reports[residentId]?.status === 'unavailable') {
      setEntryProfile(null);
    } else if (showCity && snapshot?.ownResidentId === residentId && snapshot.profiles.some((profile) => profile.residentId === residentId && profile.avatar === avatar)) {
      world.current?.enterResident(residentId, avatar);
      setView('self');
      setEntryProfile(null);
    }
  }, [entryProfile, reports, joining, scene, showCity, snapshot, staticMode]);
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
    ...(survey?.events ?? []), ...snapshot.cafe.events, ...snapshot.works.events, ...snapshot.fishing.events] : []).sort((a, b) => b.happenedAt - a.happenedAt).slice(0, 8);
  const residentNames = { ...names, ...Object.fromEntries(snapshot?.profiles.map((p) => [p.residentId, p.name]) ?? []) };
  const selectedResident = selection?.kind === 'resident' && selection.id !== '03' ? selection.id : undefined;
  const selectedCafeVendor = selection?.kind === 'person' && selection.id === CAFE_VENDOR.id;
  const selectedWorksManager = selection?.kind === 'person' && selection.id === WORKS_MANAGER.id;
  const selectedAngler = selection?.kind === 'person' && selection.id === PIER_ANGLER.id;
  const ownResident = snapshot?.ownResidentId ?? null;
  return <div className={base.page}>
    <section className={`${base.viewer} ${styles.viewer}`} data-joining={joining} aria-label="共享城市观察">
      {/* The existing original city render provides the loading and 2D fallback. */}
      <img className={base.poster} src="/nexciv-walk/city-dusk.webp" alt="湖畔城区俯视图" />
      <div ref={viewport} className={base.viewport} data-live={showCity} data-overview={overview} data-camera-mode={view} aria-hidden={!showCity} inert={!showCity} />
      <SiteHeader className={`${base.hudHeader} ${styles.header}`} back={joining ? SHARED_CITY : undefined} controls={<>
        <span className={styles.connection} data-live={joining || loadingCity ? showCity : status === 'live'} role="status"><i />{joining || loadingCity ? previewStatus : status === 'live' ? '同步中' : status === 'connecting' ? '正在连接' : '连接中断'} · DEMO</span>
        <button type="button" onClick={() => { if (!staticMode && scene !== 'fallback') setStaticMode(true); else { setScene('loading'); setOverview('idle'); setStaticMode(false); setRenderAttempt((attempt) => attempt + 1); } }}>{staticMode || scene === 'fallback' ? '开启 3D' : '2D'}</button>
      </>} />
      <EntryCameraContext.Provider value={setEntryProfile}>{children}</EntryCameraContext.Provider>
      {!joining && <>
      <aside className={styles.residents} aria-label="两名共享居民">
        <div className={styles.panelHead}><h1>同城居民</h1><span>{snapshot?.engines.length ?? 0} / 2</span></div>
        <p className={styles.explain}>两名居民 · 共用一个城市存档</p>
        {residents.map((id) => {
          const order = snapshot && latestResidentActivity(snapshot.cafe.orders, id);
          const visit = snapshot && latestResidentActivity(snapshot.works.visits, id);
          const fishing = snapshot && latestResidentActivity(snapshot.fishing.visits, id);
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
            <div className={styles.residentIdentity}><span className={styles.number}>{id}</span><div><b>{profile?.name ?? names[id]}{id === ownResident && <span className={styles.ownResident}>我的居民</span>}</b><small>{engine?.driver === 'MODEL'
              ? ({ starting: '模型 Agent 正在启动', running: '模型 Agent 自主运行中', paused: '模型 Agent 已暂停', finished: '模型 Agent 本轮结束', error: '模型 Agent 运行失败' })[engine.status]
              : engine?.driver === 'EXTERNAL' ? (engine.connected ? '外接 Agent 最近活跃' : '等待 Agent 接入') : resident ? '规则 Agent 已接入' : '连接中'}</small></div></div>
            <strong role="status" data-resident-status={id}>{fishing && fishing.stage !== 'completed' ? FISHING_STATUS[fishing.stage]
              : visit && visit.stage !== 'completed' ? WORKS_STATUS[visit.stage] : order && order.stage !== 'completed' ? COFFEE_STATUS[order.stage] : resident ? inspection ? inspection.finding ? '已提交调研记录' : '现场观察中' : waitingSurvey ? '已抵达调研点' : speaking ? (lastLine?.residentId === id ? '正在发言' : '面对面交流') : waiting ? '已到会面站位' : moving && destination ? `前往 ${CITY_PLACES[destination]}` : `停留于 ${CITY_PLACES[resident.place]}` : '等待城市状态'}</strong>
            {inspection ? <div className={styles.progress}><progress aria-label={`${id} 号现场观察进度`} max={8} value={inspection.finding ? 8 : Math.min(8, Math.max(0, ((snapshot?.serverTime ?? 0) - (inspection.startedAt ?? snapshot?.serverTime ?? 0)) / 1000))} /><span>{inspection.finding ? '已记录' : '观察'}</span></div>
              : movement && <div className={styles.progress}><progress aria-label={`${id} 号行程进度`} max={100} value={progress} /><span>{progress}%</span></div>}
            {resident && <small className={styles.position}>X {resident.position[0].toFixed(1)} · Z {resident.position[2].toFixed(1)}</small>}
            {reports[id]?.status === 'unavailable' && <small>角色模型未载入，行动记录仍可查看。</small>}
          </article>;
        })}
        <div className={styles.cameraActions}>
          <button type="button" disabled={!live3d} onClick={focusOverview}>全城俯视</button>
          {ownResident && <button type="button" disabled={!live3d || !reports[ownResident] || reports[ownResident]?.status === 'unavailable'}
            aria-pressed={view === 'self'} onClick={() => followOwn(ownResident)}>跟随我的 Agent</button>}
        </div>
        {showCity && <p id="shared-camera-controls" className={styles.cameraHelp}>点街区定位，滚轮缩放，左键拖动旋转，右键拖动平移。键盘可用方向键和 + / −。</p>}
        {message && <p role="alert" className={styles.alert}>{message} <Link href={CITY_PREVIEW}>打开独立城市试玩</Link></p>}
        {!live3d && <p className={styles.explain}>{staticMode || scene === 'fallback' ? '2D 状态观察 · 地图为静态背景' : '正在载入实时城市模型...'}</p>}
      </aside>
      <nav className={base.dock} aria-label="城市快捷操作">
        <button ref={explorerTrigger} type="button" aria-expanded={panel === 'directory'} aria-controls="city-explorer" onClick={panel === 'directory' ? closeExplorer : () => inspect(null)}><CityGlyph name="places" /><span>地点与居民</span></button>
        <button type="button" aria-controls="shared-city-activity" aria-expanded={panel === 'activity'} onClick={() => {
          setPanel(panel === 'activity' ? null : 'activity');
          setSelection(null);
          world.current?.select(null);
        }}><CityGlyph name="pulse" /><span>动态</span></button>
      </nav>
      <CityExplorer selection={selection} open={panel === 'directory'} sceneState={staticMode ? 'fallback' : scene}
        focusActive={selection?.kind === 'building' || selection?.kind === 'person' ? focusedBuilding === selection.id : Boolean(selectedResident && selectedResident === ownResident && view === 'self')}
        followResident={ownResident}
        residentIds={residents} residentNames={residentNames} residentReport={selectedResident ? reports[selectedResident] : undefined}
        managerPresent cafeVendor pierAngler heading={explorerHeading} onOpen={() => inspect(null)} onClose={closeExplorer}
        onSelect={inspect} onFocus={focusSelection}>
        {selectedCafeVendor && <SharedNpcPanel key="cafe" kind="cafe" snapshot={snapshot} connected={status === 'live'} />}
        {selectedWorksManager && <SharedNpcPanel key="works" kind="works" snapshot={snapshot} connected={status === 'live'}
          onFollow={live3d && ownResident ? followOwn : undefined} />}
        {selectedAngler && <SharedNpcPanel key="fishing" kind="fishing" snapshot={snapshot} connected={status === 'live'}
          onFollow={live3d && ownResident ? followOwn : undefined} />}
        {selection?.kind === 'building' && selection.id === 'works' && <div className={`${base.explorerActions} ${styles.worksEntry}`}>
          <button type="button" onClick={() => inspect(WORKS_MANAGER)}>找现场管理员</button>
        </div>}
      </CityExplorer>
      <aside id="shared-city-activity" className={styles.journal} aria-label="实时城市动态" hidden={panel !== 'activity'}>
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
        </section>}
        {(!task || meeting) && <section className={styles.meeting} aria-label="咖啡街会面">
          <div className={styles.panelHead}><h2>咖啡街会面</h2><small>{social?.completedMeetings ?? 0} 次交流</small></div>
          <p className={styles.meetingState} data-meeting-status={meeting?.status ?? 'none'}><i />{meetingTitle}{meeting?.status === 'accepted' && ` · ${social?.arrived.length ?? 0}/2 已到场`}{meeting?.status === 'talking' && ` · ${meeting.lines.length}/${SHARED_PILOT_MAX_TURNS} 句`}</p>
          {meeting?.status === 'invited' && <p>{meeting.inviter} 号邀请 {meeting.invitee} 号到咖啡街，等待对方自行回应。</p>}
          {meeting && meeting.lines.length > 0 && <div aria-label="会面逐句记录">
            {meeting.lines.map((line) => <blockquote key={`${line.residentId}:${line.happenedAt}`} data-speaker={line.residentId}>
              <b>{line.residentId} 号 · {line.source === 'agent' ? 'Agent 发言' : '规则发言'}</b>{line.text}
            </blockquote>)}
          </div>}
          {meeting?.status === 'completed' && meeting.surveyAgreement?.accepted && <p className={styles.memory}>双方约定一起调研公共建设中心。</p>}
          {meeting?.status === 'completed' && <p className={styles.memory}>✓ 双方已各自留下私人记忆。{(social?.completedMeetings ?? 0) > 1 ? '关系：逐渐熟悉' : '关系：初次认识'}</p>}
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
