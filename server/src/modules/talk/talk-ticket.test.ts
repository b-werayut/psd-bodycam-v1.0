import { describe, expect, it } from 'vitest';

import {
  TALK_TICKET_PATTERN,
  createTalkTicket,
  hashTalkTicket,
  isTalkWsRequest,
  talkTicketExpiresAt,
  talkTicketFromUrl,
  talkWsUrl,
} from './talk-ticket';

describe('ticket ของ WS เสียง', () => {
  it('สุ่ม 32 byte เป็น base64url 43 ตัวอักษร และไม่ซ้ำกัน', () => {
    const a = createTalkTicket();
    const b = createTalkTicket();

    expect(a.value).toMatch(TALK_TICKET_PATTERN);
    expect(Buffer.from(a.value, 'base64url')).toHaveLength(32);
    expect(a.value).not.toBe(b.value);
  });

  it('DB เก็บแค่ SHA-256 hex ของ ticket — เทียบค่าอ้างอิงมาตรฐาน', () => {
    expect(hashTalkTicket('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    const ticket = createTalkTicket();
    expect(ticket.hash).toBe(hashTalkTicket(ticket.value));
    expect(ticket.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('หมดอายุ 30 วินาทีหลังออก', () => {
    const now = new Date('2026-09-25T03:00:00.000Z');

    expect(talkTicketExpiresAt(now).toISOString()).toBe('2026-09-25T03:00:30.000Z');
  });

  it('wsUrl เป็น path same-origin ของเราเอง', () => {
    const ticket = 'T'.repeat(43);

    expect(talkWsUrl(ticket)).toBe(`/api/talk/ws?ticket=${ticket}`);
  });
});

describe('แยก upgrade ของ relay ออกจากของ Socket.IO', () => {
  it('รับเฉพาะ pathname /api/talk/ws', () => {
    expect(isTalkWsRequest('/api/talk/ws?ticket=abc')).toBe(true);
    expect(isTalkWsRequest('/api/talk/ws')).toBe(true);
    for (const url of [
      '/socket.io/?EIO=4&transport=websocket',
      '/api/talk/ws/extra',
      '/api/talk/wsx',
      '/api/talk',
      undefined,
    ]) {
      expect(isTalkWsRequest(url), String(url)).toBe(false);
    }
  });

  it('อ่าน ticket จาก query เฉพาะรูปแบบที่ถูกต้อง', () => {
    const ticket = createTalkTicket().value;

    expect(talkTicketFromUrl(`/api/talk/ws?ticket=${ticket}`)).toBe(ticket);
    for (const url of [
      '/api/talk/ws',
      '/api/talk/ws?ticket=',
      '/api/talk/ws?ticket=abc',
      `/api/talk/ws?ticket=${'A'.repeat(42)}=`,
      `/api/talk/ws?other=${ticket}`,
      undefined,
    ]) {
      expect(talkTicketFromUrl(url), String(url)).toBeNull();
    }
  });
});
