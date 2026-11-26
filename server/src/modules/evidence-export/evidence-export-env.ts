export type EvidenceExportEnv = {
  ffmpegPath: string;
  concurrency: number;
  timeoutMs: number;
  timeoutMinutes: number;
};

const DEFAULT_TIMEOUT_MINUTES = 180;
const MAX_CONCURRENCY = 8;
const MAX_TIMEOUT_MINUTES = 1440;

function positive(raw: string | undefined, fallback: number): number {
  const value = Number((raw ?? '').trim());
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Read at call time so tests (and a restarted worker) see the current environment. */
export function evidenceExportEnv(env: Record<string, string | undefined> = process.env): EvidenceExportEnv {
  const timeoutMinutes = Math.min(MAX_TIMEOUT_MINUTES, positive(env.EVIDENCE_EXPORT_TIMEOUT_MINUTES, DEFAULT_TIMEOUT_MINUTES));
  return {
    ffmpegPath: (env.FFMPEG_PATH ?? '').trim() || 'ffmpeg',
    concurrency: Math.min(MAX_CONCURRENCY, Math.max(1, Math.floor(positive(env.EVIDENCE_EXPORT_CONCURRENCY, 1)))),
    timeoutMinutes,
    timeoutMs: timeoutMinutes * 60_000,
  };
}
