import { useEffect, useRef, useState } from 'react';
import type { CityObservation } from '../../lib/city-movement';

const endpoint = '/api/nexciv-preview/cafe';
const commands = {
  'visit.works': { action: 'moveTo', destination: { place: 'works' } },
  'visit.governance': { action: 'moveTo', destination: { place: 'governance' } },
  'works.chat': { action: 'interactCity', actionId: 'works.chat' },
  'works.patrol': { action: 'interactCity', actionId: 'works.patrol' },
  'works.rest': { action: 'interactCity', actionId: 'works.rest' },
  'governance.read': { action: 'interactCity', actionId: 'governance.read' },
} as const;

export type VisitCommand = keyof typeof commands;
type Connection = 'connecting' | 'ready' | 'offline' | 'unavailable';

async function errorMessage(response: Response, fallback: string) {
  const body = await response.json().catch(() => null);
  return typeof body?.error === 'string' ? body.error : fallback;
}

export function useCityVisit(enabled: boolean, applyObservation: (observation: CityObservation) => void) {
  const [observation, setObservation] = useState<CityObservation | null>(null);
  const [connection, setConnection] = useState<Connection>('connecting');
  const [message, setMessage] = useState('');
  const [commandError, setCommandError] = useState('');
  const [pending, setPending] = useState<VisitCommand | null>(null);
  const commandVersion = useRef(0);
  const writing = useRef(false);
  const retry = useRef<{ command: VisitCommand; id: string } | null>(null);

  useEffect(() => {
    if (!enabled || pending) return;
    if (!['localhost', '127.0.0.1'].includes(window.location.hostname)) {
      setConnection('unavailable');
      setMessage('现场互动目前在本机试玩开放。');
      return;
    }

    const controller = new AbortController();
    const options: RequestInit = { cache: 'no-store', signal: controller.signal };
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      const version = commandVersion.current;
      let nextPoll = 3000;
      try {
        if (document.visibilityState !== 'visible' || writing.current) return;
        let response = await fetch(`${endpoint}?control=city`, options);
        if (response.status === 409) {
          const session = await fetch(endpoint, options);
          if (!session.ok) response = session;
          else response = await fetch(`${endpoint}?control=city`, options);
        }
        if (controller.signal.aborted || version !== commandVersion.current) return;
        if (!response.ok) {
          const problem = response.status === 409 ? '请允许浏览器保存试玩会话，再刷新页面。'
            : await errorMessage(response, '暂时无法读取城市状态。');
          if (controller.signal.aborted || version !== commandVersion.current) return;
          const unavailable = [403, 404, 409, 503].includes(response.status);
          setConnection(unavailable ? 'unavailable' : 'offline');
          setMessage(problem);
          if (unavailable) nextPoll = 0;
          return;
        }
        const data: CityObservation = await response.json();
        if (controller.signal.aborted || version !== commandVersion.current) return;
        applyObservation(data);
        setObservation(data);
        setConnection('ready');
        setMessage('');
        if (data.movement?.status === 'walking' || data.recentActivities[0]?.status === 'running') nextPoll = 900;
      } catch {
        if (!controller.signal.aborted && version === commandVersion.current) {
          setConnection('offline');
          setMessage('与城市的连接中断，正在重试。');
        }
      } finally {
        if (nextPoll && !controller.signal.aborted) timer = setTimeout(refresh, nextPoll);
      }
    }
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [applyObservation, enabled, pending]);

  async function send(command: VisitCommand) {
    if (!enabled || connection !== 'ready' || writing.current) return false;
    writing.current = true;
    commandVersion.current++;
    setPending(command);
    setCommandError('');
    try {
      const id = retry.current?.command === command ? retry.current.id : crypto.randomUUID();
      retry.current = { command, id };
      const response = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...commands[command], requestId: id }),
      });
      if (!response.ok) {
        if (response.status < 500) retry.current = null;
        setCommandError(await errorMessage(response, '操作暂未确认，请稍后重试。'));
        return false;
      }
      retry.current = null;
      setConnection('connecting');
      return true;
    } catch {
      setCommandError('暂时无法确认是否送达，请查看当前活动或重试。');
      return false;
    } finally {
      writing.current = false;
      setPending(null);
    }
  }

  return { observation, connection, message, commandError, pending, send };
}
