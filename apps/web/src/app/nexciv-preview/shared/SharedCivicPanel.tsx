'use client';

import { useRef, useState } from 'react';
import type { SharedPilotResidentId } from '@agent-republic/domain';
import { theatreActionLabel, type CouncilRead, type SharedTheatreAction } from '../../../lib/shared-pilot-civic';
import type { SharedPilotView } from '../../../lib/shared-pilot-runtime';
import { THEATRE_CLOCK } from '../../../lib/theatre-layout';
import styles from './shared.module.css';

type CivicCommand = Omit<CouncilRead, 'requestId'> | Omit<SharedTheatreAction, 'requestId'>;
const phaseLabel: Record<SharedPilotView['theatre']['phase'], string> = {
  available: '等待居民提议场次', negotiating: '等待另一位居民回应', cancelled: '本轮未排期',
  scheduled: '已排期，观众可选择是否到场', open: '试演进行中', finished: '本轮试演已结束',
};

export function SharedCivicPanel({ kind, snapshot, ownResident, connected }: {
  kind: 'governance' | 'forum'; snapshot: SharedPilotView | null; ownResident: SharedPilotResidentId | null; connected: boolean;
}) {
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const retry = useRef<{ fingerprint: string; id: string }>(null);
  const theatre = snapshot?.theatre;
  const council = snapshot?.council;
  const visit = council?.visits.filter(item => item.residentId === ownResident).at(-1);
  const own = snapshot?.residents.find(item => item.residentId === ownResident);
  const options = theatre?.availableActions.filter(option => option.residentId === ownResident) ?? [];

  async function send(command: CivicCommand) {
    if (sending || !ownResident || !connected) return;
    setSending(true);
    setMessage('');
    setError('');
    const fingerprint = JSON.stringify(command);
    const pending = retry.current?.fingerprint === fingerprint ? retry.current : { fingerprint, id: crypto.randomUUID() };
    retry.current = pending;
    try {
      const response = await fetch('/api/nexciv-preview/shared?profile=1', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...command, requestId: pending.id }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? '暂时无法安排，请稍后再试。');
      setMessage(command.action === 'readCouncilNotice' ? '已安排前往公告栏。' : '已记录你的居民的选择。');
      retry.current = null;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '连接中断，请重试。');
    } finally {
      setSending(false);
    }
  }

  if (!snapshot) return null;
  return <div className={styles.cafeVendor} data-theatre-revision={kind === 'forum' ? theatre?.revision : undefined}>
    {kind === 'governance' ? <>
      <h3 className={styles.worksHeading}>议事公告</h3>
      <ul aria-label="当前议题">{council?.agenda.map(text => <li key={text}>{text}</li>)}</ul>
      {ownResident && <button type="button" onClick={() => void send({ action: 'readCouncilNotice' })}
        disabled={!connected || sending || own?.movement?.status === 'walking' || visit?.stage === 'reading'}>
        让我的 Agent 阅读公告
      </button>}
      {visit && <p role="status">{visit.stage === 'travelling' ? '正在前往公告栏' : visit.stage === 'reading' ? '正在阅读公告' : '已读完议会公告'}</p>}
    </> : theatre && <>
      <h3 className={styles.worksHeading}>{theatre.title}</h3>
      <p role="status">{phaseLabel[theatre.phase]}</p>
      {theatre.offer && theatre.phase === 'negotiating' && <p>{theatre.offer.by} 号提议{theatre.slots.find(slot => slot.id === theatre.offer?.slot)?.name}</p>}
      {theatre.booking && <p>{theatre.booking.name} · {THEATRE_CLOCK.format(theatre.booking.opensAt)} 开场</p>}
      {theatre.programme?.activeCue && <p>正在演出「{theatre.programme.activeCue.name}」</p>}
      {(theatre.phase === 'open' || theatre.phase === 'finished') && <p>实际到场 {theatre.attendees.length} 人</p>}
      {options.map(({ residentId, ...option }) => {
        const label = theatreActionLabel(option);
        return <button key={`${residentId}:${label}`} type="button" disabled={!connected || sending}
          onClick={() => void send({ action: 'respondTheatre', revision: theatre.revision, ...option })}>{label}</button>;
      })}
    </>}
    {message && <p role="status">{message}</p>}
    {error && <p className={styles.alert} role="alert">{error}</p>}
  </div>;
}
