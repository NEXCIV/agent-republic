import type { ReactNode } from 'react';
import { CITY_PLACES, cityWalkTiming } from '../../lib/city-movement';
import type { useCityVisit, VisitCommand } from './useCityVisit';
import styles from './preview.module.css';

export const WORKS_MANAGER = { kind: 'person', id: 'works.manager' } as const;
type Venue = 'works' | 'governance';
const ACTION_LABELS = {
  'works.chat': '询问现场管理员',
  'works.patrol': '巡查施工点',
  'works.rest': '在入口等候区休息',
  'governance.read': '查看议事公告',
} as const;
type VenueAction = keyof typeof ACTION_LABELS;
const WORKS_ACTIONS = ['works.patrol', 'works.rest'] as const;
const NOTICE_ACTIONS = ['governance.read'] as const;

export function CityVisitPanel({ venue, session, talkingToManager, onMeet, onCommand, children }: {
  venue: Venue;
  session: ReturnType<typeof useCityVisit>;
  talkingToManager: boolean;
  onMeet: () => void;
  onCommand: (command: VisitCommand) => void;
  children?: ReactNode;
}) {
  const { observation, connection, message, commandError, pending } = session;
  const name = CITY_PLACES[venue];
  const visitCommand = `visit.${venue}` as const;
  const movement = observation?.movement;
  const records = observation?.recentActivities.filter(({ place, actionId }) => place === venue && Object.hasOwn(ACTION_LABELS, actionId)) ?? [];
  const linkedActivity = movement && observation?.recentActivities.find(({ requestId, place }) => requestId === movement.requestId && place === venue);
  const running = linkedActivity?.status === 'running' ? linkedActivity : records.find(({ status }) => status === 'running');
  const enRoute = movement?.status === 'walking' && (Boolean(linkedActivity)
    || ('place' in movement.destination && movement.destination.place === venue));
  const onSite = observation?.nearby?.place === venue && movement?.status !== 'walking';
  const managerPresent = onSite && observation.nearby?.people.some(({ id }) => id === WORKS_MANAGER.id);
  const ready = connection === 'ready' && pending === null;
  const progress = enRoute && observation ? Math.round(100 * cityWalkTiming(movement, observation.serverTime).progress) : 0;
  const actions: readonly VenueAction[] = talkingToManager ? ['works.chat', 'works.patrol']
    : venue === 'works' ? WORKS_ACTIONS : NOTICE_ACTIONS;
  const readyAtNotice = venue === 'governance' && observation?.availableActions.some(({ id }) => id === 'governance.survey' || id === 'governance.submit');
  let status = `派 01 号前往${name}，到达后可以${venue === 'works' ? '询问管理员或巡查现场' : '查看议事公告'}。`;
  if (connection === 'unavailable' || connection === 'offline') status = message;
  else if (pending === visitCommand) status = '正在提交行程…';
  else if (pending) status = '正在提交行动…';
  else if (connection === 'connecting') status = '正在读取城市状态…';
  else if (running) status = running.actionId === 'works.chat' ? '01 号正在和现场管理员交谈。' : `${running.label} · 进行中`;
  else if (enRoute) status = `01 号正在前往${name}。`;
  else if (observation?.reason) status = observation.reason;
  else if (onSite) status = venue === 'works' && !managerPresent ? '01 号已到达。现场管理员暂时离开。' : `01 号已到达${name}。`;

  return <section className={styles.cityVisit} aria-label={`${name}访问`}>
    <h3>现场访问</h3>
    <p role="status">{status}</p>
    {enRoute && <div className={styles.visitProgress}>
      <progress aria-label={linkedActivity ? `${linkedActivity.label}的进度` : `前往${name}的进度`} value={progress} max={100} />
      <span>{progress}%</span>
    </div>}
    {venue === 'works' && onSite && observation && <p>01 号精力 <b>{observation.energy}</b> / 100
      {ready && !observation.reason && !observation.availableActions.some(({ id }) => id === 'works.patrol') && ' · 休息后可巡查'}
    </p>}
    {connection !== 'unavailable' && <div className={styles.visitControls}>
      {(onSite || talkingToManager) ? <>
        {!talkingToManager && managerPresent && <button type="button" onClick={onMeet}>查看现场管理员</button>}
        {!readyAtNotice && actions.map((action) => <button key={action} type="button"
          disabled={!ready || !observation?.availableActions.some(({ id }) => id === action)} onClick={() => onCommand(action)}>
          {ACTION_LABELS[action]}
        </button>)}
      </> : !enRoute && <button type="button" disabled={!ready || !observation?.canMove} onClick={() => onCommand(visitCommand)}>
        让 01 号前往
      </button>}
    </div>}
    {commandError && <p role="alert" className={styles.visitError}>{commandError}</p>}
    {children}
    {records.length > 0 && <div className={styles.visitHistory} aria-label="现场活动记录">
      <h3>现场活动记录</h3>
      {records.map(({ requestId, label, events, status: activityStatus }) => <div key={requestId} className={styles.visitRecord}>
        <small>{label} · {activityStatus === 'completed' ? '已完成' : '进行中'} · DEMO</small>
        <ol>{events.map((event) => <li key={`${event.at}:${event.type}`}>
          {event.speaker && <strong>{event.speaker} · </strong>}{event.text}
        </li>)}</ol>
      </div>)}
    </div>}
  </section>;
}
