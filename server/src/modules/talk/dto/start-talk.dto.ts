import { IsString, Matches } from 'class-validator';
import { TALK_TICKET_PATTERN } from '../talk-ticket';

export class StartTalkDto {
  /** sessionToken ของภาพสดที่เปิดอยู่ (ผลของ POST /api/streams/live) — base64url 43 ตัวอักษร */
  @IsString()
  @Matches(TALK_TICKET_PATTERN)
  streamSessionToken!: string;
}
