/**
 * ชื่อ processor และรูปแบบ `processorOptions` ที่ main thread (`talkAudio.ts`) กับ worklet ใช้ร่วมกัน
 *
 * ไฟล์นี้ต้องไม่มีโค้ดที่อ้าง global ของ AudioWorkletGlobalScope — main thread import ได้อย่างปลอดภัย
 * (ต่างจาก `*.worklet.ts` ที่ประกาศ class ต่อจาก `AudioWorkletProcessor` ตอนโหลดไฟล์)
 */
export const TALK_PROCESSOR = { capture: 'talk-capture', playback: 'talk-playback' } as const;

export type CaptureProcessorOptions = { targetRate: number; frameSamples: number };

export type PlaybackProcessorOptions = { sourceRate: number };
