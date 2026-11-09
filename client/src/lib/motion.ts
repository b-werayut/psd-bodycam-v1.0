import type { Transition, Variants } from 'motion/react';

export const DURATION = {
  fast: 0.2,
  base: 0.55,
  exit: 0.24,
} as const;

export const EASE = {
  out: [0.16, 1, 0.3, 1],
  fade: [0.4, 0, 0.6, 1],
  inOut: [0.65, 0, 0.35, 1],
} as const;

export const OFFSET = {
  page: 10,
  item: 6,
} as const;

export const STAGGER = {
  step: 0.04,
  maxSteps: 6,
} as const;

export function staggerDelay(index: number): number {
  const clamped = Math.min(Math.max(index, 0), STAGGER.maxSteps);
  return clamped * STAGGER.step;
}

const enterTransition: Transition = {
  duration: DURATION.base,
  ease: EASE.out,
  opacity: { duration: DURATION.base, ease: EASE.fade },
};

const exitTransition: Transition = {
  duration: DURATION.exit,
  ease: EASE.out,
  opacity: { duration: DURATION.exit, ease: EASE.fade },
};

export const pageVariants: Variants = {
  hidden: { opacity: 0, y: OFFSET.page },
  visible: { opacity: 1, y: 0, transition: enterTransition },
};

/**
 * การ์ดที่ถูกเพิ่ม/นำออกจากตาราง (จอภาพสดหลายจอ) — ขยายเข้า/หดออก ไม่โผล่หรือหายวาบ
 * การ์ดที่เหลือเลื่อนเข้าที่ด้วย `LAYOUT_TRANSITION` (ต้องใช้ feature `domMax` ของ LazyMotion)
 */
export const tileVariants: Variants = {
  hidden: { opacity: 0, scale: 0.94 },
  visible: { opacity: 1, scale: 1, transition: enterTransition },
  exit: { opacity: 0, scale: 0.94, transition: exitTransition },
};

/** สั้นกว่า enter — การ์ดที่เลื่อนต้องเข้าที่ก่อนการ์ดใหม่จางเข้าเสร็จ ไม่งั้นดูเหมือนตามกันไม่ทัน */
export const LAYOUT_TRANSITION: Transition = { duration: 0.38, ease: EASE.inOut };

export const itemVariants: Variants = {
  hidden: { opacity: 0, y: OFFSET.item },
  visible: (index: number) => ({
    opacity: 1,
    y: 0,
    transition: { ...enterTransition, delay: staggerDelay(index) },
  }),
  exit: { opacity: 0, transition: exitTransition },
};
