import { cityWalkTiming } from '../../lib/city-movement';
import type { useWorksVisit, WorksCommand } from './useWorksVisit';
import styles from './preview.module.css';

export const WORKS_MANAGER = { kind: 'person', id: 'works.manager' } as const;

export function WorksVisitPanel({ session, talkingToManager, onMeet, onCommand }: {
  session: ReturnType<typeof useWorksVisit>;
  talkingToManager: boolean;
  onMeet: () => void;
  onCommand: (command: WorksCommand) => void;
}) {
  const { observation, connection, message, commandError, pending } = session;
  const movement = observation?.movement;
  const trip = movement && 'place' in movement.destination && movement.destination.place === 'works' ? movement : null;
  const enRoute = trip?.status === 'walking';
  const onSite = observation?.nearby?.place === 'works' && movement?.status !== 'walking';
  const managerPresent = onSite && observation.nearby?.people.some(({ id }) => id === WORKS_MANAGER.id);
  const dialogues = observation?.recentActivities.filter(({ actionId }) => actionId === 'works.chat') ?? [];
  const latest = dialogues[0];
  const speaking = latest?.status === 'running';
  const canAsk = observation?.availableActions.some(({ id }) => id === 'works.chat');
  const ready = connection === 'ready' && pending === null;
  const progress = enRoute && observation ? Math.round(100 * cityWalkTiming(trip, observation.serverTime).progress) : 0;
  let status = '派 01 号到入口后，即可询问现场管理员。';
  if (connection === 'unavailable' || connection === 'offline') status = message;
  else if (pending === 'move') status = '正在提交行程…';
  else if (pending === 'chat') status = '正在发起对话…';
  else if (connection === 'connecting') status = '正在读取城市状态…';
  else if (speaking) status = '01 号正在和现场管理员交谈。';
  else if (enRoute) status = '01 号正在前往公共建设中心。';
  else if (onSite) status = managerPresent ? '01 号已到达公共建设中心。' : '01 号已到达。现场管理员暂时离开。';
  else if (observation?.reason) status = observation.reason;

  return <section className={styles.worksVisit} aria-label="公共建设中心访问">
    <h3>现场访问</h3>
    <p role="status">{status}</p>
    {enRoute && <div className={styles.worksProgress}>
      <progress aria-label="前往公共建设中心的进度" value={progress} max={100} />
      <span>{progress}%</span>
    </div>}
    <div className={styles.worksControls}>
      {talkingToManager ? <button type="button" disabled={!ready || !canAsk} onClick={() => onCommand('chat')}>询问现场管理员</button>
        : onSite ? managerPresent && <button type="button" onClick={onMeet}>查看现场管理员</button>
          : connection !== 'unavailable' && <button type="button" disabled={!ready || !observation?.canMove} onClick={() => onCommand('move')}>让 01 号前往</button>}
    </div>
    {commandError && <p role="alert" className={styles.worksError}>{commandError}</p>}
    {latest && <div className={styles.worksHistory} aria-label="现场活动记录">
      <h3>现场活动记录</h3>
      {dialogues.map(({ requestId, events, status: activityStatus }) => <div key={requestId} className={styles.worksRecord}>
        <small>{activityStatus === 'completed' ? '对话完成' : '对话进行中'} · DEMO</small>
        <ol>{events.map((event) => <li key={`${event.at}:${event.type}`}>
          {event.speaker && <strong>{event.speaker} · </strong>}{event.text}
        </li>)}</ol>
      </div>)}
    </div>}
  </section>;
}
