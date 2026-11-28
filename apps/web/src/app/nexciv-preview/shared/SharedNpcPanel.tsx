'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { JOIN_CITY } from '@/lib/site-routes';
import { COFFEE_MENU, COFFEE_STATUS } from '../../../lib/shared-pilot-cafe';
import { WORKS_CHECKS, WORKS_STATUS, type WorksCheck } from '../../../lib/shared-pilot-works';
import { FISHING_STATUS } from '../../../lib/shared-pilot-fishing';
import type { SharedPilotResidentId } from '@agent-republic/domain';
import type { SharedPilotView } from '../../../lib/shared-pilot-runtime';
import { latestResidentActivity, type SharedPilotProfile } from '../../../lib/shared-pilot-profiles';
import styles from './shared.module.css';

const path = '/api/nexciv-preview/shared?profile=1';
const stops = {
  cafe: {
    speaker: '阿棠', question: '和阿棠说句话', placeholder: '比如：现在要排多久？',
    questionAction: 'cafeTalk', task: '点单', submit: '让 Agent 去点单', join: '让 Agent 来点咖啡', awaiting: '已接单，正在查看路线。',
  },
  works: {
    speaker: '现场管理员', question: '询问现场管理员', placeholder: '比如：现在能巡查哪里？',
    questionAction: 'worksTalk', task: '安排现场巡查', submit: '让 Agent 去巡查', join: '让 Agent 领取巡查', awaiting: '已领取，正在查看路线。',
  },
  fishing: {
    speaker: '阿澄', question: '询问北岸钓客', placeholder: '比如：现在有空钓位吗？',
    questionAction: 'fishingTalk', task: '去北岸钓鱼', submit: '让 Agent 去钓鱼', join: '让 Agent 来码头钓鱼', awaiting: '已接到钓鱼安排，正在查看路线。',
  },
} as const;

export function SharedNpcPanel({ kind, snapshot, connected, onFollow }: {
  kind: keyof typeof stops;
  snapshot: SharedPilotView | null;
  connected: boolean;
  onFollow?: (id: SharedPilotResidentId) => void;
}) {
  const config = stops[kind];
  const atCafe = kind === 'cafe';
  const atPier = kind === 'fishing';
  const [profile, setProfile] = useState<SharedPilotProfile | null>();
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<{ question: string; text: string }>();
  const [choice, setChoice] = useState(atCafe ? 'flat-white' : atPier ? 'fishing' : 'entrance-path');
  const [pending, setPending] = useState<'chat' | 'order'>();
  const [error, setError] = useState('');
  const [accepted, setAccepted] = useState<number>();
  const retry = useRef<{ choice: string; id: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(path, { cache: 'no-store', signal: controller.signal }).then(async response => {
      if (response.ok) setProfile((await response.json()).profile ?? null);
      else setProfile(null);
    }).catch(() => { if (!controller.signal.aborted) setProfile(null); });
    return () => controller.abort();
  }, []);

  const cafe = snapshot?.cafe;
  const works = snapshot?.works;
  const fishing = snapshot?.fishing;
  const latestCoffee = cafe && profile && latestResidentActivity(cafe.orders, profile.residentId);
  const latestInspection = works && profile && latestResidentActivity(works.visits, profile.residentId);
  const latestFishing = fishing && profile && latestResidentActivity(fishing.visits, profile.residentId);
  const latest = atCafe ? latestCoffee : atPier ? latestFishing : latestInspection;
  const own = profile && snapshot?.residents.find(resident => resident.residentId === profile.residentId);
  const blockedChecks = new Set(works?.visits.filter(visit => visit.stage !== 'completed').map(visit => visit.checkId));
  const sharedSurvey = snapshot?.survey.task?.status;
  const teamBusy = sharedSurvey === 'proposed' || sharedSurvey === 'accepted' || sharedSurvey === 'surveying';
  const held = accepted !== undefined && (snapshot?.serverTime ?? 0) < accepted;
  const busy = Boolean([latestCoffee, latestInspection, latestFishing].some(visit => visit && visit.stage !== 'completed'))
    || held || (kind === 'works' && (teamBusy || blockedChecks.has(choice as WorksCheck)))
    || own?.movement?.status === 'walking';
  const orderStatus = held ? config.awaiting : atCafe && latestCoffee ? `${COFFEE_MENU[latestCoffee.drink]} · ${COFFEE_STATUS[latestCoffee.stage]}`
    : atPier && latestFishing ? FISHING_STATUS[latestFishing.stage]
      : kind === 'works' && latestInspection ? `${latestInspection.label} · ${WORKS_STATUS[latestInspection.stage]}` : undefined;
  const siteStatus = atCafe ? (cafe?.serving ? `正在接单 · ${cafe.queued} 位等候` : '柜台空闲')
    : atPier ? fishing?.occupied ? `钓位有人 · ${fishing.queued} 位等候` : '钓位空闲'
      : teamBusy ? '共同调研进行中' : `可领巡查点 ${2 - blockedChecks.size} / 2`;

  async function send(event: FormEvent, kind: 'chat' | 'order') {
    event.preventDefault();
    if (pending || !connected) return;
    const text = question.trim();
    if (kind === 'chat' && !text) return;
    if (kind === 'order' && (!profile || busy)) return;
    setError('');
    setPending(kind);
    try {
      const order = kind === 'order' ? retry.current?.choice === choice ? retry.current
        : { choice, id: globalThis.crypto.randomUUID() } : null;
      if (order) retry.current = order;
      const payload = !order ? { action: config.questionAction, question: text }
        : atCafe ? { action: 'orderCoffee', requestId: order.id, drink: choice }
          : atPier ? { action: 'goFishing', requestId: order.id }
            : { action: 'inspectWorks', requestId: order.id, checkId: choice };
      const response = await fetch(path, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) {
        if (kind === 'order' && response.status === 401) setProfile(null);
        if (response.status < 500 && kind === 'order') retry.current = null;
        throw new Error(result.error ?? '暂时无法回应，请稍后再试。');
      }
      if (kind === 'chat') {
        setAnswer({ question: text, text: result.text });
        setQuestion('');
      } else {
        retry.current = null;
        setAccepted(result.acceptedAt + 1);
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : '连接中断，请重试。');
    } finally {
      setPending(undefined);
    }
  }

  return <div className={styles.cafeVendor}>
    <p className={styles.cafeState} data-cafe-state={(atCafe ? cafe?.serving : atPier ? fishing?.occupied : teamBusy || blockedChecks.size > 0) ? 'busy' : 'free'}>
      <i aria-hidden="true" />{!connected || !snapshot ? '正在读取现场状态' : siteStatus}
    </p>
    <form className={styles.cafeQuestion} onSubmit={event => void send(event, 'chat')}>
      <label htmlFor="vendor-question">{config.question}</label>
      <div><input id="vendor-question" value={question} onChange={event => setQuestion(event.target.value)} maxLength={120}
        placeholder={config.placeholder} />
      <button type="submit" disabled={!connected || !!pending || !question.trim()}>{pending === 'chat' ? '等待回应' : '发送'}</button></div>
    </form>
    {answer && <div className={styles.cafeReply} aria-live="polite"><span>你 · {answer.question}</span><p>{answer.text}</p><small>{config.speaker} · 模拟回应</small></div>}
    {profile ? <form className={styles.cafeOrder} onSubmit={event => void send(event, 'order')}>
      {atPier ? <p>派 {profile.name} {config.task}</p> : <>
      <label htmlFor="npc-choice">给 {profile.name} {config.task}</label>
      <select id="npc-choice" value={choice} onChange={event => setChoice(event.target.value)}>
        {atCafe ? Object.entries(COFFEE_MENU).map(([id, label]) => <option value={id} key={id}>{label}</option>)
          : Object.values(WORKS_CHECKS).map(({ checkId, label }) => <option value={checkId} key={checkId} disabled={blockedChecks.has(checkId)}>
            {label}{blockedChecks.has(checkId) ? ' · 已安排' : ''}
          </option>)}
      </select>
      </>}
      <button type="submit" disabled={!connected || !!pending || busy}>{pending === 'order' ? '提交中' : config.submit}</button>
      {orderStatus && <p role="status" data-coffee-stage={atCafe ? latest?.stage : undefined}
        data-inspection-stage={kind === 'works' ? latest?.stage : undefined}
        data-fishing-stage={atPier ? latest?.stage : undefined}>{orderStatus}</p>}
      {!atCafe && latest && latest.stage !== 'completed' && <button className={styles.npcFollow} type="button" onClick={() => onFollow?.(profile.residentId)} disabled={!onFollow}>{atPier ? '跟看钓鱼' : '跟看巡查'}</button>}
      {kind === 'works' && latestInspection?.report && <div className={styles.cafeReply} aria-label="巡查记录">
        <p>{latestInspection.report.text}</p>
        <small>X {latestInspection.position[0].toFixed(2)} · Z {latestInspection.position[2].toFixed(2)} · <time
          dateTime={new Date(latestInspection.report.recordedAt).toISOString()}>
          {new Date(latestInspection.report.recordedAt).toLocaleTimeString('zh-CN', { hour12: false })}
        </time> · 模拟记录</small>
      </div>}
      {atPier && latestFishing?.result && <div className={styles.cafeReply} aria-label="钓鱼记录">
        <p>{latestFishing.result.text}</p>
        <small>北岸码头 · <time dateTime={new Date(latestFishing.result.recordedAt).toISOString()}>
          {new Date(latestFishing.result.recordedAt).toLocaleTimeString('zh-CN', { hour12: false })}
        </time> · 模拟记录</small>
      </div>}
    </form> : profile === null && <p className={styles.cafeJoin}><Link href={JOIN_CITY}>创建你的居民</Link>后，就能{config.join}。</p>}
    {error && <p className={styles.cafeError} role="alert">{error}</p>}
  </div>;
}
