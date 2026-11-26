import { describe, expect, it } from 'vitest';
import { evidenceExportEnv } from './evidence-export-env';

describe('evidenceExportEnv', () => {
  it('defaults: ffmpeg on PATH, concurrency 1, 180 minutes', () => {
    expect(evidenceExportEnv({})).toEqual({ ffmpegPath: 'ffmpeg', concurrency: 1, timeoutMinutes: 180, timeoutMs: 10_800_000 });
  });
  it('reads FFMPEG_PATH, caps concurrency at 8 and ignores junk', () => {
    const env = evidenceExportEnv({
      FFMPEG_PATH: String.raw` C:\ffmpeg\bin\ffmpeg.exe `,
      EVIDENCE_EXPORT_CONCURRENCY: '99',
      EVIDENCE_EXPORT_TIMEOUT_MINUTES: 'abc',
    });
    expect(env.ffmpegPath).toBe(String.raw`C:\ffmpeg\bin\ffmpeg.exe`);
    expect(env.concurrency).toBe(8);
    expect(env.timeoutMinutes).toBe(180);
    expect(evidenceExportEnv({ EVIDENCE_EXPORT_CONCURRENCY: '0' }).concurrency).toBe(1);
  });
  it('clamps the timeout to 1440 minutes', () => {
    const env = evidenceExportEnv({ EVIDENCE_EXPORT_TIMEOUT_MINUTES: '99999' });
    expect(env.timeoutMinutes).toBe(1440);
    expect(env.timeoutMs).toBe(1440 * 60_000);
  });
  it('clamps the timeout to 1440 minutes', () => {
    const env = evidenceExportEnv({ EVIDENCE_EXPORT_TIMEOUT_MINUTES: '99999' });
    expect(env.timeoutMinutes).toBe(1440);
    expect(env.timeoutMs).toBe(1440 * 60_000);
  });
});
