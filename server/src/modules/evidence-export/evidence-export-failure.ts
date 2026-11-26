/**
 * A failure whose `message` is short Thai text that is safe to show the user (stored in `ErrorMessage`).
 * `detail` is English text for the server log only (ffmpeg stderr, exit code, the underlying error);
 * it never reaches the user.
 */
export class ExportFailure extends Error {
  constructor(
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'ExportFailure';
  }
}

const URL_IN_TEXT = /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi;

/** Log-safe text: URLs (which can carry tokens) are masked and the length is capped. */
export function logSafe(text: string, max = 400): string {
  return text.replace(URL_IN_TEXT, '<url>').replace(/\s+/g, ' ').trim().slice(0, max);
}
