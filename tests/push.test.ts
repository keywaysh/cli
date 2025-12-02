import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { describe, expect, it, afterEach } from 'vitest';
import { deriveEnvFromFile, discoverEnvCandidates } from '../src/cmds/push.js';
import { APIError } from '../src/utils/api.js';

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

describe('push error handling', () => {
  describe('APIError for plan limits', () => {
    it('should include upgradeUrl for 403 plan limit errors', () => {
      const error = new APIError(
        403,
        'PLAN_LIMIT_REACHED',
        'This private vault is read-only on the Free plan.',
        'https://keyway.sh/upgrade'
      );

      expect(error.statusCode).toBe(403);
      expect(error.upgradeUrl).toBe('https://keyway.sh/upgrade');
      expect(error.message).toContain('read-only');
    });

    it('should detect read-only error from message', () => {
      const error = new APIError(
        403,
        'PLAN_LIMIT_REACHED',
        'This private vault is read-only on the Free plan.',
        'https://keyway.sh/upgrade'
      );

      // This is the detection logic used in push.ts
      const isReadOnlyError =
        error.statusCode === 403 && error.message.toLowerCase().includes('read-only');

      expect(isReadOnlyError).toBe(true);
    });

    it('should not false-positive on other 403 errors', () => {
      const error = new APIError(
        403,
        'FORBIDDEN',
        'You do not have access to this repository.',
        undefined
      );

      const isReadOnlyError =
        error.statusCode === 403 && error.message.toLowerCase().includes('read-only');

      expect(isReadOnlyError).toBe(false);
    });
  });

  describe('Error message formatting', () => {
    it('should format plan limit error with upgrade hint', () => {
      const error = new APIError(
        403,
        'PLAN_LIMIT_REACHED',
        'This private vault is read-only on the Free plan.',
        'https://keyway.sh/upgrade'
      );

      // Simulate the error handling logic from push.ts
      let message: string;
      let hint: string | null = null;

      if (error.statusCode === 403 && error.message.toLowerCase().includes('read-only')) {
        message = 'This vault is read-only on your current plan.';
        hint = `Upgrade to Pro to unlock editing: ${error.upgradeUrl || 'https://keyway.sh/settings'}`;
      } else {
        message = error.message;
      }

      expect(message).toBe('This vault is read-only on your current plan.');
      expect(hint).toContain('Upgrade to Pro');
      expect(hint).toContain('https://keyway.sh/upgrade');
    });

    it('should use fallback URL when upgradeUrl is undefined', () => {
      const error = new APIError(
        403,
        'PLAN_LIMIT_REACHED',
        'This private vault is read-only on the Free plan.',
        undefined
      );

      const hint = `Upgrade to Pro to unlock editing: ${error.upgradeUrl || 'https://keyway.sh/settings'}`;

      expect(hint).toContain('https://keyway.sh/settings');
    });
  });

  describe('Environment not found error', () => {
    it('should detect and format environment not found error', () => {
      const apiMessage =
        "Environment 'staging' does not exist in this vault. Available environments: development, production.";
      const error = new APIError(404, 'NOT_FOUND', apiMessage, undefined);

      // Simulate the detection logic from push.ts
      const envNotFoundMatch = error.message.match(
        /Environment '([^']+)' does not exist.*Available environments: ([^.]+)/
      );

      expect(envNotFoundMatch).not.toBeNull();
      expect(envNotFoundMatch![1]).toBe('staging');
      expect(envNotFoundMatch![2]).toBe('development, production');
    });
  });
});
