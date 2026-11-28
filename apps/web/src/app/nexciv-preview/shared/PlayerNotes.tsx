'use client';

import { useId, useRef, useState, type FormEvent } from 'react';
import { NOTE_MAX_LENGTH, type PlayerNoteView } from '../../../lib/shared-pilot-notes';
import styles from './shared.module.css';

const labels: Record<PlayerNoteView['status'], string> = {
  pending: '等待 Agent 处理', adopted: '已采纳', adapted: '已调整', skipped: '已略过', expired: '已过期',
};

export function PlayerNotes({ notes, connected }: { notes: PlayerNoteView[]; connected: boolean }) {
  const input = useId();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState<PlayerNoteView>();
  const retry = useRef<{ id: string; text: string }>(null);
  const newest = notes.at(-1);
  const local = sent && !notes.some(note => note.id === sent.id) && (!newest || newest.sentAt <= sent.sentAt) ? sent : undefined;
  const last = local ?? newest;
  const pending = last?.status === 'pending';

  async function send(event: FormEvent) {
    event.preventDefault();
    const advice = text.trim();
    if (!advice || !connected || pending || sending) return;
    setSending(true);
    setError('');
    const draft = retry.current?.text === advice ? retry.current : { id: crypto.randomUUID(), text: advice };
    retry.current = draft;
    try {
      const response = await fetch('/api/nexciv-preview/shared?profile=1', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'submitPlayerNote', noteId: draft.id, text: draft.text }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? '暂时无法送出纸条。');
      setSent(result as PlayerNoteView);
      retry.current = null;
      setText('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '连接中断，请重试。');
    } finally {
      setSending(false);
    }
  }

  return <details className={styles.playerNotes}>
    <summary>给我的 Agent 递纸条{pending && <span> · 待处理</span>}</summary>
    <div className={styles.cafeVendor}>
      <form className={styles.cafeQuestion} onSubmit={send}>
        <label htmlFor={input}>仅你和已接入的 Agent 可见</label>
        <div><input id={input} value={text} onChange={event => setText(event.target.value)} maxLength={NOTE_MAX_LENGTH}
          placeholder="比如「今天认识个新朋友」" />
        <button type="submit" disabled={!connected || sending || pending || !text.trim()}>{sending ? '发送中' : '送出'}</button></div>
      </form>
      {last && <div className={styles.cafeReply} aria-live="polite">
        <span>{labels[last.status]}</span>
        <p>{last.text}</p>
        {last.activityLabel && <small>已安排{last.activityLabel}</small>}
        {last.reason && <p>{last.reason}</p>}
      </div>}
      {error && <p role="alert" className={styles.alert}>{error}</p>}
    </div>
  </details>;
}
