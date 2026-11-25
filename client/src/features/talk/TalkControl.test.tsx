import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { LanguageProvider } from '@/i18n/LanguageProvider';
import type { TranslationKey } from '@/i18n/locales/th';
import { TalkControl } from './TalkControl';
import type { TalkSession } from './useTalkSession';

function talkOf(overrides: Partial<TalkSession> = {}): TalkSession {
  return {
    state: 'idle',
    notice: null,
    elapsedSeconds: 0,
    maxSeconds: null,
    muted: false,
    micLevel: 0,
    readLevel: () => 0,
    start: vi.fn(),
    hangUp: vi.fn(),
    stop: vi.fn(),
    toggleMute: vi.fn(),
    ...overrides,
  };
}

function renderControl(talk: TalkSession, blocker: TranslationKey | null = null) {
  return render(
    <LanguageProvider>
      <TalkControl talk={talk} blocker={blocker} />
    </LanguageProvider>,
  );
}

describe('TalkControl — idle', () => {
  it('voice pill วงกลมไมค์ (ไม่มีข้อความบนปุ่ม) ชื่อ "เริ่มการสนทนา" พร้อมคำแนะนำให้ใช้หูฟัง · กดแล้วเริ่มสาย', async () => {
    const talk = talkOf();
    renderControl(talk);

    const button = screen.getByRole('button', { name: 'เริ่มการสนทนา' });
    expect(button).toBeEnabled();
    expect(button).toHaveClass('voice-pill');
    expect(button).toHaveAttribute('data-state', 'idle');
    expect(button).not.toHaveTextContent('เริ่มการสนทนา');
    expect(button).toHaveAccessibleDescription('แนะนำให้ใช้หูฟังเพื่อป้องกันเสียงสะท้อน');

    await userEvent.click(button);
    expect(talk.start).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['talk.blocked.permission', 'บทบาทของคุณไม่มีสิทธิ์คุยผ่านกล้อง'],
    ['talk.blocked.waitingLive', 'รอภาพสดเชื่อมต่อก่อน'],
    ['talk.blocked.unsupported', 'เบราว์เซอร์นี้ใช้ไมโครโฟนไม่ได้'],
  ] as const)('**%s → ปุ่มยังอยู่ แต่ disable พร้อมเหตุผล "%s"** (ไม่ซ่อน)', async (blocker, reason) => {
    const talk = talkOf();
    renderControl(talk, blocker);

    const button = screen.getByRole('button', { name: 'เริ่มการสนทนา' });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(reason);
    expect(screen.getByText(reason)).toBeVisible();

    await userEvent.click(button);
    expect(talk.start).not.toHaveBeenCalled();
  });
});

describe('TalkControl — ระหว่างเชื่อมต่อ', () => {
  it('ขอไมค์ → "กำลังขอสิทธิ์ใช้ไมโครโฟน…" และปุ่ม voice pill กดเริ่มซ้ำไม่ได้', async () => {
    const talk = talkOf({ state: 'requesting-mic' });
    renderControl(talk);

    expect(screen.getByRole('status')).toHaveTextContent('กำลังขอสิทธิ์ใช้ไมโครโฟน…');
    const pill = screen.getByRole('button', { name: 'เริ่มการสนทนา' });
    expect(pill).toBeDisabled();
    expect(pill).toHaveAttribute('data-state', 'busy');

    await userEvent.click(pill);
    expect(talk.start).not.toHaveBeenCalled();
  });

  it('**connecting → spinner "กำลังเชื่อมต่อเสียง…"** และยกเลิกได้ (server ต่อ DSS ~11 วินาที)', async () => {
    const talk = talkOf({ state: 'connecting' });
    renderControl(talk);

    expect(screen.getByRole('status')).toHaveTextContent('กำลังเชื่อมต่อเสียง…');

    await userEvent.click(screen.getByRole('button', { name: 'ยกเลิก' }));
    expect(talk.hangUp).toHaveBeenCalledTimes(1);
  });

  it('ending → "กำลังจบการสนทนา…" ไม่มีปุ่มที่กดได้', () => {
    renderControl(talkOf({ state: 'ending' }));

    expect(screen.getByRole('status')).toHaveTextContent('กำลังจบการสนทนา…');
    for (const button of screen.queryAllByRole('button')) expect(button).toBeDisabled();
  });
});

describe('TalkControl — กำลังคุย', () => {
  it('**แคปซูล voice pill: เวลา m:ss + แถบคลื่น · กดปุ่มหยุด = จบการสนทนา**', async () => {
    const talk = talkOf({ state: 'active', elapsedSeconds: 42, maxSeconds: 600, micLevel: 0.35 });
    renderControl(talk);

    const pill = screen.getByRole('button', { name: 'จบการสนทนา' });
    expect(pill).toHaveAttribute('data-state', 'listening');
    expect(pill.closest('.voice-pill-slot')).toHaveAttribute('data-state', 'listening');
    expect(pill.querySelector('.voice-pill__time')).toHaveTextContent(/^0:42$/);
    expect(pill.querySelector('canvas.voice-pill__wave')).not.toBeNull();

    await userEvent.click(pill);
    expect(talk.hangUp).toHaveBeenCalledTimes(1);
    expect(talk.start).not.toHaveBeenCalled();
  });

  it('screen reader ยังได้ "กำลังคุย 00:42 / 10:00" และระดับเสียงไมโครโฟน', () => {
    renderControl(talkOf({ state: 'active', elapsedSeconds: 42, maxSeconds: 600, micLevel: 0.35 }));

    expect(screen.getByText('กำลังคุย 00:42 / 10:00')).toBeInTheDocument();
    expect(screen.getByRole('meter', { name: 'ระดับเสียงไมโครโฟน' })).toHaveAttribute(
      'aria-valuenow',
      '35',
    );
  });

  it('ปุ่มปิดไมค์ข้างแคปซูล · ปิดอยู่ → "เปิดไมโครโฟน" (aria-pressed) และแถบคลื่นจางลง', async () => {
    const talk = talkOf({ state: 'active', maxSeconds: 600 });
    const { rerender } = renderControl(talk);

    await userEvent.click(screen.getByRole('button', { name: 'ปิดไมโครโฟน' }));
    expect(talk.toggleMute).toHaveBeenCalledTimes(1);

    rerender(
      <LanguageProvider>
        <TalkControl talk={{ ...talk, muted: true }} blocker={null} />
      </LanguageProvider>,
    );
    expect(screen.getByRole('button', { name: 'เปิดไมโครโฟน' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'จบการสนทนา' })).toHaveAttribute('data-muted');
  });

  it('**ปุ่มเดียวกันตลอดทุกสถานะ** — แคปซูลพองออกจากวงกลมไมค์เดิม ไม่ใช่ element ใหม่', () => {
    const talk = talkOf();
    const { rerender } = renderControl(talk);
    const idle = screen.getByRole('button', { name: 'เริ่มการสนทนา' });
    expect(idle).toHaveAttribute('data-state', 'idle');

    rerender(
      <LanguageProvider>
        <TalkControl talk={{ ...talk, state: 'active', maxSeconds: 600 }} blocker={null} />
      </LanguageProvider>,
    );
    expect(screen.getByRole('button', { name: 'จบการสนทนา' })).toBe(idle);
  });
});

describe('TalkControl — จบสาย / ผิดพลาด', () => {
  it('ended → ข้อความในบรรทัด + ปุ่มกลับเป็น "เริ่มการสนทนา" (ไม่ใช่ลองใหม่)', async () => {
    const talk = talkOf({ state: 'ended', notice: { key: 'talk.ended.4003' } });
    renderControl(talk);

    expect(screen.getByRole('status')).toHaveTextContent('กล้องตัดการเชื่อมต่อเสียง');
    expect(screen.queryByRole('button', { name: 'ลองใหม่' })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'เริ่มการสนทนา' }));
    expect(talk.start).toHaveBeenCalledTimes(1);
  });

  it('**กดจบการสนทนาเอง → "จบการสนทนาแล้ว" + ปุ่ม "เริ่มการสนทนา" ให้เริ่มสายใหม่**', () => {
    renderControl(talkOf({ state: 'ended', notice: { key: 'talk.ended.1000' } }));

    expect(screen.getByRole('status')).toHaveTextContent('จบการสนทนาแล้ว');
    expect(screen.getByRole('button', { name: 'เริ่มการสนทนา' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'ลองใหม่' })).toBeNull();
  });

  it('ครบเวลาสูงสุด → บอกจำนวนนาที', () => {
    renderControl(
      talkOf({ state: 'ended', notice: { key: 'talk.ended.4001', params: { n: '10' } } }),
    );

    expect(screen.getByText('ครบเวลาสูงสุด 10 นาที')).toBeInTheDocument();
  });

  it('idle พร้อมข้อความ busy จาก server → แสดงข้อความ (status) และกดเริ่มได้อีก', async () => {
    const talk = talkOf({ state: 'idle', notice: { text: 'อุปกรณ์นี้มีผู้ใช้อื่นกำลังคุยอยู่ (สมชาย ใจดี)' } });
    renderControl(talk);

    expect(screen.getByRole('status')).toHaveTextContent('อุปกรณ์นี้มีผู้ใช้อื่นกำลังคุยอยู่ (สมชาย ใจดี)');
    const button = screen.getByRole('button', { name: 'เริ่มการสนทนา' });
    expect(button).toBeEnabled();
    await userEvent.click(button);
    expect(talk.start).toHaveBeenCalledTimes(1);
  });

  it('**error จาก backend → ข้อความไทยตรง ๆ** เป็น alert และลองใหม่ได้', () => {
    renderControl(
      talkOf({
        state: 'error',
        notice: { text: 'อุปกรณ์นี้มีผู้ใช้อื่นกำลังคุยอยู่ (สมชาย ใจดี)' },
      }),
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'อุปกรณ์นี้มีผู้ใช้อื่นกำลังคุยอยู่ (สมชาย ใจดี)',
    );
    expect(screen.getByRole('button', { name: 'ลองใหม่' })).toBeEnabled();
  });

  it('สายถูกตัดเพราะภาพสดหาย → ปุ่มเริ่มการสนทนา disable พร้อมเหตุผล "รอภาพสดเชื่อมต่อก่อน"', () => {
    renderControl(
      talkOf({ state: 'ended', notice: { key: 'talk.ended.4006' } }),
      'talk.blocked.waitingLive',
    );

    expect(
      screen.getByText('สายถูกตัดเนื่องจากสิทธิ์หรือสถานะอุปกรณ์เปลี่ยน'),
    ).toBeInTheDocument();
    const start = screen.getByRole('button', { name: 'เริ่มการสนทนา' });
    expect(start).toBeDisabled();
    expect(start).toHaveAccessibleDescription(/รอภาพสดเชื่อมต่อก่อน/);
  });
});
