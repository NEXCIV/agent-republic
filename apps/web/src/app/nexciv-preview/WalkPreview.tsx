'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { CafeShift, shiftLabel } from './CafeShift';
import type { CafeSnapshot } from '../../lib/cafe-life';
import { CITY_PLACES, cityWalkTiming, type CityObservation } from '../../lib/city-movement';
import { COUNCIL_SURVEY_RECEIPT } from '../../lib/council-notice';
import { createWalk, type AgentId, type AgentReport, type District, type DistrictStatus, type View, type WalkController } from './walk';
import type { Place } from './navigation';
import styles from './preview.module.css';

const PLACES: Record<Place, string> = CITY_PLACES;
const DISTRICTS = {
  east: { button: '东区', title: '东部街区', places: '公民注册中心与公共建设中心' },
  west: { button: '西区', title: '西部街区', places: '社区剧场与展亭' },
  shore: { button: '湖畔', title: '北岸湖畔', places: '滨水步道与码头' },
  research: { button: '研究区', title: '西北研究区', places: 'Agent 中心与阅览室' },
  residential: { button: '住宅区', title: '东北住宅区', places: '花园住宅与邻里庭院' },
};
const STARTING: AgentReport = { status: 'loading', progress: 0 };

function activity(id: AgentId, report: AgentReport) {
  const place = PLACES[report.destination ?? 'plaza'];
  return {
    loading: id === '03' ? '正在载入议会大厅街区' : '中央广场',
    outbound: `前往 ${place}`,
    arrived: `已到达 ${place}`,
    greeting: '和 02 号打招呼',
    unavailable: 'Agent 暂未载入',
  }[report.status];
}

export function WalkPreview({ cafeMode = false }: { cafeMode?: boolean }) {
  const viewport = useRef<HTMLDivElement>(null);
  const world = useRef<WalkController | null>(null);
  const latest = useRef<CafeSnapshot | null>(null);
  const latestCity = useRef<CityObservation | null>(null);
  const [city, setCity] = useState<CityObservation | null>(null);
  const cityWalk = city?.movement;
  const cityMoving = cityWalk?.status === 'walking';
  const recent = city?.recentActivities ?? [];
  const currentActivity = recent[0]?.status === 'running' ? recent[0] : undefined;
  const movementActivity = recent.find(({ requestId }) => requestId === cityWalk?.requestId);
  const cityBusy = cityMoving || Boolean(currentActivity);
  const [shift, setShift] = useState('等待开班');
  const [greeting, setGreeting] = useState('');
  const updateCafe = useCallback((data: CafeSnapshot | null) => {
    latest.current = data;
    world.current?.syncCafe(data);
    setShift(data ? shiftLabel(data.run) : '等待开班');
    const phase = data?.run.phase;
    setGreeting(phase === 'reconnecting' || phase === 'interviewing' || phase === 'waitingForAhe'
      ? data?.run.events.at(-1)?.text ?? '' : '');
  }, []);
  const [state, setState] = useState<'loading' | 'ready' | 'fallback'>('loading');
  const [view, setView] = useState<View>('follow');
  const [overview, setOverview] = useState<DistrictStatus>('idle');
  const [districts, setDistricts] = useState<Record<District, DistrictStatus>>({
    east: 'idle', west: 'idle', shore: 'idle', research: 'idle', residential: 'idle',
  });
  const [selected, setSelected] = useState<AgentId>('01');
  const [playing, setPlaying] = useState(true);
  const [reports, setReports] = useState<Record<AgentId, AgentReport>>({ '01': STARTING, '03': STARTING });
  const [fps, setFps] = useState(0);
  const [readyTime, setReadyTime] = useState(0);

  useEffect(() => {
    const host = viewport.current;
    if (!host) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const initialView = reduceMotion && !cafeMode ? 'overview' : 'follow';
    setView(initialView);
    setPlaying(!reduceMotion);
    try {
      const controller = createWalk(host, initialView, !reduceMotion, {
        ready: (elapsed) => { setReadyTime(elapsed); setState('ready'); },
        fallback: () => setState('fallback'),
        agent: (id, report) => setReports((previous) => ({ ...previous, [id]: report })),
        district: (side, status) => setDistricts((previous) => ({ ...previous, [side]: status })),
        overview: setOverview,
        fps: setFps,
      }, cafeMode);
      world.current = controller;
      if (cafeMode) {
        controller.syncCafe(latest.current);
        controller.syncCity(latestCity.current);
      }
      return () => { controller.dispose(); world.current = null; };
    } catch {
      setState('fallback');
    }
  }, [cafeMode]);

  useEffect(() => {
    if (!cafeMode || !['127.0.0.1', 'localhost'].includes(window.location.hostname)) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const response = await fetch('/api/nexciv-preview/cafe?control=city', { cache: 'no-store', signal: controller.signal });
        if (!response.ok) return;
        const observation: CityObservation = await response.json();
        if (controller.signal.aborted) return;
        latestCity.current = observation;
        world.current?.syncCity(observation);
        setCity(observation);
      } catch {
        // Retry on the next poll, retaining the last position during a brief disconnect.
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(refresh, cityBusy ? 1000 : 2500);
      }
    }
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [cafeMode, cityBusy]);

  function select(next: View, id = selected) {
    world.current?.view(next, id);
    setView(next);
    setSelected(id);
  }

  const sceneReady = state === 'ready';
  const agent = reports[selected];
  const cityLabel = cityWalk && (cityMoving ? `前往 ${cityWalk.name}`
    : movementActivity?.kind === 'survey' ? '已返回 议事公告栏' : `已到达 ${cityWalk.name}`);
  const sceneCaption = currentActivity?.events.at(-1);
  const travelProgress = city && cityWalk && cityMoving
    ? Math.round(100 * cityWalkTiming(cityWalk, city.serverTime).progress)
    : 100;
  const origin = PLACES[agent.from ?? 'plaza'];
  const destination = agent.destination ? PLACES[agent.destination] : '';
  const agentReady = sceneReady && agent.status !== 'loading' && agent.status !== 'unavailable';
  const playbackReady = sceneReady && Object.values(reports).some(({ status }) => status !== 'loading' && status !== 'unavailable');
  const district = view === 'overview' || view === 'follow' ? undefined : { ...DISTRICTS[view], status: districts[view] };
  const districtMessage = district && {
    idle: district.places,
    loading: `正在载入${district.button}`,
    ready: district.places,
    unavailable: `${district.button}载入失败，点击${district.button}重试`,
  }[district.status];
  const overviewMessage = view === 'overview' && state !== 'fallback' ? {
    idle: '正在载入全城',
    loading: '正在载入全城',
    ready: '300 米城区与北岸湖畔',
    unavailable: '全城载入失败，点击全城重试',
  }[overview] : undefined;

  return (
    <div className={styles.page} lang="zh-CN" data-preview="nexciv-walk">
      <a className={styles.skip} href="#walk-controls">跳到操作</a>
      <header className={styles.header}>
        <span className={styles.brand}>NEXCIV</span>
        <span className={styles.divider} />
        <h1>{cafeMode ? '咖啡街的一个班次' : '街区观察'}</h1>
        <Link className={styles.cafeLink} href={cafeMode ? '/nexciv-preview' : '/nexciv-preview/cafe'} prefetch={false}>{cafeMode ? '返回街区' : '观察咖啡街'}</Link>
        <span className={styles.status} role="status">
          {state === 'ready' ? '实时 3D · DEMO' : state === 'loading' ? '正在载入街区' : '静态预览 · DEMO'}
        </span>
      </header>
      <section className={styles.viewer} aria-label="NEXCIV 实时街区">
        <img className={styles.poster} src="/nexciv-walk/poster.webp" alt="Nexus 中央广场和 Corner Market 的黄昏俯视图" />
        <div ref={viewport} className={styles.viewport} data-visual data-live={state === 'ready'} />
        <div className={styles.destination}>
          <small>{cafeMode ? 'AGENT 01 · AI SIMULATED · DEMO' : view === 'overview' ? '全城俯视' : district?.title ?? (agentReady ? `AGENT ${selected} · 模拟行为` : 'NEXUS 中央街区')}</small>
          <strong role="status">{cafeMode ? currentActivity?.label || cityLabel || shift : overviewMessage ?? districtMessage ?? (sceneReady ? activity(selected, agent) : '中央广场')}</strong>
          {sceneCaption && <p className={styles.greeting}>
            {sceneCaption.speaker && `${sceneCaption.speaker} · `}{sceneCaption.text}
          </p>}
          {!cityWalk && !sceneCaption && greeting && <p className={styles.greeting}>{greeting}</p>}
        </div>
        {state === 'fallback' && <p className={styles.fallback}>{cafeMode ? '3D 场景暂时无法加载。仍可在下方观察班次和递纸条。' : '3D 场景暂时无法加载。下方可查看路线的两处实景。'}</p>}
      </section>
      <footer id="walk-controls" tabIndex={-1} className={styles.footer}>
        {cafeMode ? <>
          {cityWalk && <div className={styles.route}>
            <span>{movementActivity?.kind === 'survey' ? '调研路线'
              : movementActivity?.kind === 'work' ? '巡查路线' : movementActivity?.kind === 'read' ? '公告栏路线' : '全城试走'}</span>
            <progress aria-label={currentActivity?.label || cityLabel || 'Agent 01 行程'} max={100} value={travelProgress} />
            <span>{cityWalk.name} · {Math.round(cityWalk.metres)} 米</span>
          </div>}
          {city?.nearby && <div className={styles.cityNearby}>
            <span>附近 · {[...city.nearby.people.map(({ name }) => name), ...city.nearby.facilities.map(({ name }) => name)].join('、')}</span>
            <span>01 号精力 <b>{city.energy}</b> / 100</span>
            {city.nearby.place === 'governance' && city.lightingSurvey === 'submitted'
              && <span>公告栏 · {COUNCIL_SURVEY_RECEIPT}</span>}
            {!!city.availableActions.length && <span className={styles.cityOptions}>
              可选 · {city.availableActions.map(({ label }) => label).join('、')}
            </span>}
          </div>}
          {recent.length > 0 && <details className={styles.cityActivity}>
            <summary>现场活动记录 · {recent.length} 条{recent[0]?.status === 'completed' ? ` · 已完成${recent[0].label}` : ''}</summary>
            {recent.map((entry) => <section key={entry.requestId}>
              <strong>{entry.label} · {entry.status === 'running' ? '进行中' : '已完成'}</strong>
              <ol>{entry.events.map((event) => <li key={`${event.at}:${event.type}`}>
                {event.speaker && `${event.speaker} · `}{event.text}
              </li>)}</ol>
            </section>)}
          </details>}
          <CafeShift onUpdate={updateCafe} />
        </> : <>
        <div className={styles.controls}>
          <div className={styles.switcher} role="group" aria-label="视角">
            <button disabled={!sceneReady} aria-pressed={view === 'overview'} onClick={() => select('overview')}>全城</button>
            {(Object.keys(DISTRICTS) as District[]).map((side) => (
              <button key={side} disabled={!sceneReady} aria-pressed={view === side} onClick={() => select(side)}>
                {DISTRICTS[side].button}
              </button>
            ))}
            <button disabled={!sceneReady || reports['01'].status === 'unavailable'} aria-label="跟随 Agent 01" aria-pressed={view === 'follow' && selected === '01'} onClick={() => select('follow', '01')}>跟随 01</button>
            <button disabled={!sceneReady || reports['03'].status === 'unavailable'} aria-label="跟随 Agent 03" aria-pressed={view === 'follow' && selected === '03'} onClick={() => select('follow', '03')}>跟随 03</button>
          </div>
          <div className={styles.switcher} aria-label="缩放">
            <button disabled={!sceneReady} onClick={() => world.current?.zoom(1.25)} aria-label="缩小">−</button>
            <button disabled={!sceneReady} onClick={() => world.current?.zoom(0.8)} aria-label="放大">+</button>
          </div>
          <button disabled={!sceneReady} onClick={() => world.current?.reset()}>重置镜头</button>
          <button disabled={!playbackReady} onClick={() => {
            world.current?.play(!playing);
            setPlaying(!playing);
          }}>{playing ? '暂停动画' : '播放动画'}</button>
          <span className={styles.hint}>
            <span className={styles.desktopHint}>拖动旋转 · 滚轮缩放</span>
            <span className={styles.touchHint}>拖动旋转 · 双指缩放</span>
          </span>
        </div>
        <div className={styles.route}>
          <span>{origin}</span>
          <progress aria-label={destination ? `Agent ${selected} 从 ${origin} 前往 ${destination} 的行程` : `Agent ${selected} 的行程`} max={100} value={agent.progress} />
          <span>{destination}</span>
          <span className={styles.performance} aria-label="本机实时渲染指标">{fps > 0 ? `${fps} FPS · ${(readyTime / 1000).toFixed(1)} s` : ''}</span>
        </div>
        {state === 'fallback' && (
          <div className={styles.fallbackLinks}>
            <a href="/nexciv-walk/poster.webp">中央广场鸟瞰</a>
            <a href="/nexciv-walk/market.webp">Corner Market 门前</a>
          </div>
        )}
        </>}
      </footer>
    </div>
  );
}
