'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './preview.module.css';

type Connection = { connected: boolean; expiresAt: number | null; codeExpiresAt: number | null };
type PairingCode = { code: string; codeExpiresAt: number };

export function CafeMcpPairing({ endpoint, ready }: { endpoint: string; ready: boolean }) {
  const [local, setLocal] = useState(false);
  const [open, setOpen] = useState(false);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [pairing, setPairing] = useState<PairingCode | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const revision = useRef(0);

  useEffect(() => {
    setLocal(['127.0.0.1', 'localhost'].includes(window.location.hostname));
  }, []);

  useEffect(() => {
    if (!ready || !local) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      const current = revision.current;
      try {
        const response = await fetch(`${endpoint}?control=pairing`, { signal: controller.signal, cache: 'no-store' });
        const data = await response.json();
        if (controller.signal.aborted || current !== revision.current) return;
        if (!response.ok) throw new Error(data.error ?? '暂时无法读取 Agent 连接。');
        setConnection(data);
        setPairing((code) => code?.codeExpiresAt === data.codeExpiresAt ? code : null);
      } catch (error) {
        if (open && !controller.signal.aborted && current === revision.current) {
          setMessage(error instanceof Error ? error.message : '暂时无法读取 Agent 连接。');
        }
      } finally {
        if (!controller.signal.aborted && open) timer = setTimeout(refresh, 2000);
      }
    }
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [endpoint, local, open, ready]);

  const instruction = pairing ? `用 nexciv MCP 的 pair_browser 工具连接我的咖啡街，配对码是 ${pairing.code}。只完成配对。` : '';

  async function update(action: 'issueMcpCode' | 'disconnectMcp') {
    setPending(true);
    setMessage('');
    revision.current++;
    try {
      const response = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, requestId: crypto.randomUUID() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '操作未送达，请重试。');
      if (action === 'issueMcpCode') setPairing(data);
      else {
        setPairing(null);
        setConnection(data);
        setMessage(connection?.connected ? '连接已断开。' : '配对已取消。');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '操作未送达，请重试。');
    } finally {
      revision.current++;
      setPending(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(instruction);
      setMessage('已复制配对指令。');
    } catch {
      setMessage('可以直接选中上方指令并复制。');
    }
  }

  if (!local) return null;
  return (
    <details className={styles.cafePairing} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>连接 Agent{connection?.connected ? ' · 已连接' : ''}</summary>
      <div className={styles.pairingContent}>
        {connection?.connected && <p>Codex 可以控制这个试玩会话里的 01 号。让它开启观察员班次，网页会跟随行动。</p>}
        {pairing ? <>
          <p>把这条指令发给 Codex。配对码 5 分钟内有效，只能使用一次。</p>
          <code>{instruction}</code>
        </> : !connection?.connected && <p>生成一次性配对码，把 Codex 接到当前的咖啡街试玩。</p>}
        <div className={styles.controls}>
          {!connection?.connected && <button disabled={!ready || pending} onClick={() => update('issueMcpCode')}>
            {pairing ? '重新生成' : '生成配对码'}
          </button>}
          {pairing && <button disabled={pending} onClick={copy}>复制配对指令</button>}
          {(connection?.connected || pairing) && <button disabled={pending} onClick={() => update('disconnectMcp')}>
            {connection?.connected ? '断开 Agent' : '取消配对'}
          </button>}
        </div>
        {message && <p role="status">{message}</p>}
      </div>
    </details>
  );
}
