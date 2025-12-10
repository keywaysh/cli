import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Mock all dependencies
const mockGetCurrentRepoFullName = vi.fn();
const mockInitVault = vi.fn();
const mockCheckGitHubAppInstallation = vi.fn();
const mockCheckVaultExists = vi.fn();
const mockStartDeviceLogin = vi.fn();
const mockPollDeviceLogin = vi.fn();
const mockGetStoredAuth = vi.fn();
const mockSaveAuthToken = vi.fn();
const mockClearAuth = vi.fn();
const mockTrackEvent = vi.fn();
const mockShutdownAnalytics = vi.fn().mockResolvedValue(undefined);
const mockIdentifyUser = vi.fn();
const mockPrompts = vi.fn();
const mockAddBadgeToReadme = vi.fn();
const mockOpenUrl = vi.fn().mockResolvedValue(undefined);
const mockShowUpgradePrompt = vi.fn();
const mockDiscoverEnvCandidates = vi.fn();
const mockPushCommand = vi.fn();

vi.mock('../src/utils/git.js', () => ({
  getCurrentRepoFullName: mockGetCurrentRepoFullName,
}));

vi.mock('../src/utils/api.js', () => ({
  initVault: mockInitVault,
  checkGitHubAppInstallation: mockCheckGitHubAppInstallation,
  checkVaultExists: mockCheckVaultExists,
  startDeviceLogin: mockStartDeviceLogin,
  pollDeviceLogin: mockPollDeviceLogin,
  truncateMessage: (msg: string) => msg,
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
}));

vi.mock('../src/utils/auth.js', () => ({
  getStoredAuth: mockGetStoredAuth,
  saveAuthToken: mockSaveAuthToken,
  clearAuth: mockClearAuth,
}));

vi.mock('../src/utils/analytics.js', () => ({
  trackEvent: mockTrackEvent,
  shutdownAnalytics: mockShutdownAnalytics,
  identifyUser: mockIdentifyUser,
  AnalyticsEvents: {
    CLI_INIT: 'cli_init',
    CLI_ERROR: 'cli_error',
  },
}));

vi.mock('prompts', () => ({
  default: mockPrompts,
}));

vi.mock('../src/cmds/readme.js', () => ({
  addBadgeToReadme: mockAddBadgeToReadme,
}));

vi.mock('../src/cmds/push.js', () => ({
  discoverEnvCandidates: mockDiscoverEnvCandidates,
  pushCommand: mockPushCommand,
}));

vi.mock('../src/utils/helpers.js', () => ({
  sleep: vi.fn().mockResolvedValue(undefined),
  isInteractive: vi.fn().mockReturnValue(true),
  MAX_CONSECUTIVE_ERRORS: 5,
  openUrl: mockOpenUrl,
  showUpgradePrompt: mockShowUpgradePrompt,
}));

// Mock process.exit with exit code tracking
let lastExitCode: number | undefined;
const mockExit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
  lastExitCode = code;
  throw new Error(`process.exit(${code ?? 0})`);
}) as (code?: number) => never);

// Mock console
const mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
const mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

describe('initCommand', () => {
  let tempDir: string;
  let originalCwd: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'keyway-init-test-'));
    originalCwd = process.cwd();
    originalEnv = { ...process.env };
    process.chdir(tempDir);

    vi.clearAllMocks();
    vi.resetModules();
    lastExitCode = undefined;

    // Default mocks for success path
    mockGetCurrentRepoFullName.mockReturnValue('owner/repo');
    mockGetStoredAuth.mockResolvedValue({ keywayToken: 'stored-token', githubLogin: 'user' });
    mockCheckGitHubAppInstallation.mockResolvedValue({ installed: true });
    mockCheckVaultExists.mockResolvedValue(false);
    mockInitVault.mockResolvedValue({ success: true });
    mockAddBadgeToReadme.mockResolvedValue(true);
    mockDiscoverEnvCandidates.mockReturnValue([]);
    mockPrompts.mockResolvedValue({ shouldProceed: true, shouldPush: false, shouldInstall: true });

    // Set TTY for interactive mode
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tempDir, { recursive: true, force: true });
    process.env = originalEnv;
    delete process.env.KEYWAY_TOKEN;
  });

  describe('success flows', () => {
    it('should create vault when user is logged in and GitHub App installed', async () => {
      const { initCommand } = await import('../src/cmds/init.js');

      await initCommand({});

      expect(mockCheckGitHubAppInstallation).toHaveBeenCalledWith('owner', 'repo', 'stored-token');
      expect(mockCheckVaultExists).toHaveBeenCalledWith('stored-token', 'owner/repo');
      expect(mockInitVault).toHaveBeenCalledWith('owner/repo', 'stored-token');
      expect(mockTrackEvent).toHaveBeenCalledWith('cli_init', expect.objectContaining({
        repoFullName: 'owner/repo',
      }));
    });

    it('should show already initialized message when vault exists', async () => {
      mockCheckVaultExists.mockResolvedValue(true);

      const { initCommand } = await import('../src/cmds/init.js');

      await initCommand({});

      expect(mockInitVault).not.toHaveBeenCalled();
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('Already initialized'));
    });

    it('should add badge to README on success', async () => {
      const { initCommand } = await import('../src/cmds/init.js');

      await initCommand({});

      expect(mockAddBadgeToReadme).toHaveBeenCalledWith(true);
    });

    it('should prompt to push when env files exist', async () => {
      mockDiscoverEnvCandidates.mockReturnValue([
        { file: '.env', env: 'development' },
      ]);
      mockPrompts.mockResolvedValue({ shouldPush: true });

      const { initCommand } = await import('../src/cmds/init.js');

      await initCommand({});

      expect(mockPrompts).toHaveBeenCalled();
      expect(mockPushCommand).toHaveBeenCalledWith({ loginPrompt: false, yes: false });
    });
  });

  describe('KEYWAY_TOKEN environment variable', () => {
    it('should use KEYWAY_TOKEN when set', async () => {
      process.env.KEYWAY_TOKEN = 'env-token';
      mockGetStoredAuth.mockResolvedValue(null);

      const { initCommand } = await import('../src/cmds/init.js');

      await initCommand({});

      expect(mockCheckGitHubAppInstallation).toHaveBeenCalledWith('owner', 'repo', 'env-token');
    });

    it('should exit with code 1 if KEYWAY_TOKEN is invalid', async () => {
      process.env.KEYWAY_TOKEN = 'invalid-token';
      const { APIError } = await import('../src/utils/api.js');
      mockCheckGitHubAppInstallation.mockRejectedValue(new APIError(401, 'UNAUTHORIZED', 'Invalid token'));

      const { initCommand } = await import('../src/cmds/init.js');

      await expect(initCommand({})).rejects.toThrow('process.exit(1)');
      expect(lastExitCode).toBe(1);
      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('KEYWAY_TOKEN'));
    });
  });

  describe('session handling', () => {
    it('should clear auth and re-prompt when stored token is invalid (401)', async () => {
      const { APIError } = await import('../src/utils/api.js');
      mockCheckGitHubAppInstallation.mockRejectedValueOnce(new APIError(401, 'UNAUTHORIZED', 'Invalid'))
        .mockResolvedValue({ installed: true });

      // After clearing auth, user should be prompted to log in
      mockGetStoredAuth.mockResolvedValue({ keywayToken: 'old-token' });
      mockPrompts.mockResolvedValue({ shouldProceed: true });
      mockStartDeviceLogin.mockResolvedValue({
        deviceCode: 'code',
        userCode: 'USER-CODE',
        interval: 1,
        githubAppInstallUrl: 'https://github.com/apps/keyway',
      });
      mockPollDeviceLogin.mockResolvedValue({
        status: 'approved',
        keywayToken: 'new-token',
        githubLogin: 'user',
      });

      const { initCommand } = await import('../src/cmds/init.js');

      await initCommand({});

      expect(mockClearAuth).toHaveBeenCalled();
    });
  });

  describe('GitHub App installation flow', () => {
    it('should prompt to install GitHub App when not installed', async () => {
      mockCheckGitHubAppInstallation
        .mockResolvedValueOnce({ installed: false, installUrl: 'https://install.url' })
        .mockResolvedValue({ installed: true });
      mockPrompts.mockResolvedValue({ shouldInstall: true });

      const { initCommand } = await import('../src/cmds/init.js');

      await initCommand({});

      expect(mockOpenUrl).toHaveBeenCalledWith('https://install.url');
    });

    it('should exit with code 1 if user declines GitHub App installation', async () => {
      mockCheckGitHubAppInstallation.mockResolvedValue({
        installed: false,
        installUrl: 'https://install.url'
      });
      mockPrompts.mockResolvedValue({ shouldInstall: false });

      const { initCommand } = await import('../src/cmds/init.js');

      await expect(initCommand({})).rejects.toThrow('process.exit(1)');
      expect(lastExitCode).toBe(1);
      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('GitHub App'));
    });
  });

  describe('unified login + app install flow', () => {
    it('should handle full login flow when not logged in', async () => {
      mockGetStoredAuth.mockResolvedValue(null);
      mockPrompts.mockResolvedValue({ shouldProceed: true });
      mockStartDeviceLogin.mockResolvedValue({
        deviceCode: 'device-code',
        userCode: 'USER-123',
        interval: 1,
        githubAppInstallUrl: 'https://github.com/apps/keyway/installations/new',
      });
      mockPollDeviceLogin.mockResolvedValue({
        status: 'approved',
        keywayToken: 'new-jwt-token',
        githubLogin: 'newuser',
        expiresAt: '2025-12-31T00:00:00Z',
      });
      mockCheckGitHubAppInstallation.mockResolvedValue({ installed: true });

      const { initCommand } = await import('../src/cmds/init.js');

      await initCommand({});

      expect(mockStartDeviceLogin).toHaveBeenCalledWith('owner/repo');
      expect(mockOpenUrl).toHaveBeenCalled();
      expect(mockSaveAuthToken).toHaveBeenCalledWith('new-jwt-token', {
        githubLogin: 'newuser',
        expiresAt: '2025-12-31T00:00:00Z',
      });
      expect(mockIdentifyUser).toHaveBeenCalledWith('newuser', expect.any(Object));
    });

    it('should exit with code 1 if user is not logged in and non-interactive', async () => {
      mockGetStoredAuth.mockResolvedValue(null);

      const { isInteractive } = await import('../src/utils/helpers.js');
      vi.mocked(isInteractive).mockReturnValue(false);

      const { initCommand } = await import('../src/cmds/init.js');

      await expect(initCommand({})).rejects.toThrow('process.exit(1)');
      expect(lastExitCode).toBe(1);
      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('keyway login'));
    });

    it('should exit with code 1 if user declines to proceed', async () => {
      mockGetStoredAuth.mockResolvedValue(null);
      mockPrompts.mockResolvedValue({ shouldProceed: false });

      // Ensure isInteractive returns true for this test
      const { isInteractive } = await import('../src/utils/helpers.js');
      vi.mocked(isInteractive).mockReturnValue(true);

      const { initCommand } = await import('../src/cmds/init.js');

      await expect(initCommand({})).rejects.toThrow('process.exit(1)');
      expect(lastExitCode).toBe(1);
      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('Setup required'));
    });
  });

  describe('error handling', () => {
    it('should handle 409 conflict as already initialized', async () => {
      const { APIError } = await import('../src/utils/api.js');
      mockCheckVaultExists.mockResolvedValue(false);
      mockInitVault.mockRejectedValue(new APIError(409, 'CONFLICT', 'Vault already exists'));

      const { initCommand } = await import('../src/cmds/init.js');

      await initCommand({});

      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('Already initialized'));
    });

    it('should exit with code 1 and show plan limit error with upgrade URL', async () => {
      const { APIError } = await import('../src/utils/api.js');
      mockInitVault.mockRejectedValue(new APIError(
        403,
        'Plan Limit Reached',
        'Free plan allows 1 vault',
        'https://keyway.sh/upgrade'
      ));

      const { initCommand } = await import('../src/cmds/init.js');

      await expect(initCommand({})).rejects.toThrow('process.exit(1)');
      expect(lastExitCode).toBe(1);
      expect(mockShowUpgradePrompt).toHaveBeenCalledWith(
        'Free plan allows 1 vault',
        'https://keyway.sh/upgrade'
      );
    });

    it('should track errors to analytics and exit with code 1', async () => {
      mockInitVault.mockRejectedValue(new Error('Network error'));

      const { initCommand } = await import('../src/cmds/init.js');

      await expect(initCommand({})).rejects.toThrow('process.exit(1)');
      expect(lastExitCode).toBe(1);
      expect(mockTrackEvent).toHaveBeenCalledWith('cli_error', expect.objectContaining({
        command: 'init',
        error: expect.stringContaining('Network error'),
      }));
    });

    it('should always shutdown analytics on error', async () => {
      mockInitVault.mockRejectedValue(new Error('Some error'));

      const { initCommand } = await import('../src/cmds/init.js');

      await expect(initCommand({})).rejects.toThrow('process.exit(1)');
      expect(lastExitCode).toBe(1);
      expect(mockShutdownAnalytics).toHaveBeenCalled();
    });
  });

  describe('non-interactive mode', () => {
    beforeEach(() => {
      Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
      Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
    });

    it('should not prompt to push secrets in non-interactive mode', async () => {
      mockDiscoverEnvCandidates.mockReturnValue([{ file: '.env', env: 'development' }]);

      const { initCommand } = await import('../src/cmds/init.js');

      await initCommand({});

      expect(mockPushCommand).not.toHaveBeenCalled();
    });
  });

  describe('empty vault warning', () => {
    it('should show next steps when no .env file is found', async () => {
      mockDiscoverEnvCandidates.mockReturnValue([]);

      const { initCommand } = await import('../src/cmds/init.js');

      await initCommand({});

      // In non-interactive mode, shows next steps message
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('Next:'));
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('keyway push'));
    });

    it('should not show empty vault warning when .env files exist', async () => {
      mockDiscoverEnvCandidates.mockReturnValue([{ file: '.env', env: 'development' }]);
      mockPrompts.mockResolvedValue({ shouldPush: false });

      const { initCommand } = await import('../src/cmds/init.js');

      await initCommand({});

      const calls = mockConsoleLog.mock.calls.map(call => call[0]);
      const hasEmptyWarning = calls.some(msg =>
        typeof msg === 'string' && msg.includes('No .env file found')
      );
      expect(hasEmptyWarning).toBe(false);
    });
  });
});
