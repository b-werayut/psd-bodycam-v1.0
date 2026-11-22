/** Usernames are stored and compared trimmed + lowercase (UQ_Users_Username is on lower("Username")). */
export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}
