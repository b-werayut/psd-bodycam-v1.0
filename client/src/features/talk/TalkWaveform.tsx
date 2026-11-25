import { useEffect, useRef } from 'react';

import {
  barScale,
  pushHistory,
  stepEnvelope,
  WAVE_PUSH_EVERY_FRAMES,
  waveLevel,
} from './waveformLevels';

const BAR_WIDTH_PX = 2;
const BAR_STEP_PX = 3;

/**
 * วาดประวัติระดับเสียงเป็นแท่งที่ไหลไปทางซ้าย (port จาก drawWave ของ React Bits "Voice Pill")
 * แท่งใหม่สุดอยู่ขวา (ติดเวลา) · แท่งเก่าจางหายใน 55% ทางซ้าย · ความทึบตามระดับเสียง
 */
function paint(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  history: readonly number[],
  tick: number,
  color: string,
): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  const barWidth = BAR_WIDTH_PX * dpr;
  const step = BAR_STEP_PX * dpr;
  const shift = (tick / WAVE_PUSH_EVERY_FRAMES) * step;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = color;
  for (let i = 0; i < history.length; i += 1) {
    const level = history[history.length - 1 - i];
    const x = width - (i + 1) * step - shift;
    if (x + barWidth < 0) break;
    const barHeight = Math.max(barWidth, barScale(level) * height);
    const t = Math.min(1, Math.max(0, (x + barWidth / 2) / (width * 0.55)));
    ctx.globalAlpha = (0.35 + 0.65 * level) * (t * t * (3 - 2 * t));
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(x, (height - barHeight) / 2, barWidth, barHeight, barWidth / 2);
    } else {
      ctx.rect(x, (height - barHeight) / 2, barWidth, barHeight);
    }
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/**
 * แถบคลื่นเสียงใน voice pill — วาดบน canvas ทุก frame (ไม่ setState จึงไม่ทำให้ TalkControl render ตาม)
 * สีอ่านจาก CSS `color` ของ canvas เอง จึงตามธีมสว่าง/มืด
 * หยุดวาดเมื่อสายจบ (ภาพสุดท้ายค้างไว้ระหว่างจางออก)
 */
export function TalkWaveform({
  active,
  muted,
  readLevel,
}: {
  active: boolean;
  muted: boolean;
  readLevel: () => number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sourceRef = useRef({ muted, readLevel });
  sourceRef.current = { muted, readLevel };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!active || !canvas || typeof window.requestAnimationFrame !== 'function') return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    // อ่านสีใหม่ทุกครั้งที่ดันแท่ง — ผู้ใช้สลับธีมระหว่างคุยได้ ถ้าอ่านครั้งเดียวแท่งจะกลืนพื้นหลัง
    let color = getComputedStyle(canvas).color;
    let history: number[] = [];
    let envelope = 0;
    let peak = 0;
    let tick = 0;
    let last = performance.now();
    let raf = 0;

    const draw = (now: number) => {
      const source = sourceRef.current;
      const target = source.muted ? 0 : waveLevel(source.readLevel());
      envelope = stepEnvelope(envelope, target, now - last);
      last = now;
      peak = Math.max(peak, envelope);
      tick = (tick + 1) % WAVE_PUSH_EVERY_FRAMES;
      if (tick === 0) {
        history = pushHistory(history, peak);
        peak = 0;
        color = getComputedStyle(canvas).color;
      }
      paint(ctx, canvas, history, tick, color);
      raf = window.requestAnimationFrame(draw);
    };

    raf = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(raf);
  }, [active]);

  // decorative: hidden from assistive tech and never focusable
  return <canvas ref={canvasRef} className="voice-pill__wave" aria-hidden="true" tabIndex={-1} />;
}
