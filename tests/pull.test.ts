import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Mock dependencies before importing the module
const mockPullSecrets = vi.fn();
const mockEnsureLogin = vi.fn();
const mockGetCurrentRepoFullName = vi.fn();
const mockTrackEvent = vi.fn();
const mockShutdownAnalytics = vi.fn().mockResolvedValue(undefined);
const mockPrompts = vi.fn();

vi.mock('../src/utils/api.js', () => ({
  pullSecrets: mockPullSecrets,
  APIError: class APIError extends Error {
    statusCode: number;
    error: string;
    upgradeUrl?: string;
    constructor(statusCode: number, error: string, message: string, upgradeUrl?: string) {
      super(message);
      this.name = 'APIError';
      this.statusCode = statusCode;
      this.error = error;
      this.upgradeUrl = upgradeUrl;
    }
  },
  truncateMessage: (msg: string) => msg,
}));

vi.mock('../src/cmds/login.js', () => ({
  ensureLogin: mockEnsureLogin,
}));

vi.mock('../src/utils/git.js', () => ({
  getCurrentRepoFullName: mockGetCurrentRepoFullName,
}));

vi.mock('../src/utils/analytics.js', () => ({
  trackEvent: mockTrackEvent,
  shutdownAnalytics: mockShutdownAnalytics,
  AnalyticsEvents: {
    CLI_PULL: 'cli_pull',
    CLI_ERROR: 'cli_error',
  },
}));

vi.mock('prompts', () => ({
  default: mockPrompts,
}));

// Mock process.exit with exit code tracking
let lastExitCode: number | undefined;
const mockExit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
  lastExitCode = code;
  throw new Error(`process.exit(${code ?? 0})`);
}) as (code?: number) => never);

// Mock console methods
const mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
const mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

describe('pullCommand', () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(() => {
    // Create temp directory and change to it
    tempDir = mkdtempSync(join(tmpdir(), 'keyway-pull-test-'));
    originalCwd = process.cwd();
    process.chdir(tempDir);

    // Reset mocks
    vi.clearAllMocks();
    vi.resetModules();
    lastExitCode = undefined;

    // Default mock implementations
    mockGetCurrentRepoFullName.mockReturnValue('owner/repo');
    mockEnsureLogin.mockResolvedValue('test-token');
    mockPullSecrets.mockResolvedValue({
      content: 'KEY1=value1\nKEY2=value2\n# comment\n',
    });
    mockPrompts.mockResolvedValue({ confirm: true });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tempDir, { recursive: true, force: true });
    mockConsoleLog.mockClear();
    mockConsoleError.mockClear();
  });

  describe('success flow', () => {
    it('should pull secrets and write to .env file', async () => {
      const { pullCommand } = await import('../src/cmds/pull.js');

      await pullCommand({});

      // Verify API was called correctly
      expect(mockPullSecrets).toHaveBeenCalledWith('owner/repo', 'development', 'test-token');

      // Verify file was created
      const envFile = join(tempDir, '.env');
      expect(existsSync(envFile)).toBe(true);
      expect(readFileSync(envFile, 'utf-8')).toBe('KEY1=value1\nKEY2=value2\n# comment\n');

      // Verify analytics was tracked
      expect(mockTrackEvent).toHaveBeenCalledWith('cli_pull', {
        repoFullName: 'owner/repo',
        environment: 'development',
      });
    });

    it('should use custom environment when specified', async () => {
      const { pullCommand } = await import('../src/cmds/pull.js');

      await pullCommand({ env: 'production' });

      expect(mockPullSecrets).toHaveBeenCalledWith('owner/repo', 'production', 'test-token');
    });

    it('should use custom file path when specified', async () => {
      const { pullCommand } = await import('../src/cmds/pull.js');

      await pullCommand({ file: '.env.production' });

      const envFile = join(tempDir, '.env.production');
      expect(existsSync(envFile)).toBe(true);
    });

    it('should count non-empty, non-comment lines as variables', async () => {
      mockPullSecrets.mockResolvedValue({
        content: 'KEY1=value1\n\n# comment\nKEY2=value2\n   \nKEY3=value3',
      });

      const { pullCommand } = await import('../src/cmds/pull.js');

      await pullCommand({});

      // Should report 3 variables (KEY1, KEY2, KEY3)
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('3'));
    });
  });

  describe('file overwrite handling', () => {
    it('should prompt for confirmation when file exists', async () => {
      // Create existing file
      writeFileSync(join(tempDir, '.env'), 'EXISTING=value\n');

      // Mock stdin/stdout as TTY for interactive mode
      const originalStdinIsTTY = process.stdin.isTTY;
      const originalStdoutIsTTY = process.stdout.isTTY;
      Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });

      mockPrompts.mockResolvedValue({ confirm: true });

      const { pullCommand } = await import('../src/cmds/pull.js');

      await pullCommand({});

      // Verify exact prompt arguments
      expect(mockPrompts).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'confirm',
          name: 'confirm',
          message: '.env exists. Overwrite with secrets from development?',
          initial: false,
        }),
        expect.any(Object)
      );

      // Restore TTY settings
      Object.defineProperty(process.stdin, 'isTTY', { value: originalStdinIsTTY, configurable: true });
      Object.defineProperty(process.stdout, 'isTTY', { value: originalStdoutIsTTY, configurable: true });
    });

    it('should skip prompt and overwrite with --yes flag', async () => {
      writeFileSync(join(tempDir, '.env'), 'EXISTING=value\n');

      const { pullCommand } = await import('../src/cmds/pull.js');

      await pullCommand({ yes: true });

      // Should NOT prompt
      expect(mockPrompts).not.toHaveBeenCalled();

      // Should overwrite
      expect(readFileSync(join(tempDir, '.env'), 'utf-8')).toBe('KEY1=value1\nKEY2=value2\n# comment\n');
    });

    it('should exit with code 1 in non-interactive mode without --yes', async () => {
      writeFileSync(join(tempDir, '.env'), 'EXISTING=value\n');

      // Non-interactive mode (no TTY)
      const originalStdinIsTTY = process.stdin.isTTY;
      const originalStdoutIsTTY = process.stdout.isTTY;
      Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
      Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });

      const { pullCommand } = await import('../src/cmds/pull.js');

      await expect(pullCommand({})).rejects.toThrow('process.exit(1)');
      expect(lastExitCode).toBe(1);

      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining('.env exists')
      );

      // Restore
      Object.defineProperty(process.stdin, 'isTTY', { value: originalStdinIsTTY, configurable: true });
      Object.defineProperty(process.stdout, 'isTTY', { value: originalStdoutIsTTY, configurable: true });
    });

    it('should abort if user declines overwrite', async () => {
      writeFileSync(join(tempDir, '.env'), 'EXISTING=value\n');

      const originalStdinIsTTY = process.stdin.isTTY;
      const originalStdoutIsTTY = process.stdout.isTTY;
      Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });

      mockPrompts.mockResolvedValue({ confirm: false });

      const { pullCommand } = await import('../src/cmds/pull.js');

      await pullCommand({});

      // File should NOT be overwritten
      expect(readFileSync(join(tempDir, '.env'), 'utf-8')).toBe('EXISTING=value\n');

      // Should show aborted message
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('aborted'));

      Object.defineProperty(process.stdin, 'isTTY', { value: originalStdinIsTTY, configurable: true });
      Object.defineProperty(process.stdout, 'isTTY', { value: originalStdoutIsTTY, configurable: true });
    });
  });

  describe('error handling', () => {
    it('should exit with code 1 on API errors', async () => {
      const { APIError } = await import('../src/utils/api.js');
      mockPullSecrets.mockRejectedValue(new APIError(404, 'NOT_FOUND', "Environment 'staging' not found"));

      const { pullCommand } = await import('../src/cmds/pull.js');

      await expect(pullCommand({ env: 'staging' })).rejects.toThrow('process.exit(1)');
      expect(lastExitCode).toBe(1);

      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('404'));
      expect(mockTrackEvent).toHaveBeenCalledWith('cli_error', expect.objectContaining({
        command: 'pull',
        error: expect.stringContaining("Environment 'staging' not found"),
      }));
    });

    it('should exit with code 1 on network errors', async () => {
      mockPullSecrets.mockRejectedValue(new Error('Network error: ECONNREFUSED'));

      const { pullCommand } = await import('../src/cmds/pull.js');

      await expect(pullCommand({})).rejects.toThrow('process.exit(1)');
      expect(lastExitCode).toBe(1);

      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('Network error'));
    });

    it('should shutdown analytics on error', async () => {
      mockPullSecrets.mockRejectedValue(new Error('Test error'));

      const { pullCommand } = await import('../src/cmds/pull.js');

      await expect(pullCommand({})).rejects.toThrow('process.exit(1)');
      expect(lastExitCode).toBe(1);

      expect(mockShutdownAnalytics).toHaveBeenCalled();
    });
  });

  describe('authentication', () => {
    it('should call ensureLogin with allowPrompt based on loginPrompt option', async () => {
      const { pullCommand } = await import('../src/cmds/pull.js');

      await pullCommand({ loginPrompt: false });

      expect(mockEnsureLogin).toHaveBeenCalledWith({ allowPrompt: false });
    });

    it('should default to allowPrompt true', async () => {
      const { pullCommand } = await import('../src/cmds/pull.js');

      await pullCommand({});

      expect(mockEnsureLogin).toHaveBeenCalledWith({ allowPrompt: true });
    });
  });
});
