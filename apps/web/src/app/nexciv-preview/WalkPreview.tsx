'use client';

import { useEffect, useRef, useState } from 'react';
import { createWalk, type WalkController } from './walk';
import styles from './preview.module.css';

type View = 'overview' | 'walk';

export function WalkPreview() {
  const viewport = useRef<HTMLDivElement>(null);
  const world = useRef<WalkController | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'fallback'>('loading');
  const [view, setView] = useState<View>('overview');
  const [progress, setProgress] = useState(0);
  const [fps, setFps] = useState(0);
  const [readyTime, setReadyTime] = useState(0);

  useEffect(() => {
    const host = viewport.current;
    if (!host) return;
    try {
      const controller = createWalk(host, {
        ready: (elapsed) => { setReadyTime(elapsed); setState('ready'); },
        fallback: () => setState('fallback'),
        progress: setProgress,
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

  function move(direction: number) {
    world.current?.step(direction);
  }

  return (
    <div className={styles.page} lang="zh-CN" data-preview="nexciv-walk">
      <a className={styles.skip} href="#walk-controls">跳到操作</a>
      <header className={styles.header}>
        <span className={styles.brand}>NEXCIV</span>
        <span className={styles.divider} />
        <h1>街区走查</h1>
        <span className={styles.status} role="status">
          {state === 'ready' ? '实时 3D · DEMO' : state === 'loading' ? '正在载入街区' : '静态预览 · DEMO'}
        </span>
      </header>
      <section className={styles.viewer} aria-label="NEXCIV 实时街区">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className={styles.poster} src="/nexciv-walk/poster.webp" alt="Nexus 中央广场和 Corner Market 的黄昏俯视图" />
        <div ref={viewport} className={styles.viewport} data-visual data-live={state === 'ready'} />
        <div className={styles.destination}>
          <small>{view === 'overview' ? 'NEXUS 东南街区' : '步行路线'}</small>
          <strong>{view === 'overview' ? '中央广场' : progress >= 100 ? '已到达 Corner Market' : '前往 Corner Market'}</strong>
        </div>
        {state === 'fallback' && <p className={styles.fallback}>3D 场景暂时无法加载。下方可查看路线的两处实景。</p>}
      </section>
      <footer id="walk-controls" tabIndex={-1} className={styles.footer}>
        <div className={styles.controls}>
          <div className={styles.switcher} aria-label="视角">
            <button disabled={state !== 'ready'} aria-pressed={view === 'overview'} onClick={() => select('overview')}>俯视</button>
            <button disabled={state !== 'ready'} aria-pressed={view === 'walk'} onClick={() => select('walk')}>步行</button>
          </div>
          {view === 'overview' ? (
            <div className={styles.steps} aria-label="缩放">
              <button disabled={state !== 'ready'} onClick={() => world.current?.zoom(1.25)} aria-label="缩小">−</button>
              <button disabled={state !== 'ready'} onClick={() => world.current?.zoom(0.8)} aria-label="放大">+</button>
            </div>
          ) : (
            <div className={styles.steps} aria-label="沿路线行走">
              <button onClick={() => move(-1)} aria-label="后退">↓</button>
              <button onClick={() => move(1)} aria-label="前进">↑</button>
            </div>
          )}
          <button disabled={state !== 'ready'} className={styles.reset} onClick={() => { world.current?.reset(); setView('overview'); }}>重置</button>
          <span className={styles.hint}>
            <span className={styles.desktopHint}>{view === 'overview' ? '拖动旋转 · 滚轮缩放' : '拖动环顾 · W / S 或箭头行走'}</span>
            <span className={styles.touchHint}>{view === 'overview' ? '拖动旋转 · 双指缩放' : '拖动环顾 · 点击箭头行走'}</span>
          </span>
        </div>
        <div className={styles.route}>
          <span>中央广场</span>
          <input
            aria-label="步行路线进度"
            type="range" min={0} max={100} value={progress}
            disabled={state !== 'ready'}
            onChange={(event) => {
              select('walk');
              world.current?.seek(Number(event.target.value));
            }}
          />
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
