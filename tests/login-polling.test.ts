import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MAX_CONSECUTIVE_ERRORS } from '../src/utils/helpers.js';

// Mock the API module
vi.mock('../src/utils/api.js', () => ({
  pollDeviceLogin: vi.fn(),
  startDeviceLogin: vi.fn(),
  validateToken: vi.fn(),
  truncateMessage: (msg: string) => msg,
}));

// Mock auth module
vi.mock('../src/utils/auth.js', () => ({
  saveAuthToken: vi.fn().mockResolvedValue(undefined),
  getStoredAuth: vi.fn().mockResolvedValue(null),
  clearAuth: vi.fn(),
  getAuthFilePath: vi.fn().mockReturnValue('/mock/path'),
}));

// Mock git module
vi.mock('../src/utils/git.js', () => ({
  detectGitRepo: vi.fn().mockReturnValue('owner/repo'),
}));

// Mock analytics
vi.mock('../src/utils/analytics.js', () => ({
  trackEvent: vi.fn(),
  identifyUser: vi.fn(),
  AnalyticsEvents: { CLI_LOGIN: 'cli_login', CLI_ERROR: 'cli_error' },
}));

// Mock open
vi.mock('open', () => ({ default: vi.fn().mockResolvedValue(undefined) }));

describe('Login polling with consecutive errors', () => {
  let pollDeviceLogin: ReturnType<typeof vi.fn>;
  let startDeviceLogin: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();

    const apiModule = await import('../src/utils/api.js');
    pollDeviceLogin = vi.mocked(apiModule.pollDeviceLogin);
    startDeviceLogin = vi.mocked(apiModule.startDeviceLogin);

    // Default mock for startDeviceLogin
    startDeviceLogin.mockResolvedValue({
      deviceCode: 'test-device-code',
      userCode: 'TEST-CODE',
      verificationUri: 'https://test.com/verify',
      verificationUriComplete: 'https://test.com/verify?code=TEST',
      interval: 1, // 1 second for tests
      expiresIn: 300,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('should succeed after transient errors followed by success', async () => {
    // Fail twice, then succeed
    let callCount = 0;
    pollDeviceLogin.mockImplementation(async () => {
      callCount++;
      if (callCount <= 2) {
        throw new Error('Network error');
      }
      return {
        status: 'approved',
        keywayToken: 'test-token',
        githubLogin: 'testuser',
      };
    });

    const { runLoginFlow } = await import('../src/cmds/login.js');

    // Start the login flow
    const loginPromise = runLoginFlow();

    // Advance through the polling intervals
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(1100);
    }

    const result = await loginPromise;

    expect(result).toBe('test-token');
    expect(callCount).toBe(3); // 2 failures + 1 success
  });

  it('should fail after MAX_CONSECUTIVE_ERRORS consecutive failures', async () => {
    pollDeviceLogin.mockRejectedValue(new Error('Persistent network error'));

    const { runLoginFlow } = await import('../src/cmds/login.js');

    const loginPromise = runLoginFlow();

    // Advance timers for each polling attempt and catch the error
    let error: Error | null = null;
    loginPromise.catch((e) => {
      error = e;
    });

    for (let i = 0; i < MAX_CONSECUTIVE_ERRORS + 2; i++) {
      await vi.advanceTimersByTimeAsync(1100);
    }

    // Wait for the promise to settle
    await vi.runAllTimersAsync();

    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/consecutive errors/);
    expect(pollDeviceLogin).toHaveBeenCalledTimes(MAX_CONSECUTIVE_ERRORS);
  });

  it('should reset error count on successful API call', async () => {
    // Pattern: 2 errors, 1 pending, 2 errors, 1 pending, then success
    let callCount = 0;
    pollDeviceLogin.mockImplementation(async () => {
      callCount++;
      // Errors on calls 1, 2, 4, 5
      if (callCount === 1 || callCount === 2 || callCount === 4 || callCount === 5) {
        throw new Error('Transient error');
      }
      // Pending on calls 3, 6
      if (callCount === 3 || callCount === 6) {
        return { status: 'pending' };
      }
      // Success on call 7
      return {
        status: 'approved',
        keywayToken: 'final-token',
        githubLogin: 'user',
      };
    });

    const { runLoginFlow } = await import('../src/cmds/login.js');
    const loginPromise = runLoginFlow();

    // Advance through all attempts
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(1100);
    }

    const result = await loginPromise;
    expect(result).toBe('final-token');
    expect(callCount).toBe(7);
  });

  it('should handle pending status without counting as error', async () => {
    let callCount = 0;
    pollDeviceLogin.mockImplementation(async () => {
      callCount++;
      if (callCount < 5) {
        return { status: 'pending' };
      }
      return {
        status: 'approved',
        keywayToken: 'token-after-pending',
        githubLogin: 'user',
      };
    });

    const { runLoginFlow } = await import('../src/cmds/login.js');
    const loginPromise = runLoginFlow();

    for (let i = 0; i < 7; i++) {
      await vi.advanceTimersByTimeAsync(1100);
    }

    const result = await loginPromise;
    expect(result).toBe('token-after-pending');
    expect(callCount).toBe(5);
  });
});
