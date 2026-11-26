import { Logger } from '@nestjs/common';
import WebSocket, { type RawData } from 'ws';
import { dssAuthorizationHeader, dssRequest } from '../../../common/dss/dss-auth';
import type { DssConfig } from '../../../common/dss/dss-config';
import {
  TALK_MESSAGE,
  TALK_START_TIMEOUT_MS,
  TALK_VENDOR_CODE,
  talkBusyMessage,
} from '../talk-constants';
import { rawDataToBuffer } from '../talk-frames';
import {
  TalkProviderError,
  type TalkAudioChannel,
  type TalkProvider,
  type TalkStartInput,
  type TalkStartResult,
} from './talk-provider.interface';

const DSS_SUCCESS_CODE = 1000;
/** vendor desc goes only into the log / ErrorMessage detail, cut to this length; never into userMessage */
const DESC_MAX = 200;

type FastApiBody = { code?: number; desc?: string; data?: unknown };

/**
 * DSS_DRIVER=dss — talks to the middleware (psd-bwc-dss-services), which runs the RTSP talk with DSS.
 * Auth = per-request HS256 JWT from DSS_API_KEY (same as the live provider). Error messages and logs
 * never carry URLs or response bodies.
 */
export class DssTalkProvider implements TalkProvider {
  private readonly logger = new Logger(DssTalkProvider.name);

  constructor(private readonly config: DssConfig) {
    if (!config.baseUrl || !config.apiKey) throw new Error('DssTalkProvider needs DSS_BASE_URL and DSS_API_KEY');
  }

  private get baseUrl(): string {
    return (this.config.baseUrl as string).replace(/\/+$/, '');
  }

  async start(input: TalkStartInput): Promise<TalkStartResult> {
    // FastAPI ทำ StartTalk + RTSP handshake ในคำขอเดียว — DSS ตอบ DESCRIBE หลัง ~10.4 วินาที (spike) จึงรอได้ 30 วินาที
    const body = await this.post(
      'start',
      { deviceCode: input.vendorDeviceId, maxSeconds: input.maxSeconds },
      TALK_START_TIMEOUT_MS,
    );
    if (body.code !== DSS_SUCCESS_CODE) throw talkStartError(body);
    return parseTalkStartData(body.data);
  }

  async stop(talkId: string): Promise<void> {
    const body = await this.post('stop', { talkId });
    if (body.code !== DSS_SUCCESS_CODE) {
      throw new TalkProviderError(
        TALK_MESSAGE.SYSTEM_ERROR,
        body.code ?? null,
        `FastAPI rejected stop (code=${String(body.code)}${body.desc ? `: ${body.desc.trim().slice(0, DESC_MAX)}` : ''})`,
      );
    }
  }

  async openAudio(talkId: string): Promise<TalkAudioChannel> {
    const url = `${this.baseUrl.replace(/^http/i, 'ws')}/api/v1/talk/${encodeURIComponent(talkId)}/audio`;
    const socket = new WebSocket(url, {
      headers: { Authorization: await dssAuthorizationHeader(this.config.apiKey as string) },
      handshakeTimeout: this.config.timeoutMs,
    });
    // ต้องมี listener ของ error ตลอดอายุ socket — error หลังต่อติดที่ไม่มีคนรับทำโปรเซสล้ม
    socket.on('error', (error: Error) =>
      this.logger.warn(`audio WS to FastAPI error: ${error.message}`),
    );
    try {
      await waitForOpen(socket);
    } catch (error) {
      socket.terminate();
      throw new TalkProviderError(
        TALK_MESSAGE.SYSTEM_ERROR,
        null,
        `audio WS to FastAPI failed to connect: ${(error as Error).message}`,
      );
    }
    return new WsTalkAudioChannel(socket);
  }

  private async post(
    action: 'start' | 'stop',
    payload: Record<string, unknown>,
    timeoutMs: number = this.config.timeoutMs,
  ): Promise<FastApiBody> {
    const url = `${this.baseUrl}/api/v1/talk/${action}`;
    let res: { status: number; text: string };
    try {
      res = await dssRequest(
        url,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json;charset=UTF-8',
            Authorization: await dssAuthorizationHeader(this.config.apiKey as string),
          },
          body: JSON.stringify(payload),
        },
        timeoutMs,
      );
    } catch (error) {
      throw new TalkProviderError(TALK_MESSAGE.SYSTEM_ERROR, null, (error as Error).message);
    }
    const text = res.text;
    let body: FastApiBody | null = null;
    try {
      body = JSON.parse(text) as FastApiBody;
    } catch {
      body = null;
    }
    // FastAPI ตอบรูปแบบ {code, desc, data} ได้แม้ HTTP ไม่ใช่ 2xx — เชื่อ code ก่อน HTTP status
    if (body !== null && typeof body.code === 'number') return body;
    throw new TalkProviderError(
      TALK_MESSAGE.SYSTEM_ERROR,
      null,
      `FastAPI replied ${res.status} (not the {code, desc} format)`,
    );
  }
}

class WsTalkAudioChannel implements TalkAudioChannel {
  constructor(private readonly socket: WebSocket) {}

  send(frame: Buffer): void {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(frame, { binary: true });
  }

  close(code: number, reason: string): void {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.close(code, reason);
  }

  onMessage(listener: (frame: Buffer) => void): void {
    this.socket.on('message', (data: RawData, isBinary: boolean) => {
      if (isBinary) listener(rawDataToBuffer(data));
    });
  }

  onClose(listener: (code: number, reason: string) => void): void {
    this.socket.on('close', (code: number, reason: Buffer) => listener(code, reason.toString('utf8')));
  }
}

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      socket.off('open', onOpen);
      socket.off('error', onError);
      socket.off('close', onClose);
    };
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onClose = (code: number) => {
      cleanup();
      reject(new Error(`closed before connecting (code ${code})`));
    };
    socket.on('open', onOpen);
    socket.on('error', onError);
    socket.on('close', onClose);
  });
}

/** code ของ FastAPI → ข้อความผู้ใช้ตามตาราง "Error handling" ของ spec */
export function talkStartError(body: FastApiBody): TalkProviderError {
  const desc = body.desc?.trim().slice(0, DESC_MAX) ?? '';
  const detail = `FastAPI rejected start (code=${String(body.code)}${desc ? `: ${desc}` : ''})`;
  switch (body.code) {
    case TALK_VENDOR_CODE.DEVICE_REJECTED:
      return new TalkProviderError(
        TALK_MESSAGE.DEVICE_NOT_READY,
        body.code,
        detail,
      );
    case TALK_VENDOR_CODE.RTSP_FAILED:
      return new TalkProviderError(TALK_MESSAGE.RTSP_FAILED, body.code, detail);
    case TALK_VENDOR_CODE.CODEC_UNSUPPORTED:
      return new TalkProviderError(TALK_MESSAGE.CODEC_UNSUPPORTED, body.code, detail);
    case TALK_VENDOR_CODE.BUSY:
      // FastAPI รู้แค่ว่าอุปกรณ์มีสายใน registry ไม่รู้ว่าใคร
      return new TalkProviderError(talkBusyMessage(null), body.code, detail);
    default:
      return new TalkProviderError(TALK_MESSAGE.SYSTEM_ERROR, body.code ?? null, detail);
  }
}

export function parseTalkStartData(data: unknown): TalkStartResult {
  const raw = (data ?? {}) as Record<string, unknown>;
  const talkId = typeof raw.talkId === 'string' ? raw.talkId.trim() : '';
  const uplinkSampleRate = Number(raw.uplinkSampleRate);
  const downlinkSampleRate = Number(raw.downlinkSampleRate);
  const frameMs = Number(raw.frameMs);
  const positive = (n: number) => Number.isInteger(n) && n > 0;
  const valid =
    talkId.length > 0 &&
    talkId.length <= 64 &&
    positive(uplinkSampleRate) &&
    positive(downlinkSampleRate) &&
    positive(frameMs) &&
    Number.isInteger((uplinkSampleRate * frameMs) / 1000);
  if (!valid) {
    throw new TalkProviderError(
      TALK_MESSAGE.SYSTEM_ERROR,
      null,
      'FastAPI start response data is incomplete',
    );
  }
  return { talkId, uplinkSampleRate, downlinkSampleRate, frameMs };
}
