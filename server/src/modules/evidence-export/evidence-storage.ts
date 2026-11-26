import { isAbsolute, join, relative, resolve, sep } from 'node:path';

export type EvidenceStorage = {
  root: string;
  /** Maps a path stored in the DB (relative to the root) to an absolute path; rejects anything outside the root. */
  absolute(relativePath: string): string;
  evidenceDir(): string;
};

/** STORAGE_DRIVER=local only: root = STORAGE_LOCAL_DIR, relative values resolve against the working directory. */
export function evidenceStorage(env: Record<string, string | undefined> = process.env): EvidenceStorage {
  const root = resolve(process.cwd(), (env.STORAGE_LOCAL_DIR ?? '').trim() || './storage');
  return {
    root,
    absolute(relativePath: string): string {
      if (!relativePath || isAbsolute(relativePath)) throw new Error('Evidence path must be relative to the storage root');
      const target = resolve(root, relativePath);
      const rel = relative(root, target);
      if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
        throw new Error('Evidence path escapes the storage root');
      }
      return target;
    },
    evidenceDir: () => join(root, 'evidence'),
  };
}
