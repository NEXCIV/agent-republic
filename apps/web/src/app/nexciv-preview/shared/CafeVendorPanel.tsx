'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { JOIN_CITY } from '@/lib/site-routes';
import { COFFEE_MENU, COFFEE_STATUS, latestCoffeeOrder, type OrderCoffee } from '../../../lib/shared-pilot-cafe';
import type { SharedPilotView } from '../../../lib/shared-pilot-runtime';
import type { SharedPilotProfile } from '../../../lib/shared-pilot-profiles';
import styles from './shared.module.css';

const path = '/api/nexciv-preview/shared?profile=1';

export function CafeVendorPanel({ snapshot, connected }: { snapshot: SharedPilotView | null; connected: boolean }) {
  const [profile, setProfile] = useState<SharedPilotProfile | null>();
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<{ question: string; text: string }>();
  const [drink, setDrink] = useState<OrderCoffee['drink']>('flat-white');
  const [pending, setPending] = useState<'chat' | 'order'>();
  const [error, setError] = useState('');
  const [accepted, setAccepted] = useState<number>();
  const retry = useRef<{ drink: OrderCoffee['drink']; id: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(path, { cache: 'no-store', signal: controller.signal }).then(async response => {
      if (response.ok) setProfile((await response.json()).profile ?? null);
      else setProfile(null);
    }).catch(() => { if (!controller.signal.aborted) setProfile(null); });
    return () => controller.abort();
  }, []);

  const cafe = snapshot?.cafe;
  const latest = cafe && profile && latestCoffeeOrder(cafe.orders, profile.residentId);
  const own = profile && snapshot?.residents.find(resident => resident.residentId === profile.residentId);
  const busy = Boolean(latest && latest.stage !== 'completed') || (accepted !== undefined && (snapshot?.serverTime ?? 0) < accepted)
    || own?.movement?.status === 'walking';

  async function send(event: FormEvent, kind: 'chat' | 'order') {
    event.preventDefault();
    if (pending || !connected) return;
    const text = question.trim();
    if (kind === 'chat' && !text) return;
    if (kind === 'order' && (!profile || busy)) return;
    setError('');
    setPending(kind);
    try {
      const order = kind === 'order' ? retry.current?.drink === drink ? retry.current
        : { drink, id: globalThis.crypto.randomUUID() } : null;
      if (order) retry.current = order;
      const payload = order ? { action: 'orderCoffee', requestId: order.id, drink } : { action: 'cafeTalk', question: text };
      const response = await fetch(path, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) {
        if (kind === 'order' && response.status === 401) setProfile(null);
        if (response.status < 500 && kind === 'order') retry.current = null;
        throw new Error(result.error ?? '咖啡摊暂时无法回应。');
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
    <p className={styles.cafeState} data-cafe-state={cafe?.serving ? 'busy' : 'free'}>
      <i aria-hidden="true" />{!connected || !cafe ? '正在确认摊位状态' : cafe.serving
        ? `正在接单 · ${cafe.queued} 位等候` : '柜台空闲'}
    </p>
    <form className={styles.cafeQuestion} onSubmit={event => void send(event, 'chat')}>
      <label htmlFor="vendor-question">和阿棠说句话</label>
      <div><input id="vendor-question" value={question} onChange={event => setQuestion(event.target.value)} maxLength={120}
        placeholder="比如：现在要排多久？" />
      <button type="submit" disabled={!connected || !!pending || !question.trim()}>{pending === 'chat' ? '等待回应' : '发送'}</button></div>
    </form>
    {answer && <div className={styles.cafeReply} aria-live="polite"><span>你 · {answer.question}</span><p>{answer.text}</p><small>阿棠 · 模拟回应</small></div>}
    {profile ? <form className={styles.cafeOrder} onSubmit={event => void send(event, 'order')}>
      <label htmlFor="vendor-drink">给 {profile.name} 点单</label>
      <select id="vendor-drink" value={drink} onChange={event => {
        if (event.target.value === 'flat-white' || event.target.value === 'americano') setDrink(event.target.value);
      }}><option value="flat-white">馥芮白</option><option value="americano">美式咖啡</option></select>
      <button type="submit" disabled={!connected || !!pending || busy}>{pending === 'order' ? '提交中' : '让 Agent 去点单'}</button>
      {(latest || accepted !== undefined) && <p role="status" data-coffee-stage={latest?.stage}>{latest ? `${COFFEE_MENU[latest.drink]} · ${COFFEE_STATUS[latest.stage]}` : '已接单，正在查看路线。'}</p>}
    </form> : profile === null && <p className={styles.cafeJoin}><Link href={JOIN_CITY}>创建你的居民</Link>后，就能让 Agent 来点咖啡。</p>}
    {error && <p className={styles.cafeError} role="alert">{error}</p>}
  </div>;
}
