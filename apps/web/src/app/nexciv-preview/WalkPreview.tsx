'use client';

import { useEffect, useRef, useState } from 'react';
import { createWalk, type AgentStatus, type View, type WalkController } from './walk';
import styles from './preview.module.css';

const agentActivity: Record<AgentStatus, string> = {
  loading: '中央广场',
  outbound: '前往 Corner Market',
  atMarket: '已到达 Corner Market',
  inbound: '返回中央广场',
  atNexus: '已返回中央广场',
  unavailable: 'Agent 暂未载入',
};

export function WalkPreview() {
  const viewport = useRef<HTMLDivElement>(null);
  const world = useRef<WalkController | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'fallback'>('loading');
  const [view, setView] = useState<View>('follow');
  const [playing, setPlaying] = useState(true);
  const [agent, setAgent] = useState<{ status: AgentStatus; progress: number }>({ status: 'loading', progress: 0 });
  const [fps, setFps] = useState(0);
  const [readyTime, setReadyTime] = useState(0);

  useEffect(() => {
    const host = viewport.current;
    if (!host) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const initialView = reduceMotion ? 'overview' : 'follow';
    setView(initialView);
    setPlaying(!reduceMotion);
    try {
      const controller = createWalk(host, initialView, !reduceMotion, {
        ready: (elapsed) => { setReadyTime(elapsed); setState('ready'); },
        fallback: () => setState('fallback'),
        agent: (status, progress) => {
          setAgent({ status, progress });
          if (status === 'unavailable') setView('overview');
        },
        fps: setFps,
      });
      world.current = controller;
      return () => { controller.dispose(); world.current = null; };
    } catch {
      setState('fallback');
    }
  }, []);

  function select(next: View) {
    world.current?.view(next);
    setView(next);
  }

  const sceneReady = state === 'ready';
  const agentReady = sceneReady && agent.status !== 'loading' && agent.status !== 'unavailable';

  return (
    <div className={styles.page} lang="zh-CN" data-preview="nexciv-walk">
      <a className={styles.skip} href="#walk-controls">跳到操作</a>
      <header className={styles.header}>
        <span className={styles.brand}>NEXCIV</span>
        <span className={styles.divider} />
        <h1>街区观察</h1>
        <span className={styles.status} role="status">
          {state === 'ready' ? '实时 3D · DEMO' : state === 'loading' ? '正在载入街区' : '静态预览 · DEMO'}
        </span>
      </header>
      <section className={styles.viewer} aria-label="NEXCIV 实时街区">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className={styles.poster} src="/nexciv-walk/poster.webp" alt="Nexus 中央广场和 Corner Market 的黄昏俯视图" />
        <div ref={viewport} className={styles.viewport} data-visual data-live={state === 'ready'} />
        <div className={styles.destination}>
          <small>{agentReady ? 'AGENT 01 · 模拟行为' : 'NEXUS 东南街区'}</small>
          <strong role="status">{sceneReady ? agentActivity[agent.status] : '中央广场'}</strong>
        </div>
        {state === 'fallback' && <p className={styles.fallback}>3D 场景暂时无法加载。下方可查看路线的两处实景。</p>}
      </section>
      <footer id="walk-controls" tabIndex={-1} className={styles.footer}>
        <div className={styles.controls}>
          <div className={styles.switcher} aria-label="视角">
            <button disabled={!sceneReady} aria-pressed={view === 'overview'} onClick={() => select('overview')}>俯视</button>
            <button disabled={!agentReady} aria-pressed={view === 'follow'} onClick={() => select('follow')}>跟随 Agent</button>
          </div>
          <div className={styles.switcher} aria-label="缩放">
            <button disabled={!sceneReady} onClick={() => world.current?.zoom(1.25)} aria-label="缩小">−</button>
            <button disabled={!sceneReady} onClick={() => world.current?.zoom(0.8)} aria-label="放大">+</button>
          </div>
          <button disabled={!sceneReady} onClick={() => world.current?.reset()}>重置镜头</button>
          <button disabled={!agentReady} onClick={() => {
            world.current?.play(!playing);
            setPlaying(!playing);
          }}>{playing ? '暂停动画' : '播放动画'}</button>
          <span className={styles.hint}>
            <span className={styles.desktopHint}>拖动旋转 · 滚轮缩放</span>
            <span className={styles.touchHint}>拖动旋转 · 双指缩放</span>
          </span>
        </div>
        <div className={styles.route}>
          <span>中央广场</span>
          <progress aria-label="Agent 在中央广场与 Corner Market 之间的位置" max={100} value={agent.progress} />
          <span>Corner Market</span>
          <span className={styles.performance} aria-label="本机实时渲染指标">{fps > 0 ? `${fps} FPS · ${(readyTime / 1000).toFixed(1)} s` : ''}</span>
        </div>
        {state === 'fallback' && (
          <div className={styles.fallbackLinks}>
            <a href="/nexciv-walk/poster.webp">中央广场鸟瞰</a>
            <a href="/nexciv-walk/market.webp">Corner Market 门前</a>
          </div>
        )}
      </footer>
    </div>
  );
}
