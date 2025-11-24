import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { describe, expect, it, afterEach } from 'vitest';
import { deriveEnvFromFile, discoverEnvCandidates } from '../src/cmds/push.js';

let tempDir: string | null = null;

function makeTempDir() {
  tempDir = mkdtempSync(join(tmpdir(), 'keyway-push-test-'));
  return tempDir;
}

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe('push helpers', () => {
  it('derives environment names from env file names', () => {
    expect(deriveEnvFromFile('.env')).toBe('development');
    expect(deriveEnvFromFile('.env.production')).toBe('production');
    expect(deriveEnvFromFile('custom.env')).toBe('development');
  });

  it('discovers env candidates and excludes .env.local', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, '.env'), 'A=1\n');
    writeFileSync(join(dir, '.env.production'), 'B=2\n');
    writeFileSync(join(dir, '.env.local'), 'C=3\n');
    writeFileSync(join(dir, 'README.md'), '# ignore me\n');

    const candidates = discoverEnvCandidates(dir);

    expect(candidates).toEqual(
      expect.arrayContaining([
        { file: '.env', env: 'development' },
        { file: '.env.production', env: 'production' },
      ])
    );
    expect(candidates.find((c) => c.file === '.env.local')).toBeUndefined();
  });
});
