'use client';

import { useEffect, useRef } from 'react';

/**
 * Hero halftone field, ported 1:1 from the reference site's stage shader
 * (petercsipkay.com — `_astro/stage.-EI3Vqn_.js`, TSL / WebGL).
 *
 * Reference behaviour (decoded from the original node material):
 * - A 14 CSS px square grid of soft square dots; per-cell size jitter 0.75–1.25.
 * - Dot radius G = H*0.3 + 0.03 (cell units); alpha = H*0.55 + 0.03.
 * - Intensity H = max(N, P) + B + V + F, clamped to 0..1:
 *     N = 0.9 * (1 - smoothstep(-0.28, 0.04, hexM)) — a large hexagonal cloud
 *         anchored at the RIGHT edge (restCenter = (aspect, 0.35)) with a slow
 *         Lissajous drift (amplitudes 0.02–0.035). It does NOT follow the mouse.
 *     P = 0.24 * (1 - smoothstep(-0.05, 0.01, hexM)) — softens the cloud rim.
 *     B = smoothstep(0.55, 0.95, R) * mix(0.1, 0.32, x/aspect) — sparse
 *         twinkling dots in slow travelling bands, denser to the right.
 *     V = (1 - smoothstep(0, 0.4, d(mouse)))^2 * strength * 0.55 — the mouse
 *         only brightens dots locally (strength eases at 0.05, mouse at 0.08).
 *     F = (sin(x*5 + t*0.2) * sin(y*6.3 - t*0.16) * .5 + .5) * 0.07 — ambient wave.
 * - Colour = mix(#FBE052, #FFF9EC, smoothstep(0.74, 0.96, H)): gold rim,
 *   cream-white core.
 * - prefers-reduced-motion: one static frame, light at rest, no pointer events.
 *
 * Canvas 2D approximates the per-pixel shader by sampling H at cell centres,
 * which is visually equivalent because the field varies slowly (cloud rim
 * ~0.3 screen-height units wide vs 14 px cells).
 */

type Rgb = readonly [number, number, number];

const GOLD: Rgb = [251, 224, 82]; // #FBE052 — dim / rim dots
const CREAM: Rgb = [255, 249, 236]; // #FFF9EC — bright core dots
const TAU = Math.PI * 2;
const CELL = 14; // CSS px per grid cell (reference: cells = height / 14)
const SQRT3 = 1.7320508;
const HEX_R = 0.55; // hexagon "radius" in screen-height units

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

const smoothstep = (edge0: number, edge1: number, value: number): number => {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

// Hexagonal SDF around the light centre (exact port of the reference shader).
const hexM = (px: number, py: number): number => {
  const mx = Math.abs(px) - HEX_R;
  const my = py + HEX_R / SQRT3;
  let bx: number;
  let by: number;
  if (mx + SQRT3 * my > 0) {
    bx = (mx - SQRT3 * my) / 2;
    by = (-SQRT3 * mx - my) / 2;
  } else {
    bx = mx;
    by = my;
  }
  const e = bx - clamp(bx, -2 * HEX_R, 0);
  return -Math.hypot(e, by) * Math.sign(by);
};

export function DotField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement ?? null;
    const context = canvas?.getContext('2d') ?? null;
    if (canvas === null || host === null || context === null) return;

    const calm = window.matchMedia('(prefers-reduced-motion: reduce)');
    let width = 0;
    let height = 0;
    let cols = 0;
    let rows = 0;
    let jitters: number[] = [];
    let frame = 0;
    let visible = true;

    // Shader-space pointer state (x in 0..aspect, y in 0..1 from bottom).
    let pointerX = 0;
    let pointerY = 0;
    let targetX = 0;
    let targetY = 0;
    let strength = 0;
    let strengthTarget = 0;

    const resize = (): void => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, canvas.clientWidth);
      height = Math.max(1, canvas.clientHeight);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);

      cols = Math.ceil(width / CELL) + 1;
      rows = Math.ceil(height / CELL) + 1;
      jitters = [];
      for (let j = 0; j < rows; j += 1) {
        for (let i = 0; i < cols; i += 1) {
          const value = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
          jitters.push(value - Math.floor(value));
        }
      }
      if (frame === 0) schedule();
    };

    const draw = (milliseconds: number): void => {
      const time = milliseconds / 1000;
      const aspect = width / height;
      context.clearRect(0, 0, width, height);

      // Light rest position: right edge like the reference; the plan plate is
      // translucent so the cloud glows through it. Slow Lissajous drift.
      const lightX = aspect + Math.sin(time * 0.21) * 0.035 + Math.sin(time * 0.13) * 0.02;
      const lightY = 0.35 + Math.cos(time * 0.17) * 0.03 + Math.sin(time * 0.29) * 0.015;

      // Eased pointer (matches reference rates 0.05 / 0.08).
      strength += (strengthTarget - strength) * 0.05;
      pointerX += (targetX - pointerX) * 0.08;
      pointerY += (targetY - pointerY) * 0.08;

      for (let j = 0; j < rows; j += 1) {
        const py = j * CELL + CELL * 0.5;
        const ny = 1 - py / height; // shader y is bottom-up
        for (let i = 0; i < cols; i += 1) {
          const px = i * CELL + CELL * 0.5;
          const nx = px / height;

          // Hexagonal cloud terms.
          const m = hexM(nx - lightX, ny - lightY);
          const cloud = Math.max(
            (1 - smoothstep(-0.28, 0.04, m)) * 0.9,
            (1 - smoothstep(-0.05, 0.01, m)) * 0.24,
          );

          // Sparse twinkles in travelling bands, denser to the right.
          const jitter = jitters[j * cols + i] ?? 0;
          const band = Math.sin(nx * 3 + time * 0.6 + jitter * TAU) * 0.5 + 0.5;
          const twinkle = smoothstep(0.55, 0.95, band) * (0.1 + 0.22 * (nx / aspect));

          // Local mouse brightening.
          const toMouse = Math.hypot(nx - pointerX, ny - pointerY);
          const mouse = Math.pow(1 - smoothstep(0, 0.4, toMouse), 2) * strength * 0.55;

          // Ambient travelling wave.
          const wave =
            (Math.sin(nx * 5 + time * 0.2) * Math.sin(ny * 6.3 - time * 0.16) * 0.5 + 0.5) * 0.07;

          const h = clamp(cloud + twinkle + mouse + wave, 0, 1);
          if (h < 0.01) continue;

          const alpha = h * 0.55 + 0.03;
          if (alpha < 0.02) continue;

          const radius = (h * 0.3 + 0.03) * (jitter * 0.5 + 0.75);
          const size = radius * CELL * 2;
          const core = smoothstep(0.74, 0.96, h);
          const r = GOLD[0] + (CREAM[0] - GOLD[0]) * core;
          const g = GOLD[1] + (CREAM[1] - GOLD[1]) * core;
          const b = GOLD[2] + (CREAM[2] - GOLD[2]) * core;
          context.fillStyle = `rgba(${r.toFixed(0)},${g.toFixed(0)},${b.toFixed(0)},${alpha.toFixed(3)})`;
          context.fillRect(px - size / 2, py - size / 2, size, size);
        }
      }

      if (!calm.matches && visible && !document.hidden) frame = requestAnimationFrame(draw);
      else frame = 0;
    };

    const schedule = (): void => {
      if (frame === 0) frame = requestAnimationFrame(draw);
    };

    const onPointerMove = (event: PointerEvent): void => {
      if (event.pointerType === 'touch') return;
      const rect = host.getBoundingClientRect();
      const aspect = width / height;
      targetX = ((event.clientX - rect.left) / rect.width) * aspect;
      targetY = 1 - (event.clientY - rect.top) / rect.height;
      strengthTarget = 1;
      schedule();
    };

    const onPointerLeave = (): void => {
      strengthTarget = 0;
      schedule();
    };

    const onVisibility = (): void => {
      if (document.hidden) {
        if (frame !== 0) cancelAnimationFrame(frame);
        frame = 0;
      } else {
        schedule();
      }
    };

    const observer =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver(([entry]) => {
            visible = entry?.isIntersecting === true;
            if (visible) schedule();
            else if (frame !== 0) {
              cancelAnimationFrame(frame);
              frame = 0;
            }
          });
    observer?.observe(canvas);

    resize();
    schedule();
    host.addEventListener('pointermove', onPointerMove);
    host.addEventListener('pointerleave', onPointerLeave);
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      observer?.disconnect();
      host.removeEventListener('pointermove', onPointerMove);
      host.removeEventListener('pointerleave', onPointerLeave);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return <canvas ref={canvasRef} className="dot-field" aria-hidden="true" />;
}
