import { useCallback, useEffect, useRef, useState } from 'react';

import type { PcmFrame } from './audio/pcm';
import { createTalkAudio, type TalkAudio } from './audio/talkAudio';
import { openTalkSocket, TALK_CLOSE_CODE, talkApi, type TalkStartResponse } from './talk.api';
import {
  isTalkReadyMessage,
  isTalkRetryLaterError,
  MIC_CONSTRAINTS,
  micErrorKey,
  startFailureNotice,
  talkEndedNotice,
  uplinkFrameSamples,
  type TalkNotice,
} from './talkRules';

export type TalkState =
  | 'idle'
  | 'requesting-mic'
  | 'connecting'
  | 'active'
  | 'ending'
  | 'ended'
  | 'error';

export type TalkSession = {
  state: TalkState;
  notice: TalkNotice | null;
  elapsedSeconds: number;
  maxSeconds: number | null;
  muted: boolean;
  micLevel: number;
  /** peak ของ frame ล่าสุด (ทุก ~40 ms) สำหรับวาดแถบคลื่นใน requestAnimationFrame — อ่านจาก ref ไม่ทำให้ render */
  readLevel: () => number;
  start: () => void;
  /** วางสาย (active) หรือยกเลิกระหว่างเชื่อมต่อ */
  hangUp: () => void;
  /** ชื่อเดียวกับ `hangUp` */
  stop: () => void;
  toggleMute: () => void;
};

/** หลังเปิด WS แล้ว server ต้องส่ง {"type":"ready"} ภายในเวลานี้ ไม่งั้นถือว่าต่อไม่ติด */
export const TALK_READY_TIMEOUT_MS = 30_000;

/** อัปเดตแถบระดับเสียงทุก 5 frame — ไม่ render ทุก frame */
const LEVEL_EVERY_FRAMES = 5;

const STARTABLE: ReadonlySet<TalkState> = new Set<TalkState>(['idle', 'ended', 'error']);

/** สายกำลังขอไมค์ / ต่อ / คุย / วาง — ระหว่างนี้จออื่นเริ่มสายไม่ได้ */
export function isTalkBusy(state: TalkState): boolean {
  return !STARTABLE.has(state);
}

type Call = {
  streamToken: string;
  audio: TalkAudio;
  stream: MediaStream | null;
  talkId: string | null;
  maxSeconds: number | null;
  frameBytes: number;
  socket: WebSocket | null;
  ready: boolean;
  readyTimer: number | null;
  clockTimer: number | null;
  levelPeak: number;
  levelFrames: number;
};

/**
 * - `await` = วางสายโดยผู้ใช้ / live session หาย: `stop(id)` ให้เสร็จก่อน แล้วค่อยปิด WS 1000 (ตาม spec)
 * - `background` = สั่ง stop แต่ไม่รอ (start ล้มหลัง server เปิดสายแล้ว · หมดเวลารอ ready · เน็ตหลุด 1006)
 * - `keepalive` = dialog unmount / pagehide — axios ไปไม่ถึงเมื่อหน้าปิด
 * - `none` = server ปิดสายเองแล้ว (4001–4006 · 4401 · 1008) หรือยังไม่มีสายที่ server
 */
type RestStop = 'await' | 'background' | 'keepalive' | 'none';

function releaseCall(call: Call): void {
  call.ready = false;
  if (call.readyTimer !== null) window.clearTimeout(call.readyTimer);
  if (call.clockTimer !== null) window.clearInterval(call.clockTimer);
  call.readyTimer = null;
  call.clockTimer = null;
  call.stream?.getTracks().forEach((track) => track.stop());
  call.audio.close();
  if (call.socket) {
    call.socket.onmessage = null;
    call.socket.onclose = null;
  }
}

async function teardownCall(call: Call, restStop: RestStop): Promise<void> {
  releaseCall(call);
  const talkId = call.talkId;
  if (talkId && restStop === 'await') {
    await Promise.resolve(talkApi.stop(talkId)).catch(() => undefined);
  } else if (talkId && restStop === 'background') {
    void Promise.resolve(talkApi.stop(talkId)).catch(() => undefined);
  } else if (talkId && restStop === 'keepalive') {
    talkApi.stopOnUnload(talkId);
  }
  const socket = call.socket;
  if (socket && socket.readyState !== WebSocket.CLOSING && socket.readyState !== WebSocket.CLOSED) {
    socket.close(TALK_CLOSE_CODE.NORMAL);
  }
}

/**
 * สถานะของสายคุยผ่านกล้อง 1 สาย ผูกกับ live session ที่เปิดอยู่
 * `idle → requesting-mic → connecting (POST start · เปิด WS · รอ ready) → active → ending → ended | error`
 *
 * วางสายเมื่อ: กดวางสาย · live session หาย/เปลี่ยน · server ปิด WS · dialog unmount · `pagehide`
 */
export function useTalkSession(streamSessionToken: string | null): TalkSession {
  const [state, setState] = useState<TalkState>('idle');
  const [notice, setNotice] = useState<TalkNotice | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [maxSeconds, setMaxSeconds] = useState<number | null>(null);
  const [muted, setMuted] = useState(false);
  const [micLevel, setMicLevel] = useState(0);

  const callRef = useRef<Call | null>(null);
  const stateRef = useRef<TalkState>('idle');
  const mutedRef = useRef(false);
  const liveLevelRef = useRef(0);

  const moveTo = useCallback((next: TalkState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  /** จบสายนี้ (ถ้ายังเป็นสายปัจจุบัน) — ขั้นตอน start ที่ยัง await อยู่จะเห็นว่าไม่ใช่สายปัจจุบันแล้วเก็บกวาดเอง */
  const finish = useCallback(
    (call: Call, next: TalkNotice, final: 'idle' | 'ended' | 'error', restStop: RestStop) => {
      if (callRef.current !== call) return;
      callRef.current = null;
      setMicLevel(0);
      if (restStop === 'await') {
        moveTo('ending');
        void teardownCall(call, restStop).then(() => {
          setNotice(next);
          moveTo(final);
        });
        return;
      }
      void teardownCall(call, restStop);
      setNotice(next);
      moveTo(final);
    },
    [moveTo],
  );

  const start = useCallback(() => {
    const token = streamSessionToken;
    if (!token || callRef.current || !STARTABLE.has(stateRef.current)) return;

    const call: Call = {
      streamToken: token,
      // สร้าง AudioContext ใน click handler ตรงนี้ ก่อน await ใด ๆ (Safari)
      audio: createTalkAudio(),
      stream: null,
      talkId: null,
      maxSeconds: null,
      frameBytes: 0,
      socket: null,
      ready: false,
      readyTimer: null,
      clockTimer: null,
      levelPeak: 0,
      levelFrames: 0,
    };
    callRef.current = call;
    const current = () => callRef.current === call;
    mutedRef.current = false;
    liveLevelRef.current = 0;
    setMuted(false);
    setNotice(null);
    setElapsedSeconds(0);
    setMicLevel(0);
    setMaxSeconds(null);
    moveTo('requesting-mic');

    const sendFrame = (frame: PcmFrame) => {
      const socket = call.socket;
      if (!call.ready || !socket || socket.readyState !== WebSocket.OPEN) return;
      // ขนาดไม่พอดี = server ตัดสาย 1008 — ทิ้งไว้ก่อนถึง server
      if (frame.bytes.byteLength !== call.frameBytes) return;
      socket.send(frame.bytes);
      liveLevelRef.current = frame.peak;
      call.levelPeak = Math.max(call.levelPeak, frame.peak);
      call.levelFrames += 1;
      if (call.levelFrames >= LEVEL_EVERY_FRAMES) {
        setMicLevel(call.levelPeak);
        call.levelPeak = 0;
        call.levelFrames = 0;
      }
    };

    const onMessage = (event: MessageEvent) => {
      if (typeof event.data === 'string') {
        if (call.ready || !isTalkReadyMessage(event.data)) return;
        call.ready = true;
        if (call.readyTimer !== null) window.clearTimeout(call.readyTimer);
        call.readyTimer = null;
        const readyAt = Date.now();
        call.clockTimer = window.setInterval(() => {
          setElapsedSeconds(Math.floor((Date.now() - readyAt) / 1000));
        }, 1000);
        moveTo('active');
        return;
      }
      if (call.ready && event.data instanceof ArrayBuffer) call.audio.play(event.data);
    };

    const onClose = (event: CloseEvent) => {
      const wasActive = call.ready;
      finish(
        call,
        talkEndedNotice(event.code, call.maxSeconds ?? 0),
        wasActive ? 'ended' : 'error',
        // 1006 = browser เห็นเน็ตหลุดเอง server อาจยังไม่รู้ · 4401 ก่อน ready = ticket ใช้ไม่ได้ แต่แถวฝั่ง server
        // อาจยัง ACTIVE (เช่น DB ล้มตอน consume) จึงสั่ง stop ด้วย · code อื่น server ปิดสายไปแล้ว
        event.code === TALK_CLOSE_CODE.NETWORK || (event.code === TALK_CLOSE_CODE.TICKET && !wasActive)
          ? 'background'
          : 'none',
      );
    };

    void (async () => {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
      } catch (error) {
        finish(call, { key: micErrorKey(error) }, 'error', 'none');
        return;
      }
      if (!current()) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      call.stream = stream;
      moveTo('connecting');

      let session: TalkStartResponse;
      try {
        session = await talkApi.start(token);
      } catch (error) {
        // 409 busy: แสดงข้อความของ server แล้วกลับสู่ idle เพื่อกดเริ่มใหม่ภายหลังได้ (spec §5.4)
        finish(
          call,
          startFailureNotice(error),
          isTalkRetryLaterError(error) ? 'idle' : 'error',
          'none',
        );
        return;
      }
      if (!current()) {
        void Promise.resolve(talkApi.stop(session.talkSessionId)).catch(() => undefined);
        return;
      }
      call.talkId = session.talkSessionId;
      call.maxSeconds = session.maxSeconds;
      setMaxSeconds(session.maxSeconds);
      const frameSamples = uplinkFrameSamples(session);
      call.frameBytes = frameSamples * 2;

      try {
        await call.audio.connect(stream, {
          uplinkSampleRate: session.uplinkSampleRate,
          downlinkSampleRate: session.downlinkSampleRate,
          frameSamples,
          onFrame: sendFrame,
        });
      } catch {
        finish(call, { key: 'talk.error.audio' }, 'error', 'background');
        return;
      }
      if (!current()) return;

      const socket = openTalkSocket(session.wsUrl);
      socket.onmessage = onMessage;
      socket.onclose = onClose;
      call.socket = socket;
      call.readyTimer = window.setTimeout(() => {
        finish(call, { key: 'talk.error.timeout' }, 'error', 'background');
      }, TALK_READY_TIMEOUT_MS);
    })();
  }, [streamSessionToken, finish, moveTo]);

  const hangUp = useCallback(() => {
    const call = callRef.current;
    if (call) finish(call, { key: 'talk.ended.1000' }, 'ended', 'await');
  }, [finish]);

  const toggleMute = useCallback(() => {
    const stream = callRef.current?.stream;
    if (!stream) return;
    const next = !mutedRef.current;
    mutedRef.current = next;
    // ปิดที่ track = ไมค์เงียบ แต่ frame เงียบยังไหลต่อ DSS จึงไม่ตัดสายเพราะไม่มีเสียง
    stream.getAudioTracks().forEach((track) => {
      track.enabled = !next;
    });
    setMuted(next);
  }, []);

  useEffect(() => {
    const call = callRef.current;
    if (call && call.streamToken !== streamSessionToken) {
      finish(call, { key: 'talk.ended.4006' }, 'ended', 'await');
    }
  }, [streamSessionToken, finish]);

  useEffect(() => {
    const abandon = (): boolean => {
      const call = callRef.current;
      if (!call) return false;
      callRef.current = null;
      void teardownCall(call, 'keepalive');
      return true;
    };
    const onPageHide = () => {
      if (!abandon()) return;
      setMicLevel(0);
      setNotice({ key: 'talk.ended.1000' });
      moveTo('ended');
    };
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      abandon();
    };
  }, [moveTo]);

  const readLevel = useCallback(() => (callRef.current ? liveLevelRef.current : 0), []);

  return {
    state,
    notice,
    elapsedSeconds,
    maxSeconds,
    muted,
    micLevel,
    readLevel,
    start,
    hangUp,
    stop: hangUp,
    toggleMute,
  };
}
