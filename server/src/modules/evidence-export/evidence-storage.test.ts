import { isAbsolute, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { evidenceStorage } from './evidence-storage';

describe('evidenceStorage', () => {
  it('resolves a relative STORAGE_LOCAL_DIR against the working directory', () => {
    const s = evidenceStorage({ STORAGE_LOCAL_DIR: './storage' });
    expect(s.root).toBe(resolve(process.cwd(), './storage'));
    expect(s.evidenceDir()).toBe(join(s.root, 'evidence'));
  });

  it('keeps an absolute root and defaults to ./storage', () => {
    const abs = resolve('/tmp/evi-root');
    expect(evidenceStorage({ STORAGE_LOCAL_DIR: abs }).root).toBe(abs);
    expect(isAbsolute(evidenceStorage({}).root)).toBe(true);
    expect(evidenceStorage({}).root).toBe(resolve(process.cwd(), './storage'));
  });

  it('maps a relative path under the root', () => {
    const s = evidenceStorage({ STORAGE_LOCAL_DIR: resolve('/tmp/evi-root') });
    expect(s.absolute('evidence/a.mp4')).toBe(join(s.root, 'evidence', 'a.mp4'));
  });

  it('rejects paths escaping the root', () => {
    const s = evidenceStorage({ STORAGE_LOCAL_DIR: resolve('/tmp/evi-root') });
    expect(() => s.absolute('../x.mp4')).toThrow();
    expect(() => s.absolute('evidence/../../x.mp4')).toThrow();
    expect(() => s.absolute(resolve('/etc/passwd'))).toThrow();
    expect(() => s.absolute('')).toThrow();
  });
});
