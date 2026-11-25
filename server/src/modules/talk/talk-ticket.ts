import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, sql } from 'drizzle-orm';
import type { DrizzleDB } from '../../db/db.types';
import { TalkSessions } from '../../db/schema';
import { TALK_STATUS, TALK_TICKET_TTL_MS, TALK_WS_PATH } from './talk-constants';

export type TalkSessionRow = typeof TalkSessions.$inferSelect;

export type TalkTicket = { value: string; hash: string };

/** 32 byte ในรูป base64url ไม่มี padding = 43 ตัวอักษรพอดี */
export const TALK_TICKET_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function createTalkTicket(): TalkTicket {
  const value = randomBytes(32).toString('base64url');
  return { value, hash: hashTalkTicket(value) };
}

/** DB เก็บแค่ SHA-256 hex — ticket ตัวจริงอยู่ใน wsUrl ที่ตอบ browser ครั้งเดียว */
export function hashTalkTicket(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function talkTicketExpiresAt(now: Date): Date {
  return new Date(now.getTime() + TALK_TICKET_TTL_MS);
}

export function talkWsUrl(ticket: string): string {
  return `${TALK_WS_PATH}?ticket=${ticket}`;
}

function pathOf(url: string): string {
  const query = url.indexOf('?');
  return query === -1 ? url : url.slice(0, query);
}

/** upgrade request นี้เป็นของ relay ไหม — path อื่น (เช่น /socket.io/) ปล่อยให้ engine.io */
export function isTalkWsRequest(url: string | undefined): boolean {
  return url !== undefined && pathOf(url) === TALK_WS_PATH;
}

export function talkTicketFromUrl(url: string | undefined): string | null {
  if (url === undefined) return null;
  const query = url.indexOf('?');
  if (query === -1) return null;
  const ticket = new URLSearchParams(url.slice(query + 1)).get('ticket');
  return ticket !== null && TALK_TICKET_PATTERN.test(ticket) ? ticket : null;
}

/**
 * ใช้ ticket ได้ครั้งเดียวแบบ atomic — SQL เดียวกับ spec หัวข้อ Ticket:
 * UPDATE "TalkSessions" SET "TicketHash" = NULL
 * WHERE "TicketHash" = $1 AND "TicketExpiresAt" > now() AND "Status" = 2 RETURNING *
 * ต่อซ้ำ / หมดอายุ / สายไม่ ACTIVE แล้ว = null · เก็บใน DB แทน Redis เพื่อให้ API instance ไหนรับ WS ก็ได้
 */
export async function consumeTalkTicket(
  db: DrizzleDB,
  ticket: string,
): Promise<TalkSessionRow | null> {
  const [row] = await db
    .update(TalkSessions)
    .set({ TicketHash: null })
    .where(
      and(
        eq(TalkSessions.TicketHash, hashTalkTicket(ticket)),
        gt(TalkSessions.TicketExpiresAt, sql`now()`),
        eq(TalkSessions.Status, TALK_STATUS.ACTIVE),
      ),
    )
    .returning();
  return row ?? null;
}
