const SENSITIVE_KEY = /pass(word)?|token|hash|secret|otp|pin/i;
const MAX_CHARS = 4000;

/** Request body for AuditLogs.Changes: secrets replaced at every level, big bodies cut to a preview. */
export function redactBody(body: unknown): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length === 0) return null;
  const redacted = redact(body);
  const json = JSON.stringify(redacted);
  if (json.length <= MAX_CHARS) return redacted;
  return { truncated: true, preview: json.slice(0, MAX_CHARS - 50) };
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => [key, SENSITIVE_KEY.test(key) ? '[REDACTED]' : redact(v)]),
    );
  }
  return value;
}
