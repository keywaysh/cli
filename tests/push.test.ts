import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { describe, expect, it, afterEach, beforeEach, vi } from 'vitest';

// Define mock functions that will be used in vi.mock (must be defined before vi.mock calls)
const mockPushSecrets = vi.fn();
const mockEnsureLogin = vi.fn();
const mockGetCurrentRepoFullName = vi.fn();
const mockTrackEvent = vi.fn();
const mockShutdownAnalytics = vi.fn();
const mockPrompts = vi.fn();

// Mock modules - these are hoisted so they run first
vi.mock('../src/utils/api.js', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    pushSecrets: (...args: any[]) => mockPushSecrets(...args),
  };
});

vi.mock('../src/cmds/login.js', () => ({
  ensureLogin: (...args: any[]) => mockEnsureLogin(...args),
}));

vi.mock('../src/utils/git.js', () => ({
  getCurrentRepoFullName: () => mockGetCurrentRepoFullName(),
}));

vi.mock('../src/utils/analytics.js', () => ({
  trackEvent: (...args: any[]) => mockTrackEvent(...args),
  shutdownAnalytics: () => mockShutdownAnalytics(),
  AnalyticsEvents: {
    CLI_PUSH: 'cli_push',
    CLI_ERROR: 'cli_error',
  },
}));

vi.mock('prompts', () => ({
  default: (...args: any[]) => mockPrompts(...args),
}));

const mockShowUpgradePrompt = vi.fn();
vi.mock('../src/utils/helpers.js', () => ({
  showUpgradePrompt: (...args: any[]) => mockShowUpgradePrompt(...args),
}));

// Import after mocks are set up
import { deriveEnvFromFile, discoverEnvCandidates } from '../src/cmds/push.js';
import { APIError } from '../src/utils/api.js';

// Mock process.exit with exit code tracking
let lastExitCode: number | undefined;
const mockExit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
  lastExitCode = code;
  throw new Error(`process.exit(${code ?? 0})`);
}) as (code?: number) => never);

// Mock console
const mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
const mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

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

describe('pushCommand', () => {
  let pushTestDir: string;
  let originalCwd: string;

  beforeEach(() => {
    pushTestDir = mkdtempSync(join(tmpdir(), 'keyway-push-cmd-test-'));
    originalCwd = process.cwd();
    process.chdir(pushTestDir);

    vi.clearAllMocks();
    vi.resetModules();
    lastExitCode = undefined;

    // Default mocks
    mockGetCurrentRepoFullName.mockReturnValue('owner/repo');
    mockEnsureLogin.mockResolvedValue('test-token');
    mockPushSecrets.mockResolvedValue({
      message: 'Secrets pushed successfully',
      stats: { created: 2, updated: 1, deleted: 0 },
    });
    mockPrompts.mockResolvedValue({ confirm: true, choice: null });

    // Set TTY for interactive mode
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(pushTestDir, { recursive: true, force: true });
  });

  describe('success flows', () => {
    it('should push secrets from .env file with --yes flag', async () => {
      writeFileSync(join(pushTestDir, '.env'), 'KEY1=value1\nKEY2=value2\n');

      const { pushCommand } = await import('../src/cmds/push.js');

      await pushCommand({ yes: true });

      expect(mockPushSecrets).toHaveBeenCalledWith(
        'owner/repo',
        'development',
        'KEY1=value1\nKEY2=value2\n',
        'test-token'
      );
      expect(mockTrackEvent).toHaveBeenCalledWith('cli_push', expect.objectContaining({
        repoFullName: 'owner/repo',
        environment: 'development',
        variableCount: 2,
      }));
    });

    it('should use custom environment when specified', async () => {
      writeFileSync(join(pushTestDir, '.env.production'), 'PROD_KEY=prod_value\n');

      const { pushCommand } = await import('../src/cmds/push.js');

      await pushCommand({ env: 'production', yes: true });

      expect(mockPushSecrets).toHaveBeenCalledWith(
        'owner/repo',
        'production',
        expect.any(String),
        'test-token'
      );
    });

    it('should use custom file when specified', async () => {
      writeFileSync(join(pushTestDir, 'custom.env'), 'CUSTOM=value\n');

      const { pushCommand } = await import('../src/cmds/push.js');

      await pushCommand({ file: 'custom.env', yes: true });

      expect(mockPushSecrets).toHaveBeenCalledWith(
        'owner/repo',
        'development',
        'CUSTOM=value\n',
        'test-token'
      );
    });

    it('should display stats after successful push', async () => {
      writeFileSync(join(pushTestDir, '.env'), 'KEY=value\n');

      const { pushCommand } = await import('../src/cmds/push.js');

      await pushCommand({ yes: true });

      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('Secrets pushed successfully'));
    });
  });

  describe('confirmation handling', () => {
    it('should prompt for confirmation without --yes flag', async () => {
      writeFileSync(join(pushTestDir, '.env'), 'KEY=value\n');
      mockPrompts.mockResolvedValue({ confirm: true });

      const { pushCommand } = await import('../src/cmds/push.js');

      await pushCommand({});

      // Verify exact prompt arguments for confirmation
      expect(mockPrompts).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'confirm',
          name: 'confirm',
          message: 'Send 1 secrets from .env (env: development) to owner/repo?',
          initial: true,
        }),
        expect.any(Object)
      );
      expect(mockPushSecrets).toHaveBeenCalled();
    });

    it('should abort if user declines confirmation', async () => {
      writeFileSync(join(pushTestDir, '.env'), 'KEY=value\n');
      mockPrompts.mockResolvedValue({ confirm: false });

      const { pushCommand } = await import('../src/cmds/push.js');

      await pushCommand({});

      expect(mockPushSecrets).not.toHaveBeenCalled();
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('aborted'));
    });

    it('should exit with code 1 in non-interactive mode without --yes', async () => {
      writeFileSync(join(pushTestDir, '.env'), 'KEY=value\n');
      Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
      Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });

      const { pushCommand } = await import('../src/cmds/push.js');

      await expect(pushCommand({})).rejects.toThrow('process.exit(1)');
      expect(lastExitCode).toBe(1);
      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('--yes'));
    });
  });

  describe('file handling', () => {
    it('should exit with code 1 if file does not exist in non-interactive mode', async () => {
      Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
      Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });

      const { pushCommand } = await import('../src/cmds/push.js');

      await expect(pushCommand({ file: 'nonexistent.env', yes: true })).rejects.toThrow('process.exit(1)');
      expect(lastExitCode).toBe(1);
      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('not found'));
    });

    it('should exit with code 1 if file is empty', async () => {
      writeFileSync(join(pushTestDir, '.env'), '');

      const { pushCommand } = await import('../src/cmds/push.js');

      await expect(pushCommand({ yes: true })).rejects.toThrow('process.exit(1)');
      expect(lastExitCode).toBe(1);
      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('empty'));
    });

    it('should count only non-comment, non-empty lines as variables', async () => {
      writeFileSync(join(pushTestDir, '.env'), '# Comment\n\nKEY1=value1\n  \nKEY2=value2\n# Another comment\n');

      const { pushCommand } = await import('../src/cmds/push.js');

      await pushCommand({ yes: true });

      expect(mockTrackEvent).toHaveBeenCalledWith('cli_push', expect.objectContaining({
        variableCount: 2,
      }));
    });
  });

  describe('error handling', () => {
    it('should handle API errors gracefully and exit with code 1', async () => {
      writeFileSync(join(pushTestDir, '.env'), 'KEY=value\n');
      mockPushSecrets.mockRejectedValue(new APIError(500, 'INTERNAL', 'Server error'));

      const { pushCommand } = await import('../src/cmds/push.js');

      await expect(pushCommand({ yes: true })).rejects.toThrow('process.exit(1)');
      expect(lastExitCode).toBe(1);
      expect(mockTrackEvent).toHaveBeenCalledWith('cli_error', expect.objectContaining({
        command: 'push',
        error: 'Server error',
      }));
    });

    it('should show upgrade hint for plan limit errors and exit with code 1', async () => {
      writeFileSync(join(pushTestDir, '.env'), 'KEY=value\n');
      mockPushSecrets.mockRejectedValue(new APIError(
        403,
        'PLAN_LIMIT',
        'Read-only on free plan',
        'https://keyway.sh/upgrade'
      ));

      const { pushCommand } = await import('../src/cmds/push.js');

      await expect(pushCommand({ yes: true })).rejects.toThrow('process.exit(1)');
      expect(lastExitCode).toBe(1);
      expect(mockShowUpgradePrompt).toHaveBeenCalledWith(
        'This vault is read-only on your current plan.',
        'https://keyway.sh/upgrade'
      );
    });

    it('should always shutdown analytics on error', async () => {
      writeFileSync(join(pushTestDir, '.env'), 'KEY=value\n');
      mockPushSecrets.mockRejectedValue(new Error('Network error'));

      const { pushCommand } = await import('../src/cmds/push.js');

      await expect(pushCommand({ yes: true })).rejects.toThrow('process.exit(1)');
      expect(lastExitCode).toBe(1);
      expect(mockShutdownAnalytics).toHaveBeenCalled();
    });
  });

  describe('interactive file selection', () => {
    it('should discover and offer env file choices', async () => {
      writeFileSync(join(pushTestDir, '.env'), 'DEV=1\n');
      writeFileSync(join(pushTestDir, '.env.production'), 'PROD=1\n');
      mockPrompts
        .mockResolvedValueOnce({ choice: { file: '.env.production', env: 'production' } })
        .mockResolvedValueOnce({ confirm: true });

      const { pushCommand } = await import('../src/cmds/push.js');

      await pushCommand({});

      expect(mockPrompts).toHaveBeenCalled();
    });
  });
});
