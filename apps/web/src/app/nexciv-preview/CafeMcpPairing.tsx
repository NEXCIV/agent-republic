'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import styles from './preview.module.css';

type Connection = { connected: boolean; expiresAt: number | null; codeExpiresAt: number | null };
type PairingCode = { code: string; codeExpiresAt: number };

export function CafeMcpPairing({ endpoint, ready, openOnMount = false }: {
  endpoint: string;
  ready: boolean;
  openOnMount?: boolean;
}) {
  const [local, setLocal] = useState<boolean | null>(null);
  const [open, setOpen] = useState(openOnMount);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [pairing, setPairing] = useState<PairingCode | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const revision = useRef(0);
  const summary = useRef<HTMLElement>(null);

  useEffect(() => {
    setLocal(['127.0.0.1', 'localhost'].includes(window.location.hostname));
  }, []);

  useEffect(() => {
    if (openOnMount) setOpen(true);
  }, [openOnMount]);

  useEffect(() => {
    const target = summary.current;
    if (!openOnMount || local === null || !target) return;
    const reveal = () => {
      target.scrollIntoView({ block: 'nearest' });
      target.focus({ preventScroll: true });
    };
    const inactive = target.closest('[inert]');
    if (!inactive) {
      reveal();
      return;
    }
    const observer = new MutationObserver(() => {
      if (target.closest('[inert]')) return;
      reveal();
      observer.disconnect();
    });
    observer.observe(inactive, { attributes: true, attributeFilter: ['inert'] });
    return () => observer.disconnect();
  }, [local, openOnMount]);

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

  if (local === null || (!local && !openOnMount)) return null;
  return (
    <details id="connect-agent" className={styles.cafePairing} open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary ref={summary}>连接 Agent{connection?.connected ? ' · 已连接' : ''}</summary>
      {!local ? <div className={styles.pairingContent}>
        <p>Agent 配对仅在本机咖啡街开放。</p>
        <Link href="/nexciv-preview/docs#agent">查看本机连接说明</Link>
      </div> : <div className={styles.pairingContent}>
        {connection?.connected && <p>让 Codex 查看可到达的地点，选择下一站。01 号的路线和位置会显示在这个网页里。</p>}
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
      </div>}
    </details>
  );
}
