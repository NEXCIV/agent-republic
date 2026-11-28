'use client';

import { useEffect, useRef, useState } from 'react';
import { createStage, durations, loadLanes, type Character, type Motion, type View } from './stage';
import styles from './motion.module.css';

const characters = [['02', '02 建设工人'], ['06', '06 商业服务']] as const;
const motions = [['walk', '走路与停步'], ['turn', '向右转身']] as const;
const views = [['front', '斜前方'], ['side', '侧面']] as const;

export default function MotionPreview() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const slider = useRef<HTMLInputElement>(null);
  const elapsed = useRef<HTMLOutputElement>(null);
  const position = useRef(0);
  const data = useRef<Awaited<ReturnType<typeof loadLanes>> | null>(null);
  const [character, setCharacter] = useState<Character>('02');
  const [motion, setMotion] = useState<Motion>('walk');
  const [view, setView] = useState<View>('side');
  const [paused, setPaused] = useState(false);
  const [rate, setRate] = useState(1);
  const [loaded, setLoaded] = useState<Character>();
  const [error, setError] = useState('');
  const [renderError, setRenderError] = useState('');
  const settings = useRef({ motion, view, paused, rate });

  useEffect(() => { settings.current = { motion, view, paused, rate }; }, [motion, view, paused, rate]);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const preferPause = () => { if (media.matches) setPaused(true); };
    preferPause();
    media.addEventListener('change', preferPause);
    return () => media.removeEventListener('change', preferPause);
  }, []);

  useEffect(() => {
    const request = new AbortController();
    loadLanes(character, request.signal).then((lanes) => {
      if (request.signal.aborted) {
        lanes.dispose();
        return;
      }
      data.current = lanes;
      position.current = 0;
      setLoaded(character);
    }).catch(() => {
      if (!request.signal.aborted) setError('模型或动作加载失败，请刷新后重试。');
    });
    return () => {
      request.abort();
      data.current?.dispose();
      data.current = null;
    };
  }, [character]);

  useEffect(() => {
    const element = canvas.current!;
    let stage: ReturnType<typeof createStage>;
    try {
      stage = createStage(element);
    } catch {
      setRenderError('当前浏览器无法显示 3D，请开启 WebGL 后刷新。');
      return;
    }
    let frame = 0;
    let previous = 0;
    let lastDrawn: { key: string; data: typeof data.current } | undefined;
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      const { motion, view, paused, rate } = settings.current;
      const dt = Math.min((now - previous) / 1000, 0.075);
      previous = now;
      if (!data.current) return;
      if (!paused) position.current = (position.current + dt * rate) % durations[motion];
      const time = position.current;
      const key = `${motion}/${view}/${time}/${element.clientWidth}/${element.clientHeight}`;
      if (key === lastDrawn?.key && lastDrawn?.data === data.current) return;
      stage.draw(data.current, motion, view, time);
      lastDrawn = { key, data: data.current };
      if (slider.current) slider.current.value = String(time);
      if (elapsed.current) elapsed.current.value = `${time.toFixed(2)} s`;
    };
    const contextLost = (event: Event) => {
      event.preventDefault();
      setRenderError('3D 已暂停，正在恢复渲染。');
      cancelAnimationFrame(frame);
    };
    const contextRestored = () => {
      lastDrawn = undefined;
      previous = performance.now();
      setRenderError('');
      frame = requestAnimationFrame(draw);
    };
    element.addEventListener('webglcontextlost', contextLost);
    element.addEventListener('webglcontextrestored', contextRestored);
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      element.removeEventListener('webglcontextlost', contextLost);
      element.removeEventListener('webglcontextrestored', contextRestored);
      stage.dispose();
    };
  }, []);

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <div>
          <a href="/nexciv-preview" className={styles.brand}>NEXCIV CITY</a>
          <h1>角色动作对照</h1>
        </div>
        <a href="/nexciv-preview" className={styles.back}>返回城市</a>
      </header>
      <div className={styles.controls}>
        <div className={styles.buttons} role="group" aria-label="角色">
          {characters.map(([id, label]) => (
            <button key={id} type="button" aria-pressed={character === id} onClick={() => {
              if (character !== id) {
                setError('');
                setLoaded(undefined);
                setCharacter(id);
              }
            }}>{label}</button>
          ))}
        </div>
        <div className={styles.buttons} role="group" aria-label="动作">
          {motions.map(([id, label]) => (
            <button key={id} type="button" aria-pressed={motion === id} onClick={() => {
              position.current = 0;
              setMotion(id);
            }}>{label}</button>
          ))}
        </div>
        <div className={styles.buttons} role="group" aria-label="观察角度">
          {views.map(([id, label]) => (
            <button key={id} type="button" aria-pressed={view === id} onClick={() => setView(id)}>{label}</button>
          ))}
        </div>
      </div>
      <div className={styles.comparison} aria-busy={!error && !renderError && loaded !== character}>
        <div className={styles.laneNames}>
          <span>100STYLE 真人动捕</span>
          <span>Quaternius</span>
        </div>
        <div className={styles.stage}>
          <canvas ref={canvas} aria-label="左侧 100STYLE 真人动捕，右侧 Quaternius，同步播放" />
          <div className={styles.divider} />
          {(error || renderError || loaded !== character) && (
            <p className={styles.status} role="status">{renderError || error || '正在加载角色与动作…'}</p>
          )}
        </div>
        <div className={styles.player}>
          <button type="button" onClick={() => setPaused(!paused)}>{paused ? '播放' : '暂停'}</button>
          <button type="button" aria-pressed={rate === 0.5} onClick={() => setRate(rate === 1 ? 0.5 : 1)}>0.5×</button>
          <input ref={slider} aria-label="动作进度" type="range" min="0" max={durations[motion]} step="0.01" defaultValue="0"
            onChange={(event) => {
              position.current = event.currentTarget.valueAsNumber;
              setPaused(true);
            }} />
          <output ref={elapsed}>0.00 s</output>
        </div>
      </div>
      <p className={styles.credits}>
        两边共用落脚点，可用慢放比较摆臂、抬脚和鞋底角度。
        {motion === 'turn' && ' 转身步点由项目制作。'}
      </p>
      <p className={styles.credits}>
        <a href="https://zenodo.org/records/8127870">100STYLE</a> · Ian Mason、Sebastian Starke、Taku Komura · <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a> · 已裁切及重定向
        {' ｜ '}<a href="https://quaternius.itch.io/universal-animation-library">Quaternius Universal Animation Library</a> · CC0 · 已重定向
      </p>
    </main>
  );
}
