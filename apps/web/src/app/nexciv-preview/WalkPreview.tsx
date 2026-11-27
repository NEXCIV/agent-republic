'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { SiteHeader } from '@/components/SiteNavigation';
import { CityGlyph } from './CityGlyph';
import { CityLoading } from './CityLoading';
import { LightingMission } from './LightingMission';
import { CafeShift, shiftLabel } from './CafeShift';
import { CityExplorer, landmarkName } from './CityExplorer';
import { WORKS_MANAGER, CityVisitPanel } from './CityVisitPanel';
import type { CafeSnapshot } from '../../lib/cafe-life';
import { CITY_PLACES, cityWalkTiming, type CityObservation } from '../../lib/city-movement';
import { COUNCIL_SURVEY_RECEIPT, LIGHTING_PILOT_STATUS } from '../../lib/council-notice';
import { SHARED_AVATARS } from '../../lib/shared-pilot-profiles';
import { THEATRE_CLOCK } from '../../lib/theatre-layout';
import type { TheatreView } from '../../lib/theatre-trial';
import { createWalk, type AgentReport, type District, type DistrictStatus, type FollowId, type View, type WalkController, type WalkSelection } from './walk';
import type { Place } from './navigation';
import { useCityVisit, type VisitCommand } from './useCityVisit';
import { demoEndpoint, demoRetryDelay, GUEST_DEMO_ENDPOINT } from './demoEndpoint';
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
const PREVIEW_RESIDENTS: readonly FollowId[] = ['01', '02', '03'];
const THEATRE_STATUS: Record<TheatreView['phase'], string> = {
  available: '待选时段', negotiating: '协商时段中', cancelled: '本轮未排期',
  scheduled: '候场中', open: '已开放入场', finished: '试演结束',
};
const THEATRE_RESIDENT_STATUS: Record<TheatreView['residents']['01']['status'], string> = {
  undecided: '待回应', absent: '缺席', 'en-route': '前往剧场', waiting: '入口候场',
  entering: '正在入场', seated: '已就座', leaving: '正在离场', departed: '已离场',
};

function TheatreProgramme({ theatre }: { theatre: TheatreView }) {
  const { booking, phase, offer, slots, attendees, residents, events, programme } = theatre;
  return <details className={styles.cityActivity}>
    <summary>社区剧场 · {THEATRE_STATUS[phase]}{booking && ` · 已到场 ${attendees.length} 人`}</summary>
    {booking ? <p>
      {booking.name} · <time dateTime={new Date(booking.opensAt).toISOString()}>{THEATRE_CLOCK.format(booking.opensAt)}</time> 开放
    </p> : <p>{offer ? `${offer.by} 号提议${slots.find(({ id }) => id === offer.slot)?.name}`
      : slots.map(({ name, waitSeconds }) => `${name}（确认后 ${waitSeconds} 秒开放）`).join('、')}</p>}
    {programme && <p>《{programme.title}》 · {programme.cues.map(({ name }) => name).join('、')}</p>}
    <p>{(['01', '03'] as const).map((id) => `${id} 号 ${THEATRE_RESIDENT_STATUS[residents[id].status]}`).join(' · ')}</p>
    {phase === 'finished' && attendees.map((id) => residents[id].watched.length > 0 && <p key={id}>
      {id} 号观看 · {residents[id].watched.map(({ name, seconds }) => `${name} ${seconds} 秒`).join('、')}
    </p>)}
    {events.length > 0 && <ol>{events.map((entry) => <li key={entry.id}>
      <time dateTime={new Date(entry.at).toISOString()}>{THEATRE_CLOCK.format(entry.at)}</time> · {entry.agentId && `${entry.agentId} 号 · `}{entry.text}
    </li>)}</ol>}
  </details>;
}

function activity(id: FollowId, report: AgentReport) {
  const place = report.destination ? PLACES[report.destination] : undefined;
  return {
    loading: id === '03' ? '正在载入议会大厅街区' : '中央广场',
    outbound: place ? `前往 ${place}` : '正在街区内移动',
    arrived: place ? `已到达 ${place}` : '在街区内等候',
    greeting: '和 02 号打招呼',
    unavailable: 'Agent 暂未载入',
  }[report.status];
}

export function WalkPreview({ cafeMode = false, requestedActivity, connectOnOpen = false }: {
  cafeMode?: boolean;
  requestedActivity?: string;
  connectOnOpen?: boolean;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const world = useRef<WalkController | null>(null);
  const explorerTrigger = useRef<HTMLButtonElement>(null);
  const explorerHeading = useRef<HTMLHeadingElement>(null);
  const explorerFocus = useRef<'trigger' | 'heading' | null>(null);
  const modeControl = useRef<HTMLButtonElement>(null);
  const [panel, setPanel] = useState<'directory' | 'activity' | 'camera' | 'shift' | null>(cafeMode ? 'shift' : null);
  const explorerOpen = panel === 'directory';
  const activityOpen = panel === 'activity';
  const cameraOpen = panel === 'camera';
  const shiftOpen = panel === 'shift';
  const [usingStatic, setUsingStatic] = useState(false);
  const [renderAttempt, setRenderAttempt] = useState(0);
  const [selection, setSelection] = useState<WalkSelection | null>(null);
  const selectionRef = useRef<WalkSelection | null>(null);
  const [inspectionCamera, setInspectionCamera] = useState<WalkSelection | null>(null);
  const inspect = useCallback((item: WalkSelection | null) => {
    selectionRef.current = item;
    world.current?.select(item);
    setSelection(item);
    if (item) setPanel('directory');
  }, []);
  const closeExplorer = useCallback(() => {
    inspect(null);
    explorerFocus.current = 'trigger';
    setPanel(null);
  }, [inspect]);
  const latest = useRef<CafeSnapshot | null>(null);
  const latestCity = useRef<CityObservation | null>(null);
  const syncCity = useCallback((observation: CityObservation) => {
    latestCity.current = observation;
    world.current?.syncCity(observation);
  }, []);
  const visitSession = useCityVisit(!cafeMode, syncCity);
  const seenCityJob = useRef<string | undefined>(undefined);
  const followedCafeId = useRef<FollowId>('01');
  const [cafeFollow, setCafeFollow] = useState<FollowId>('01');
  const followCityAgent = useCallback((id: FollowId) => {
    followedCafeId.current = id;
    setCafeFollow(id);
    setView('follow');
    world.current?.view('follow', id);
  }, []);
  const showTheatre = useCallback(() => {
    setView('west');
    world.current?.view('west');
  }, []);
  const [city, setCity] = useState<CityObservation | null>(null);
  const pilot = city?.lightingPilot;
  const worker = pilot?.worker;
  const evening = city?.eveningWalk;
  const strolls = evening?.recent ?? [];
  const stroll = strolls[0];
  const theatre = city?.theatre;
  const theatre03 = theatre?.residents['03'].walk;
  const thirdWalk = theatre03 && theatre03.startedAt >= (stroll?.movement.startedAt ?? 0) ? theatre03 : stroll?.movement;
  const cityWalk = cafeFollow === '03' ? thirdWalk : cafeFollow === '02' ? worker?.movement : city?.movement;
  const cityMoving = city && cityWalk && city.serverTime < cityWalk.arrivesAt;
  const primaryHistory = city?.recentActivities ?? [];
  const recent = [...primaryHistory, ...strolls.map(({ activity }) => activity), ...(worker ? [worker.activity] : [])]
    .sort((a, b) => b.startedAt - a.startedAt);
  const active = recent.find(({ agentId }) => (agentId ?? '01') === cafeFollow);
  const currentActivity = active?.status === 'running' ? active : undefined;
  const movementActivity = recent.find(({ requestId }) => requestId === cityWalk?.requestId);
  const cityBusy = city?.movement?.status === 'walking' || primaryHistory[0]?.status === 'running'
    || pilot?.stage === 'review' || worker?.activity.status === 'running' || stroll?.status === 'running'
    || theatre?.phase === 'scheduled' || theatre?.phase === 'open';
  const pilotStatus = pilot ? LIGHTING_PILOT_STATUS[pilot.stage] : '';
  const [shift, setShift] = useState('等待开班');
  const [shiftEnergy, setShiftEnergy] = useState<number>();
  const [greeting, setGreeting] = useState('');
  const updateCafe = useCallback((data: CafeSnapshot | null) => {
    latest.current = data;
    world.current?.syncCafe(data);
    setShift(data ? shiftLabel(data.run) : '等待开班');
    setShiftEnergy(data?.run.energy);
    const phase = data?.run.phase;
    setGreeting(phase === 'reconnecting' || phase === 'interviewing' || phase === 'waitingForAhe'
      ? data?.run.events.at(-1)?.text ?? '' : '');
  }, []);
  const [state, setState] = useState<'loading' | 'ready' | 'fallback'>('loading');
  const [guestView, setGuestView] = useState(false);
  const [view, setView] = useState<View>(cafeMode ? 'follow' : 'overview');
  const [overview, setOverview] = useState<DistrictStatus>('idle');
  const [districts, setDistricts] = useState<Record<District, DistrictStatus>>({
    east: 'idle', west: 'idle', shore: 'idle', research: 'idle', residential: 'idle',
  });
  const [selected, setSelected] = useState<FollowId>('01');
  const followInstallation = useRef(false);
  const [playing, setPlaying] = useState(true);
  const [reports, setReports] = useState<Record<FollowId, AgentReport>>({ '01': STARTING, '02': STARTING, '03': STARTING });
  const [fps, setFps] = useState(0);
  const [readyTime, setReadyTime] = useState(0);

  useEffect(() => {
    setGuestView(demoEndpoint() === GUEST_DEMO_ENDPOINT);
  }, []);

  useEffect(() => {
    const host = viewport.current;
    if (!host || usingStatic) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const initialView = cafeMode ? 'follow' : 'overview';
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
        onSelect: cafeMode ? undefined : inspect,
      }, cafeMode);
      world.current = controller;
      controller.select(selectionRef.current);
      controller.syncCity(latestCity.current);
      if (cafeMode) {
        controller.syncCafe(latest.current);
        controller.view('follow', followedCafeId.current);
      }
      return () => { controller.dispose(); world.current = null; };
    } catch {
      setState('fallback');
    }
  }, [cafeMode, inspect, renderAttempt, usingStatic]);

  useEffect(() => {
    const target = explorerFocus.current;
    explorerFocus.current = null;
    if (target === 'trigger') explorerTrigger.current?.focus({ preventScroll: true });
    if (target === 'heading') explorerHeading.current?.focus({ preventScroll: true });
  }, [explorerOpen, selection]);

  useEffect(() => {
    if (!explorerOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) closeExplorer();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [closeExplorer, explorerOpen]);

  const visitObservation = visitSession.observation;
  const visitPilot = visitObservation?.lightingPilot;
  const visitWorker = visitPilot?.worker;
  const followWorker = useCallback(() => {
    world.current?.view('follow', '02');
    world.current?.reset();
    setInspectionCamera(null);
    setView('follow');
    setSelected('02');
  }, []);

  useEffect(() => {
    if (visitWorker && followInstallation.current && state !== 'loading') {
      followInstallation.current = false;
      followWorker();
    }
  }, [followWorker, state, visitWorker]);

  useEffect(() => {
    if (!cafeMode) return;
    const endpoint = demoEndpoint();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      let nextPoll = cityBusy ? 1000 : 2500;
      try {
        const response = await fetch(`${endpoint}?control=city`, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) {
          nextPoll = [403, 404, 503].includes(response.status) ? 0 : demoRetryDelay(response, nextPoll);
          return;
        }
        const observation: CityObservation = await response.json();
        if (controller.signal.aborted) return;
        syncCity(observation);
        setCity(observation);
        const construction = observation.lightingPilot?.worker?.activity;
        const job = requestedActivity && construction?.requestId === requestedActivity ? construction : undefined;
        if (job?.agentId && seenCityJob.current !== job.requestId) {
          seenCityJob.current = job.requestId;
          followCityAgent(job.agentId);
        }
      } catch {
        // Retry on the next poll, retaining the last position during a brief disconnect.
      } finally {
        if (nextPoll && !controller.signal.aborted) timer = setTimeout(refresh, nextPoll);
      }
    }
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [cafeMode, cityBusy, followCityAgent, requestedActivity, syncCity]);

  function select(next: View, id = selected) {
    world.current?.view(next, id);
    setInspectionCamera(null);
    setView(next);
    setSelected(id);
  }

  function openDirectory() {
    explorerFocus.current = 'heading';
    inspect(null);
    setPanel('directory');
  }

  function openDetails(item: WalkSelection) {
    explorerFocus.current = 'heading';
    inspect(item);
  }

  async function visit(command: VisitCommand) {
    const accepted = await visitSession.send(command);
    if (!accepted) return;
    if (command === 'works.install-light') {
      followInstallation.current = true;
    } else if (command === 'visit.works' || command === 'visit.governance' || command === 'works.patrol'
      || command === 'governance.read' || command === 'governance.survey') {
      select('follow', '01');
    }
  }

  function focusSelection(item: WalkSelection) {
    if (item.kind === 'resident' && (item.id !== '02' || visitWorker)) {
      select('follow', item.id);
      return;
    }
    world.current?.focus(item);
    setInspectionCamera(item);
  }

  const sceneReady = state === 'ready';
  const selectedResident = selection?.kind === 'resident' ? reports[selection.id] : undefined;
  const availableResidents = PREVIEW_RESIDENTS.filter((id) => id !== '02' || visitWorker || reports[id].status === 'arrived');
  const focusActive = Boolean(selection && (inspectionCamera
    ? inspectionCamera.kind === selection.kind && inspectionCamera.id === selection.id
    : selection.kind === 'resident' && view === 'follow' && selection.id === selected));
  const cameraLandmark = inspectionCamera?.kind === 'building' ? landmarkName(inspectionCamera.id) : undefined;
  const visitMovement = visitObservation?.movement;
  const visitActivity = visitObservation?.recentActivities.find(({ requestId }) => requestId === visitMovement?.requestId);
  const managerPresent = visitMovement?.status !== 'walking' && Boolean(visitObservation?.nearby?.people.some(({ id }) => id === WORKS_MANAGER.id));
  const followingVisit = !cafeMode && !inspectionCamera && view === 'follow' && selected === '01' && visitMovement;
  const visitLabel = followingVisit && (followingVisit.status === 'walking'
    ? visitActivity?.kind === 'work' || visitActivity?.kind === 'survey' ? visitActivity.label : `前往 ${followingVisit.name}`
    : visitActivity?.kind === 'survey' ? '已返回议事公告栏'
      : visitActivity?.status === 'running' && visitActivity.kind === 'read' ? '正在阅读议事公告' : `已到达 ${followingVisit.name}`);
  const workerStatus = visitWorker && visitPilot ? LIGHTING_PILOT_STATUS[visitPilot.stage] : undefined;
  const followingWorker = !!workerStatus && !inspectionCamera && view === 'follow' && selected === '02';
  const showingCityResident = !cafeMode && selected === '01' && Boolean(visitObservation?.position);
  const visitVenue = selection?.kind === 'person' ? 'works'
    : selection?.kind === 'building' && (selection.id === 'works' || selection.id === 'governance') ? selection.id : null;
  const watchingTheatre = cafeMode && view === 'west' && Boolean(theatre?.booking);
  const theatreResident = cafeFollow !== '02' ? theatre?.residents[cafeFollow] : undefined;
  const followingAttendee = Boolean(theatreResident?.walk?.requestId && theatreResident.walk.requestId === cityWalk?.requestId);
  const agent = reports[selected];
  const cityLabel = cityWalk && (cityMoving ? `前往 ${cityWalk.name}`
    : movementActivity?.kind === 'survey' ? '已返回 议事公告栏' : `已到达 ${cityWalk.name}`);
  const cafeTitle = watchingTheatre && theatre ? THEATRE_STATUS[theatre.phase]
    : followingAttendee && theatreResident ? THEATRE_RESIDENT_STATUS[theatreResident.status]
      : cafeFollow === '02' ? pilotStatus : (cafeFollow === '03' ? cityLabel : currentActivity?.label || cityLabel) || shift;
  const sceneCaption = watchingTheatre || followingAttendee ? undefined : (cafeFollow === '03' ? active : currentActivity)?.events.at(-1);
  const travelProgress = city && cityWalk && cityMoving
    ? Math.round(100 * cityWalkTiming(cityWalk, city.serverTime).progress)
    : 100;
  const origin = PLACES[agent.from ?? 'plaza'];
  const destination = showingCityResident ? visitMovement?.name : agent.destination ? PLACES[agent.destination] : '';
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
  const loadingStage = state === 'loading' ? 'scene'
    : sceneReady && view === 'overview' && !inspectionCamera && (overview === 'idle' || overview === 'loading') ? 'overview' : null;
  const energy = cafeMode ? shiftEnergy ?? city?.energy : visitObservation?.energy;
  const updates = (cafeMode ? recent : [...(visitObservation?.recentActivities ?? []), ...(visitWorker ? [visitWorker.activity] : [])])
    .flatMap(({ requestId, events }) => events.map((event) => ({ ...event, id: `${requestId}:${event.at}:${event.type}` })))
    .sort((a, b) => b.at - a.at).slice(0, 3);

  function useStatic() {
    setUsingStatic(true);
    setState('fallback');
    if (cameraOpen) setPanel(null);
    requestAnimationFrame(() => modeControl.current?.focus({ preventScroll: true }));
  }

  function start3D() {
    setState('loading');
    setOverview('idle');
    setInspectionCamera(null);
    setUsingStatic(false);
    setRenderAttempt((attempt) => attempt + 1);
  }

  return (
    <div className={styles.page} lang="zh-CN" data-preview="nexciv-walk">
      <section className={styles.viewer} aria-label="NEXCIV 实时街区">
        <img className={styles.poster} src="/nexciv-walk/city-dusk.webp" alt="NEXCIV 湖畔城区的黄昏俯视图" />
        <div ref={viewport} className={styles.viewport} data-visual data-live={sceneReady && !loadingStage} />
        <h1 className={styles.srOnly}>{cafeMode ? '咖啡街试玩' : '独立城市试玩'}</h1>
        <SiteHeader className={styles.hudHeader} controls={(
          <div className={styles.tools}>
            <span className={styles.status}><i />{loadingStage ? '城市加载中' : sceneReady ? '实时 3D' : '2D 导览'} <small>{guestView ? '游客 DEMO' : 'DEMO'}</small></span>
            {!loadingStage && <>
              {!cafeMode && sceneReady && <button type="button" aria-label="镜头控制" aria-expanded={cameraOpen} aria-controls="camera-controls" onClick={() => setPanel(cameraOpen ? null : 'camera')}><CityGlyph name="camera" /></button>}
              <button ref={modeControl} type="button" onClick={sceneReady ? useStatic : start3D}>{sceneReady ? '2D' : '开启 3D'}</button>
            </>}
          </div>
        )} />
        <div className={styles.hud} inert={Boolean(loadingStage)}>
        <a className={styles.skip} href="#walk-controls">跳到操作</a>
        <div className={styles.destination}>
          <div className={styles.profile}>
            <img src={SHARED_AVATARS.citizen.portrait} alt="" width={48} height={48} />
            <div><b>01 号居民</b>
              {energy === undefined ? <small>城市居民 · DEMO</small> : <div className={styles.profileEnergy}>
                <span>精力</span><meter min={0} max={100} value={energy} aria-label="01 号精力" /><span>{energy}</span>
              </div>}
            </div>
          </div>
          <div className={styles.cameraCaption}>
          <small>{watchingTheatre ? '社区剧场 · DEMO' : cafeMode ? `AGENT ${cafeFollow} · AI SIMULATED · DEMO`
            : inspectionCamera ? (cameraLandmark ? '地标镜头' : '居民镜头') : view === 'overview' ? '全城俯视' : district?.title ?? (agentReady ? `AGENT ${selected} · 模拟行为` : 'NEXUS 中央街区')}</small>
          <strong role="status">{cafeMode ? cafeTitle
            : inspectionCamera ? cameraLandmark ?? (inspectionCamera.kind === 'person' ? '现场管理员' : '跟随 02 号居民')
              : followingWorker ? workerStatus : visitLabel ? visitLabel
              : overviewMessage ?? districtMessage ?? (sceneReady ? activity(selected, agent) : '中央广场')}</strong>
          {sceneCaption && <p className={styles.greeting}>
            {sceneCaption.speaker && `${sceneCaption.speaker} · `}{sceneCaption.text}
          </p>}
          {watchingTheatre && theatre?.booking && <p className={styles.greeting}>
            {theatre.programme?.activeCue
              ? `《${theatre.programme.title}》 · ${theatre.programme.activeCue.name}`
              : `${theatre.booking.name} · 已到场 ${theatre.attendees.length} 人`}
          </p>}
          {!cityWalk && !sceneCaption && greeting && <p className={styles.greeting}>{greeting}</p>}
          </div>
        </div>
        {activityOpen && <aside className={styles.pulse} aria-labelledby="pulse-title">
          <div className={styles.panelHeading}><h2 id="pulse-title">城市动态</h2><button type="button" onClick={() => setPanel(null)} aria-label="关闭城市动态">×</button></div>
          {updates.length ? <ul>{updates.map(({ id, text, speaker }) => <li key={id}>
            {speaker && <b>{speaker} · </b>}{text}
          </li>)}</ul> : <p>{visitMovement?.status === 'walking' ? `01 号正前往${visitMovement.name}。` : '本次试玩暂无现场活动。'}</p>}
          {!cafeMode && visitSession.connection !== 'unavailable' && <button type="button" className={styles.missionShortcut}
            onClick={() => openDetails({ kind: 'building', id: 'governance' })}>{visitPilot?.stage === 'lit' ? '湖畔加灯 · 已完成' : '湖畔加灯'}</button>}
        </aside>}
        {!cafeMode && <CityExplorer selection={selection} open={explorerOpen} sceneState={state}
          focusActive={focusActive} residentReport={selectedResident} residentIds={availableResidents} workerStatus={workerStatus}
          managerPresent={managerPresent} cafeLink
          heading={explorerHeading} onOpen={openDirectory} onClose={closeExplorer}
          onSelect={openDetails} onFocus={focusSelection}>
          {visitVenue && (
            <CityVisitPanel venue={visitVenue} session={visitSession} talkingToManager={selection?.kind === 'person'}
              onMeet={() => openDetails(WORKS_MANAGER)} onCommand={visit}>
              {visitVenue === 'governance' && <LightingMission session={visitSession} sceneReady={sceneReady}
                onCommand={visit} onFollowWorker={followWorker} />}
            </CityVisitPanel>
          )}
        </CityExplorer>}
        <nav id="walk-controls" tabIndex={-1} className={styles.dock} aria-label="城市快捷操作">
          {!cafeMode && <button ref={explorerTrigger} type="button" aria-expanded={explorerOpen} aria-controls="city-explorer" onClick={explorerOpen ? closeExplorer : openDirectory}><CityGlyph name="places" /><span>地点与居民</span></button>}
          <button type="button" aria-expanded={activityOpen} onClick={() => setPanel(activityOpen ? null : 'activity')}><CityGlyph name="pulse" /><span>动态</span></button>
          {cafeMode && <button type="button" aria-expanded={shiftOpen} aria-controls="cafe-controls" onClick={() => setPanel(shiftOpen ? null : 'shift')}><CityGlyph name="coffee" /><span>咖啡班次</span></button>}
        </nav>
        {state === 'fallback' && <p className={styles.fallback} role="status">{usingStatic ? '已切换到 2D 导览。' : '3D 场景暂时无法加载。'}{cafeMode ? ' 可继续观察班次。' : ' 可从「地点与居民」继续互动。'}</p>}
      <aside id={cafeMode ? 'cafe-controls' : 'camera-controls'} className={`${styles.footer} ${cafeMode ? styles.shiftPanel : styles.cameraPanel}`}
        aria-label={cafeMode ? '咖啡街班次' : '镜头控制'} hidden={cafeMode ? !shiftOpen : !cameraOpen}>
        {cafeMode ? <>
          <div className={styles.panelHeading}><h2>咖啡街班次</h2><button type="button" aria-label="关闭咖啡街班次" onClick={() => setPanel(null)}>×</button></div>
          {cityWalk && !watchingTheatre && <div className={styles.route}>
            <span>{followingAttendee ? '剧场行程' : cafeFollow === '03' ? '傍晚行程' : cafeFollow === '02' ? '施工路线' : movementActivity?.kind === 'survey' ? '调研路线'
              : movementActivity?.kind === 'work' ? '巡查路线' : movementActivity?.kind === 'read' ? '公告栏路线' : '全城试走'}</span>
            <progress aria-label={currentActivity?.label || cityLabel || `Agent ${cafeFollow} 行程`} max={100} value={travelProgress} />
            <span>{cityWalk.name} · {Math.round(cityWalk.metres)} 米</span>
          </div>}
          {city?.nearby && <div className={styles.cityNearby}>
            <span>01 号附近 · {[...city.nearby.people.map(({ name }) => name), ...city.nearby.facilities.map(({ name }) => name)].join('、')}</span>
            <span>01 号精力 <b>{city.energy}</b> / 100</span>
            {city.nearby.place === 'governance' && city.lightingSurvey === 'submitted'
              && <span>公告栏 · {pilotStatus || COUNCIL_SURVEY_RECEIPT}</span>}
            {city.nearby.place === 'governance' && theatre && <span>剧场公告 · {THEATRE_STATUS[theatre.phase]}</span>}
          </div>}
          {!!city?.availableActions.length && <span className={styles.cityOptions}>
            可选 · {city.availableActions.map(({ label }) => label).join('、')}
          </span>}
          {evening && (stroll || pilot) && <div className={styles.cityNearby}>
            <span>03 号精力 <b>{evening.energy}</b> / 100</span>
            <span>湖畔 · {evening.lighting.detail}</span>
          </div>}
          {(worker || stroll || theatre?.booking) && <div className={styles.controls} role="group" aria-label="跟拍居民">
            <button disabled={!sceneReady} aria-pressed={!watchingTheatre && cafeFollow === '01'} onClick={() => followCityAgent('01')}>跟随 01</button>
            {worker && <button disabled={!sceneReady} aria-pressed={!watchingTheatre && cafeFollow === '02'} onClick={() => followCityAgent('02')}>跟随 02</button>}
            {(stroll || theatre03) && <button disabled={!sceneReady} aria-pressed={!watchingTheatre && cafeFollow === '03'} onClick={() => followCityAgent('03')}>跟随 03</button>}
            {theatre?.booking && <button disabled={!sceneReady} aria-pressed={watchingTheatre} onClick={showTheatre}>查看剧场</button>}
          </div>}
          {theatre && <TheatreProgramme theatre={theatre} />}
          {recent.length > 0 && <details className={styles.cityActivity}>
            <summary>现场活动记录 · {recent.length} 条{recent[0]?.status === 'completed' ? ` · 已完成${recent[0].label}` : ''}</summary>
            {recent.map((entry) => <section key={entry.requestId}>
              <strong>{entry.agentId && `${entry.agentId} 号 · `}{entry.label} · {entry.status === 'running' ? '进行中' : '已完成'}</strong>
              <ol>{entry.events.map((event) => <li key={`${event.at}:${event.type}`}>
                {event.speaker && `${event.speaker} · `}{event.text}
              </li>)}</ol>
              {entry.agentId === '03' && <p className={styles.cityNearby}>
                出发时 · {strolls.find(({ activity }) => activity.requestId === entry.requestId)?.observation.lighting.detail}
              </p>}
            </section>)}
          </details>}
          <CafeShift onUpdate={updateCafe} connectOnOpen={connectOnOpen && !loadingStage} />
        </> : <>
        <div className={styles.panelHeading}><h2>镜头控制</h2><button type="button" aria-label="关闭镜头控制" onClick={() => setPanel(null)}>×</button></div>
        <div className={styles.controls}>
          <div className={styles.switcher} role="group" aria-label="视角">
            <button disabled={!sceneReady} aria-pressed={!inspectionCamera && view === 'overview'} onClick={() => select('overview')}>全城</button>
            {(Object.keys(DISTRICTS) as District[]).map((side) => (
              <button key={side} disabled={!sceneReady} aria-pressed={!inspectionCamera && view === side} onClick={() => select(side)}>
                {DISTRICTS[side].button}
              </button>
            ))}
            <button disabled={!sceneReady || reports['01'].status === 'unavailable'} aria-label="跟随 Agent 01" aria-pressed={!inspectionCamera && view === 'follow' && selected === '01'} onClick={() => select('follow', '01')}>跟随 01</button>
            {visitWorker && <button disabled={!sceneReady} aria-label="跟随 Agent 02" aria-pressed={followingWorker} onClick={followWorker}>跟随 02</button>}
            <button disabled={!sceneReady || reports['03'].status === 'unavailable'} aria-label="跟随 Agent 03" aria-pressed={!inspectionCamera && view === 'follow' && selected === '03'} onClick={() => select('follow', '03')}>跟随 03</button>
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
            <span className={styles.desktopHint}>点选地标或居民 · 拖动旋转 · 滚轮缩放</span>
            <span className={styles.touchHint}>拖动旋转 · 双指缩放</span>
          </span>
        </div>
        <div className={styles.route}>
          {followingWorker && visitWorker && visitObservation ? <>
            <progress max={1} value={cityWalkTiming(visitWorker.movement, visitObservation.serverTime).progress} aria-label="02 号前往湖畔的进度" />
            <span>湖畔试点灯位</span>
          </> : showingCityResident && !visitMovement ? <span>01 号 · 等待行动</span> : <>
            {!showingCityResident && <span>{origin}</span>}
            <progress aria-label={destination ? `Agent ${selected} 前往 ${destination} 的行程` : `Agent ${selected} 的行程`} max={100} value={agent.progress} />
            <span>{destination}</span>
          </>}
          <span className={styles.performance} aria-label="本机实时渲染指标">{fps > 0 ? `${fps} FPS · ${(readyTime / 1000).toFixed(1)} s` : ''}</span>
        </div>
        </>}
      </aside>
        </div>
        {loadingStage && <CityLoading stage={loadingStage} cafeMode={cafeMode} onUseStatic={useStatic} />}
      </section>
    </div>
  );
}
