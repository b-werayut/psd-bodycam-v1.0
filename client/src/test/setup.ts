import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// findBy* / waitFor รอได้ 5 วินาที (ค่าเดิมของ Testing Library 1 วินาที) — ตอนเครื่องทำงานหนัก
// (รันหลายชุดพร้อมกัน / อีก session build อยู่) lazy import + query ช้ากว่า 1 วินาทีจริง
// เทสต์แบ่งหน้าหลายหน้าเคยหมดเวลาแบบสุ่ม (2026-10-07) · ต่ำกว่า testTimeout (30 วิ) ใน vite.config.ts
// ⚠️ อย่าใส่ { timeout } ต่อครั้งที่ต่ำกว่านี้ — ทำให้ข้อนั้นกลับไปเปราะเหมือนเดิม
configure({ asyncUtilTimeout: 5_000 });

if (!('ResizeObserver' in globalThis)) {
  class ResizeObserverStub implements ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = ResizeObserverStub;
}

for (const method of ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture'] as const) {
  if (!(method in Element.prototype)) {
    Object.defineProperty(Element.prototype, method, {
      value: method === 'hasPointerCapture' ? () => false : () => {},
      writable: true,
      configurable: true,
    });
  }
}

// ⚠️ เทสต์ห้ามยิงเครือข่ายจริง — origin ของ jsdom คือ http://localhost:3000 = พอร์ต API ตัว dev
// คำขอที่ลืม mock จึงไปถึงเซิร์ฟเวอร์จริงเมื่อมันรันอยู่ ได้ 401 → interceptor ยิง /auth/refresh → 401
// บล็อกที่ XHR (ทางที่ axios ใช้ใน jsdom) ให้ผลเทสต์ไม่ขึ้นกับว่ามีเซิร์ฟเวอร์รันอยู่หรือไม่ —
// คำขอที่หลุดจะ reject ด้วย error ที่บอก method + URL = เทสต์นั้นต้อง mock API เพิ่ม
const requestTargets = new WeakMap<XMLHttpRequest, string>();
const realOpen = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function open(
  this: XMLHttpRequest,
  method: string,
  url: string | URL,
  ...rest: unknown[]
) {
  requestTargets.set(this, `${method.toUpperCase()} ${String(url)}`);
  return (realOpen as (...args: unknown[]) => void).call(this, method, url, ...rest);
} as typeof XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.send = function send(this: XMLHttpRequest) {
  const target = requestTargets.get(this) ?? 'unknown request';
  throw new Error(`[test setup] real network request blocked: ${target} — mock this API call`);
};

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

HTMLCanvasElement.prototype.getContext = (() =>
  null) as unknown as HTMLCanvasElement['getContext'];

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  configurable: true,
  value: (query: string) => ({
    matches: query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }),
});
