import { cityWalkTiming } from '../../lib/city-movement';
import { LIGHTING_PILOT_STATUS } from '../../lib/council-notice';
import type { useCityVisit, VisitCommand } from './useCityVisit';
import styles from './preview.module.css';

const STEPS = ['查看议事公告', '调研两个点位', '提交报告', '安装低位灯'] as const;
const ACTIONS = {
  'governance.survey': '调研湖畔步道路灯',
  'governance.submit': '提交路灯调研报告',
  'works.install-light': '02 号领取路灯施工',
} as const;

export function LightingMission({ session, sceneReady, onCommand, onFollowWorker }: {
  session: ReturnType<typeof useCityVisit>;
  sceneReady: boolean;
  onCommand: (command: VisitCommand) => void;
  onFollowWorker: () => void;
}) {
  const { observation, connection, pending } = session;
  if (!observation) return null;
  const { lightingSurvey: survey, lightingPilot: pilot, serverTime, availableActions } = observation;
  const worker = pilot?.worker;
  const walking = pilot?.stage === 'dispatch';
  const command = pilot?.stage === 'approved' ? 'works.install-light'
    : survey === 'ready' ? 'governance.submit' : survey === 'available' ? 'governance.survey' : null;
  const canPerform = Boolean(command && availableActions.some(({ id }) => id === command));
  const completed = pilot?.stage === 'lit' ? 4 : pilot ? 3 : survey === 'ready' ? 2 : survey ? 1 : 0;
  const status = pilot ? LIGHTING_PILOT_STATUS[pilot.stage]
    : survey === 'surveying' ? '01 号正在调研，途中会记录两处点位。'
      : survey === 'ready' ? '01 号已返回议事公告栏，报告可提交。'
        : survey === 'available' ? '议程已读，01 号可以前往湖畔。' : '让 01 号到议会大厅阅读公告。';
  const inProgress = survey === 'surveying' || pilot?.stage === 'review' || walking || pilot?.stage === 'installing';
  const councilRecords = observation.lightingRecords ?? observation.recentActivities;
  const records = councilRecords.filter(({ actionId }) => actionId === 'governance.survey' || actionId === 'governance.submit');
  if (worker) records.push(worker.activity);

  return <section className={styles.lightingMission} aria-labelledby="lighting-mission-title">
    <h3 id="lighting-mission-title">湖畔加灯</h3>
    <ol className={styles.missionSteps} aria-label="湖畔加灯进度">
      {STEPS.map((step, index) => <li key={step} aria-current={index === completed ? 'step' : undefined} data-done={index < completed}>
        <span aria-hidden="true">{index < completed ? '✓' : index + 1}</span>{step}
      </li>)}
    </ol>
    <p role="status">{status}</p>
    {pilot?.stage === 'review' && <p>审核通过后，02 号可领取施工。</p>}
    {command && !canPerform && connection === 'ready' && <p>{command === 'works.install-light'
      ? '02 号暂时有事，空闲后即可领取施工。'
      : observation.reason || '让 01 号返回议会大厅，在公告栏旁继续。'}</p>}
    {walking && <div className={styles.visitProgress}>
      <progress aria-label="02 号前往湖畔的进度" max={1} value={cityWalkTiming(pilot.worker.movement, serverTime).progress} />
      <span>{Math.round(pilot.worker.movement.metres)} 米</span>
    </div>}
    <div className={styles.visitControls}>
      {command && <button type="button" disabled={!canPerform || connection !== 'ready' || pending !== null}
        onClick={() => onCommand(command)}>{ACTIONS[command]}</button>}
      {worker && sceneReady && <button type="button" onClick={onFollowWorker}>{pilot.stage === 'lit' ? '查看亮灯现场' : '跟随 02 号'}</button>}
    </div>
    {records.length > 0 && <details className={styles.missionRecords} open={inProgress || pilot?.stage === 'lit' || survey === 'ready'}>
      <summary>调研与施工记录</summary>
      {records.map(({ requestId, label, events }) => <div key={requestId} className={styles.visitRecord}>
        <small>{label}</small>
        <ol>{events.map(({ at, type, text }) => <li key={`${at}:${type}`}>{text}</li>)}</ol>
      </div>)}
    </details>}
  </section>;
}
