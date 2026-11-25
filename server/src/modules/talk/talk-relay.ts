import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';
import WebSocket, { WebSocketServer, type RawData } from 'ws';
import { TALK_PROVIDER, type TalkAudioChannel, type TalkProvider } from './provider/talk-provider.interface';
import {
  TALK_CLOSE_CODE,
  TALK_END_REASON,
  TALK_MAX_PAYLOAD_BYTES,
  TALK_WS_PATH,
  browserCodeForUpstreamClose,
  closeReasonFor,
  endReasonForBrowserClose,
  endReasonForUpstreamClose,
  upstreamCodeForBrowserClose,
  type TalkEndReason,
} from './talk-constants';
import { UplinkFrameGuard, isValidDownlinkFrame, rawDataToBuffer, uplinkFrameBytes } from './talk-frames';
import { isTalkWsRequest, talkTicketFromUrl, type TalkSessionRow } from './talk-ticket';
import { TalkService, type TalkClosedBy } from './talk.service';

export const TALK_RELAY_OPTIONS = Symbol('TALK_RELAY_OPTIONS');

/** ค่าที่เทสต์ปรับได้ — แก้ object ที่ได้จาก app.get(TALK_RELAY_OPTIONS) ก่อนเปิดสาย */
export type TalkRelayOptions = { revalidateMs: number };

type TalkCall = {
  row: TalkSessionRow;
  browser: WebSocket;
  upstream: TalkAudioChannel | null;
  guard: UplinkFrameGuard;
  timer: NodeJS.Timeout | null;
  checking: boolean;
  finished: boolean;
};

type CallOutcome = {
  /** null = browser ปิดเองอยู่แล้ว */
  browserCode: number | null;
  /** null = FastAPI ปิดเองอยู่แล้ว หรือยังต่อไม่ติด */
  upstreamCode: number | null;
  /** null = row ถูกปิดไปก่อนแล้ว (revalidate / REST stop) */
  reason: TalkEndReason | null;
  closeCode: number | null;
  closedBy: TalkClosedBy;
};

/**
 * WebSocket path แยกจาก Socket.IO (ไม่เพิ่ม event ของ Socket.IO) — เกาะ event `upgrade` ของ HTTP server เอง
 * รับเฉพาะ pathname /api/talk/ws · ส่งต่อ PCM16LE สองทางระหว่าง browser กับ FastAPI ·
 * ไม่ log และไม่เก็บเสียงเลย (PDPA)
 */
@Injectable()
export class TalkRelay implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(TalkRelay.name);
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: TALK_MAX_PAYLOAD_BYTES });
  private readonly calls = new Set<TalkCall>();
  private server: HttpServer | null = null;

  private readonly onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    if (!isTalkWsRequest(req.url)) return; // path อื่น (เช่น /socket.io/) เป็นของ engine.io
    void this.accept(req, socket, head);
  };

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly talk: TalkService,
    @Inject(TALK_PROVIDER) private readonly provider: TalkProvider,
    @Inject(TALK_RELAY_OPTIONS) private readonly options: TalkRelayOptions,
  ) {}

  onApplicationBootstrap(): void {
    const adapter = this.adapterHost.httpAdapter;
    if (!adapter) return; // โปรเซส worker (createApplicationContext) ไม่มี HTTP server
    this.server = adapter.getHttpServer() as HttpServer;
    this.server.on('upgrade', this.onUpgrade);
  }

  async onModuleDestroy(): Promise<void> {
    this.server?.off('upgrade', this.onUpgrade);
    this.server = null;
    await Promise.allSettled([...this.calls].map((call) => this.shutdown(call)));
    this.wss.close();
  }

  private async accept(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    // socket ของ upgrade ยังไม่มี listener ของ error — client ตัดระหว่างรอ DB แล้วโปรเซสล้มได้
    socket.on('error', (error: Error) => this.logger.debug(`socket ของ ${TALK_WS_PATH}: ${error.message}`));

    const ticket = talkTicketFromUrl(req.url);
    let row: TalkSessionRow | null = null;
    if (ticket) {
      try {
        row = await this.talk.consumeTicket(ticket);
      } catch (error) {
        this.logger.error(`ใช้ ticket ของ WS เสียงไม่สำเร็จ: ${(error as Error).message}`);
      }
    }

    if (!socket.writable) {
      // browser ไปแล้ว (หรือ engine.io ตัดเพราะเกิน 1 วินาที) — ticket ถูกใช้ไปแล้วจึงต้องปิดสายเอง
      if (row) void this.talk.hangUp(row, TALK_END_REASON.DISCONNECTED, { closeCode: null, closedBy: 'browser' });
      return;
    }

    // ตอบ 101 ทันทีหลังใช้ ticket แล้วค่อยต่อ FastAPI — engine.io ทำลาย upgrade ที่ไม่ใช่ของตัวเอง
    // ถ้ายังไม่มีไบต์ตอบกลับภายใน 1 วินาที (destroyUpgradeTimeout)
    this.wss.handleUpgrade(req, socket, head, (browser) => {
      browser.on('error', (error: Error) => this.logger.warn(`WS เสียงฝั่ง browser error: ${error.message}`));
      if (!row) {
        // ticket ผิด / หมดอายุ / ใช้แล้ว — รับ upgrade แล้วปิด 4401 ให้ browser แปล code เป็นข้อความได้
        browser.close(TALK_CLOSE_CODE.TICKET, closeReasonFor(TALK_CLOSE_CODE.TICKET));
        return;
      }
      this.begin(row, browser);
    });
  }

  private begin(row: TalkSessionRow, browser: WebSocket): void {
    if (!row.VendorTalkId || row.UplinkSampleRate === null || row.FrameMs === null) {
      this.logger.error(`สาย ${row.Id} ไม่มีข้อมูลจาก FastAPI ครบ — ตัดสาย`);
      browser.close(TALK_CLOSE_CODE.VENDOR_ERROR, closeReasonFor(TALK_CLOSE_CODE.VENDOR_ERROR));
      void this.talk.hangUp(row, TALK_END_REASON.VENDOR_ERROR, {
        closeCode: TALK_CLOSE_CODE.VENDOR_ERROR,
        closedBy: 'system',
      });
      return;
    }

    const call: TalkCall = {
      row,
      browser,
      upstream: null,
      // ขนาด frame มาจากค่าที่ FastAPI ตอบตอน start (8000 Hz × 40 ms = 640 byte) — ไม่ฮาร์ดโค้ด
      guard: new UplinkFrameGuard(uplinkFrameBytes(row.UplinkSampleRate, row.FrameMs)),
      timer: null,
      checking: false,
      finished: false,
    };
    this.calls.add(call);
    browser.on('message', (data: RawData, isBinary: boolean) => this.fromBrowser(call, data, isBinary));
    browser.on('close', (code: number) => this.onBrowserClose(call, code));
    void this.connectUpstream(call, row.VendorTalkId);
  }

  private async connectUpstream(call: TalkCall, talkId: string): Promise<void> {
    let channel: TalkAudioChannel;
    try {
      channel = await this.provider.openAudio(talkId);
    } catch (error) {
      this.logger.error(`ต่อช่องเสียงของสาย ${call.row.Id} ไม่สำเร็จ: ${(error as Error).message}`);
      this.finish(call, {
        browserCode: TALK_CLOSE_CODE.VENDOR_ERROR,
        upstreamCode: null,
        reason: TALK_END_REASON.VENDOR_ERROR,
        closeCode: TALK_CLOSE_CODE.VENDOR_ERROR,
        closedBy: 'vendor',
      });
      return;
    }
    if (call.finished) {
      // browser ไปก่อนที่ FastAPI จะต่อติด
      channel.close(TALK_CLOSE_CODE.GOING_AWAY, closeReasonFor(TALK_CLOSE_CODE.GOING_AWAY));
      return;
    }
    call.upstream = channel;
    channel.onMessage((frame) => this.fromUpstream(call, frame));
    channel.onClose((code) => this.onUpstreamClose(call, code));
    call.browser.send(JSON.stringify({ type: 'ready' }));
    call.timer = setInterval(() => void this.revalidate(call), this.options.revalidateMs);
    call.timer.unref();
  }

  private fromBrowser(call: TalkCall, data: RawData, isBinary: boolean): void {
    if (call.finished) return;
    const frame = rawDataToBuffer(data);
    // browser ส่งได้แค่ PCM เป็น binary — text / ขนาดผิด / เกิน 75 frame ต่อวินาที = ปิด 1008
    if (!isBinary || call.guard.check(frame.length, Date.now()) !== 'ok') {
      this.finish(call, {
        browserCode: TALK_CLOSE_CODE.FRAME,
        upstreamCode: TALK_CLOSE_CODE.FRAME,
        reason: TALK_END_REASON.DISCONNECTED,
        closeCode: TALK_CLOSE_CODE.FRAME,
        closedBy: 'system',
      });
      return;
    }
    call.upstream?.send(frame); // ก่อน ready ยังไม่มีขา FastAPI — ทิ้ง
  }

  private fromUpstream(call: TalkCall, frame: Buffer): void {
    if (call.finished || call.browser.readyState !== WebSocket.OPEN) return;
    if (!isValidDownlinkFrame(frame.length)) {
      this.logger.debug(`ทิ้ง frame ขาลงขนาด ${frame.length} byte ของสาย ${call.row.Id}`);
      return;
    }
    call.browser.send(frame, { binary: true });
  }

  private onBrowserClose(call: TalkCall, code: number): void {
    this.finish(call, {
      browserCode: null,
      upstreamCode: upstreamCodeForBrowserClose(code),
      reason: endReasonForBrowserClose(code),
      closeCode: code,
      closedBy: 'browser',
    });
  }

  private onUpstreamClose(call: TalkCall, code: number): void {
    this.finish(call, {
      browserCode: browserCodeForUpstreamClose(code),
      upstreamCode: null,
      reason: endReasonForUpstreamClose(code),
      closeCode: code,
      closedBy: 'vendor',
    });
  }

  private async revalidate(call: TalkCall): Promise<void> {
    if (call.finished || call.checking) return;
    call.checking = true;
    try {
      const verdict = await this.talk.revalidate(call.row.Id);
      if (!verdict.ok) {
        // 4006 = revalidate ปิด row + เขียน audit ให้แล้ว · 4004 = row ถูกปิดไปก่อน (เช่น REST stop ที่ instance อื่น)
        this.finish(call, {
          browserCode: verdict.closeCode,
          upstreamCode: verdict.closeCode,
          reason: null,
          closeCode: verdict.closeCode,
          closedBy: 'system',
        });
      }
    } catch (error) {
      // DB ใช้ไม่ได้ = ไม่มีใครเขียนการถอนสิทธิ์ลง DB ได้เช่นกัน จึงปล่อยสายไว้แล้วตรวจใหม่รอบหน้า
      this.logger.warn(`ตรวจสิทธิ์ของสาย ${call.row.Id} ไม่สำเร็จ: ${(error as Error).message}`);
    } finally {
      call.checking = false;
    }
  }

  /** ฝั่งใดปิด ให้ปิดอีกฝั่งด้วย code ที่แปลแล้ว + ปิด row ครั้งเดียว (spec: "ฝั่งใดปิด ให้ปิดอีกฝั่งด้วย code เดียวกัน") */
  private finish(call: TalkCall, outcome: CallOutcome): void {
    if (!this.settle(call)) return;
    if (outcome.upstreamCode !== null) {
      call.upstream?.close(outcome.upstreamCode, closeReasonFor(outcome.upstreamCode));
    }
    if (outcome.browserCode !== null && call.browser.readyState === WebSocket.OPEN) {
      call.browser.close(outcome.browserCode, closeReasonFor(outcome.browserCode));
    }
    if (outcome.reason !== null) {
      void this.talk.hangUp(call.row, outcome.reason, {
        closeCode: outcome.closeCode,
        closedBy: outcome.closedBy,
      });
    }
  }

  private async shutdown(call: TalkCall): Promise<void> {
    if (!this.settle(call)) return;
    call.upstream?.close(TALK_CLOSE_CODE.GOING_AWAY, closeReasonFor(TALK_CLOSE_CODE.GOING_AWAY));
    // browser ได้ 1006 = "สายหลุด" ซึ่ง client แปลได้อยู่แล้ว — ไม่เพิ่ม close code ใหม่ให้ขา browser
    call.browser.terminate();
    await this.talk.hangUp(call.row, TALK_END_REASON.DISCONNECTED, { closeCode: null, closedBy: 'system' });
  }

  /** ปิดสายได้ครั้งเดียว — คืน false ถ้ามีอีกฝั่งปิดไปแล้ว */
  private settle(call: TalkCall): boolean {
    if (call.finished) return false;
    call.finished = true;
    this.calls.delete(call);
    if (call.timer) clearInterval(call.timer);
    call.timer = null;
    return true;
  }
}
