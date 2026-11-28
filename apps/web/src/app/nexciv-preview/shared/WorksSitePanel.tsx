'use client';

import { useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { JOIN_CITY } from '@/lib/site-routes';
import type { SharedPilotResidentId } from '@agent-republic/domain';
import type { SharedPilotView } from '../../../lib/shared-pilot-runtime';
import { WORKS_CHECKS, worksBriefActive } from '../../../lib/shared-pilot-works';
import styles from './shared.module.css';

type WorksBrief = SharedPilotView['works']['briefs'][number];

export function WorksBriefRecord({ brief, serverTime }: { brief: WorksBrief; serverTime: number }) {
  const { decision, reason, visit } = brief;
  const stage = brief.stage === 'travelling' && decision ? '前往巡查点' : {
    travelling: '前往公共建设中心', deciding: '查看现场和可用巡查点',
    observing: '正在现场观察', completed: '调研完成', failed: '调研未完成',
  }[brief.stage];
  const observed = visit?.arrivedAt != null ? Math.max(0, serverTime - visit.arrivedAt) : 0;
  return <div className={styles.worksRecord} data-brief-stage={brief.stage} data-has-decision={Boolean(decision)}>
    <p role="status"><strong>{stage}</strong></p>
    {decision && <>
      {decision.managerReply
        ? <p>Agent 先询问现场管理员。<br />「{decision.managerReply}」</p>
        : <p>入口外侧步道空闲，Agent 决定直接巡查。</p>}
      <small>巡查点 · {WORKS_CHECKS[decision.checkId].label}</small>
    </>}
    {brief.stage === 'observing' && visit?.arrivedAt != null && <progress className={styles.worksProgress}
      aria-label="现场观察进度" max={visit.reportAt - visit.arrivedAt} value={observed} />}
    {reason && <p>{reason}</p>}
    {visit?.report && <div className={styles.worksFinding}>
      <p>{visit.report.text}</p>
      <small>X {visit.position[0].toFixed(2)} · Z {visit.position[2].toFixed(2)} · <time
        dateTime={new Date(visit.report.recordedAt).toISOString()}>
        {new Date(visit.report.recordedAt).toLocaleTimeString('zh-CN', { hour12: false })}
      </time> · 规则模拟</small>
    </div>}
  </div>;
}

export function WorksSitePanel({ snapshot, ownResident, connected, onFollow, onManager }: {
  snapshot: SharedPilotView | null;
  ownResident: SharedPilotResidentId | null;
  connected: boolean;
  onFollow?: () => void;
  onManager: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [acceptedAt, setAcceptedAt] = useState<number>();
  const [error, setError] = useState('');
  const request = useRef<string | null>(null);
  const submitting = useRef(false);
  const brief = snapshot?.works.briefs.find(brief => brief.residentId === ownResident);
  const syncing = acceptedAt !== undefined && (!brief || brief.acceptedAt < acceptedAt);
  const taskLive = brief && worksBriefActive(brief);
  const occupied = snapshot?.works.visits.filter(visit => visit.stage !== 'completed').length ?? 0;
  const open = Object.keys(WORKS_CHECKS).length - occupied;
  const teamSurvey = snapshot?.survey.task?.status;
  const meeting = snapshot?.social.meeting?.status;
  const busy = (teamSurvey && ['proposed', 'accepted', 'surveying'].includes(teamSurvey))
    || (meeting && ['invited', 'accepted', 'talking'].includes(meeting))
    || snapshot?.residents.some(resident => resident.residentId === ownResident && resident.movement?.status === 'walking')
    || [snapshot?.works.visits, snapshot?.cafe.orders, snapshot?.fishing.visits].some(
      entries => entries?.some(entry => entry.residentId === ownResident && entry.stage !== 'completed'),
    );

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current || !ownResident || !connected || syncing || busy || taskLive) return;
    submitting.current = true;
    setError('');
    setPending(true);
    try {
      request.current ??= crypto.randomUUID();
      const response = await fetch('/api/nexciv-preview/shared?profile=1', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'surveyWorksSite', requestId: request.current }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status < 500) request.current = null;
        throw new Error(result.error ?? '暂时无法安排调研，请稍后重试。');
      }
      setAcceptedAt(result.acceptedAt);
      request.current = null;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '暂时无法安排调研，请稍后重试。');
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return <section className={styles.cafeVendor} aria-labelledby="works-site-heading">
    <form className={styles.cafeOrder} onSubmit={event => void submit(event)}>
      <h3 id="works-site-heading" className={styles.worksHeading}>现场调研</h3>
      <p>Agent 到场后按现场规则选择巡查点，完成后留下观察记录。</p>
      {snapshot && <p className={styles.cafeState}>现场管理员在入口外 · {open} 个可用巡查点</p>}
      {syncing && <p role="status">已安排，正在同步 Agent 的行程。</p>}
      {ownResident && !taskLive && !syncing && <button type="submit" disabled={!connected || pending || Boolean(busy)}>
        {pending ? '正在安排调研' : '让我的 Agent 调研现场'}
      </button>}
      {ownResident && busy && !taskLive && !syncing && <p>等当前活动结束后，可安排现场调研。</p>}
      {connected && snapshot && !ownResident && <p className={styles.cafeJoin}><Link href={JOIN_CITY}>创建你的居民</Link>后即可安排调研。</p>}
      {error && <p className={styles.cafeError} role="alert">{error}</p>}
    </form>
    {brief && !syncing && <WorksBriefRecord brief={brief} serverTime={snapshot?.serverTime ?? brief.acceptedAt} />}
    {taskLive && onFollow && <button type="button" className={styles.worksSecondary} onClick={onFollow}>跟随我的 Agent</button>}
    <button type="button" className={styles.worksSecondary} onClick={onManager}>找现场管理员</button>
  </section>;
}
