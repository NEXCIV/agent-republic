'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { SHARED_AVATARS, type SharedPilotAvatar } from '@/lib/shared-pilot-profiles';
import type { createAvatarTurntable } from './avatar-turntable';
import styles from './join.module.css';

type Turntable = ReturnType<typeof createAvatarTurntable>;

export function AvatarPreview({ avatar }: { avatar: SharedPilotAvatar }) {
  const { label, asset, portrait } = SHARED_AVATARS[avatar];
  const host = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number } | null>(null);
  const [turntable, setTurntable] = useState<Turntable | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const [loaded, setLoaded] = useState<{ asset: string; ok: boolean } | null>(null);
  const [auto, setAuto] = useState(false);
  const ready = !unsupported && loaded?.asset === asset && loaded.ok;
  const failed = unsupported || (loaded?.asset === asset && !loaded.ok);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setAuto(!media.matches);
    sync();
    media.addEventListener('change', sync);
    const element = host.current;
    let disposed = false;
    let preview: Turntable | undefined;
    if (element) {
      void import('./avatar-turntable').then(({ createAvatarTurntable }) => {
        if (disposed) return;
        preview = createAvatarTurntable(element, () => setUnsupported(true));
        setTurntable(preview);
      }).catch(() => { if (!disposed) setUnsupported(true); });
    }
    return () => {
      disposed = true;
      preview?.dispose();
      media.removeEventListener('change', sync);
    };
  }, []);

  useEffect(() => {
    if (!turntable || unsupported) return;
    const controller = new AbortController();
    setLoaded(null);
    void turntable.show(asset, controller.signal).then(() => {
      if (!controller.signal.aborted) setLoaded({ asset, ok: true });
    }).catch(() => {
      if (!controller.signal.aborted) setLoaded({ asset, ok: false });
    });
    return () => controller.abort();
  }, [asset, turntable, unsupported]);

  useEffect(() => { turntable?.play(ready && auto); }, [ready, auto, turntable]);

  function rotate(radians: number) {
    turntable?.play(false);
    turntable?.rotate(radians);
    setAuto(false);
  }

  return <section className={styles.avatarPreview} aria-labelledby="avatar-preview-title">
    <div className={styles.previewInner}>
      <header className={styles.previewHeader}>
        <h2 id="avatar-preview-title">3D 外观预览</h2>
        <p>{label}</p>
      </header>
      <div className={styles.previewStage}>
        <div ref={host} className={styles.previewCanvas} data-ready={ready}
          onPointerDown={(event) => {
            if (!ready || !event.isPrimary || event.button !== 0) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = { id: event.pointerId, x: event.clientX };
            rotate(0);
          }}
          onPointerMove={(event) => {
            if (drag.current?.id !== event.pointerId) return;
            const delta = event.clientX - drag.current.x;
            drag.current.x = event.clientX;
            turntable?.rotate(delta * .012);
          }}
          onLostPointerCapture={() => { drag.current = null; }}
        />
        {!ready && <div className={styles.previewPlaceholder}>
          <Image src={portrait} alt={`${label}正面头像`} width={128} height={128} />
          <p role="status">{failed ? '3D 预览暂不可用' : '正在加载 3D 外观…'}</p>
        </div>}
      </div>
      <div className={styles.previewControls} aria-label="旋转预览" role="group" aria-hidden={!ready}>
        <button type="button" disabled={!ready} aria-label="向左旋转角色" onClick={() => rotate(-Math.PI / 4)}>←</button>
        <button type="button" disabled={!ready} onClick={() => setAuto(!auto)}>{auto ? '暂停旋转' : '自动旋转'}</button>
        <button type="button" disabled={!ready} aria-label="向右旋转角色" onClick={() => rotate(Math.PI / 4)}>→</button>
      </div>
    </div>
  </section>;
}
