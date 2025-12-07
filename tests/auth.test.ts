import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

// Create a mock store that simulates Conf behavior
const mockStore = new Map<string, string>();
const mockConfPath = '/mock/config/keyway-nodejs/config.json';

vi.mock('conf', () => {
  return {
    default: class MockConf {
      get(key: string) {
        return mockStore.get(key);
      }
      set(key: string, value: string) {
        mockStore.set(key, value);
      }
      delete(key: string) {
        mockStore.delete(key);
      }
      get path() {
        return mockConfPath;
      }
    },
  };
});

// Mock filesystem
const mockFs = {
  files: new Map<string, string>(),
  dirs: new Set<string>(),
};

vi.mock('fs', () => ({
  existsSync: (path: string) => mockFs.files.has(path) || mockFs.dirs.has(path),
  readFileSync: (path: string) => {
    const content = mockFs.files.get(path);
    if (content === undefined) throw new Error(`ENOENT: no such file: ${path}`);
    return content;
  },
  writeFileSync: (path: string, content: string) => {
    mockFs.files.set(path, content);
  },
  mkdirSync: (path: string) => {
    mockFs.dirs.add(path);
  },
  chmodSync: () => {},
}));

// Mock os.homedir
vi.mock('os', () => ({
  homedir: () => '/mock/home',
}));

describe('auth module', () => {
  beforeEach(() => {
    // Reset all mocks
    mockStore.clear();
    mockFs.files.clear();
    mockFs.dirs.clear();
    vi.resetModules();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getStoredAuth', () => {
    it('should return null when no auth is stored', async () => {
      const { getStoredAuth } = await import('../src/utils/auth.js');
      const result = await getStoredAuth();
      expect(result).toBeNull();
    });

    it('should return stored auth after saveAuthToken', async () => {
      const { saveAuthToken, getStoredAuth } = await import('../src/utils/auth.js');

      await saveAuthToken('test-jwt-token', {
        githubLogin: 'testuser',
      });

      const auth = await getStoredAuth();
      expect(auth).not.toBeNull();
      expect(auth?.keywayToken).toBe('test-jwt-token');
      expect(auth?.githubLogin).toBe('testuser');
      expect(auth?.createdAt).toBeDefined();
    });

    it('should return null for expired token', async () => {
      const { saveAuthToken, getStoredAuth } = await import('../src/utils/auth.js');

      // Save token that expired in the past
      await saveAuthToken('expired-token', {
        githubLogin: 'user',
        expiresAt: new Date(Date.now() - 1000).toISOString(), // 1 second ago
      });

      const auth = await getStoredAuth();
      expect(auth).toBeNull();
    });

    it('should return valid non-expired token', async () => {
      const { saveAuthToken, getStoredAuth } = await import('../src/utils/auth.js');

      // Save token that expires in the future
      const futureDate = new Date(Date.now() + 86400000).toISOString(); // 24 hours from now
      await saveAuthToken('valid-token', {
        githubLogin: 'user',
        expiresAt: futureDate,
      });

      const auth = await getStoredAuth();
      expect(auth).not.toBeNull();
      expect(auth?.keywayToken).toBe('valid-token');
    });

    it('should return auth without expiresAt (never expires)', async () => {
      const { saveAuthToken, getStoredAuth } = await import('../src/utils/auth.js');

      await saveAuthToken('permanent-token', { githubLogin: 'user' });

      const auth = await getStoredAuth();
      expect(auth).not.toBeNull();
      expect(auth?.keywayToken).toBe('permanent-token');
      expect(auth?.expiresAt).toBeUndefined();
    });

    it('should clear auth and return null on decryption failure', async () => {
      const { getStoredAuth } = await import('../src/utils/auth.js');

      // Store invalid encrypted data
      mockStore.set('auth', 'invalid:encrypted:data');

      // Mock console.error to verify it's called
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      const auth = await getStoredAuth();

      expect(auth).toBeNull();
      expect(consoleError).toHaveBeenCalledWith('Failed to decrypt stored auth, clearing...');
      expect(mockStore.has('auth')).toBe(false);

      consoleError.mockRestore();
    });
  });

  describe('saveAuthToken', () => {
    it('should encrypt and store auth data', async () => {
      const { saveAuthToken } = await import('../src/utils/auth.js');

      await saveAuthToken('my-token', { githubLogin: 'myuser' });

      // Verify something is stored
      const stored = mockStore.get('auth');
      expect(stored).toBeDefined();
      expect(stored).not.toContain('my-token'); // Should be encrypted, not plain text

      // Verify format: iv:authTag:encrypted
      const parts = stored!.split(':');
      expect(parts).toHaveLength(3);
      expect(parts[0]).toMatch(/^[0-9a-f]{32}$/); // IV is 16 bytes = 32 hex chars
      expect(parts[1]).toMatch(/^[0-9a-f]{32}$/); // AuthTag is 16 bytes = 32 hex chars
      expect(parts[2].length).toBeGreaterThan(0); // Encrypted data
    });

    it('should store createdAt timestamp', async () => {
      const { saveAuthToken, getStoredAuth } = await import('../src/utils/auth.js');

      const before = Date.now();
      await saveAuthToken('token', {});
      const after = Date.now();

      const auth = await getStoredAuth();
      expect(auth?.createdAt).toBeDefined();

      const createdAt = Date.parse(auth!.createdAt);
      expect(createdAt).toBeGreaterThanOrEqual(before);
      expect(createdAt).toBeLessThanOrEqual(after);
    });
  });

  describe('clearAuth', () => {
    it('should remove stored auth', async () => {
      const { saveAuthToken, clearAuth, getStoredAuth } = await import('../src/utils/auth.js');

      await saveAuthToken('token-to-clear', { githubLogin: 'user' });

      // Verify it's stored
      let auth = await getStoredAuth();
      expect(auth).not.toBeNull();

      // Clear it
      clearAuth();

      // Verify it's gone
      auth = await getStoredAuth();
      expect(auth).toBeNull();
    });

    it('should not throw when no auth exists', async () => {
      const { clearAuth } = await import('../src/utils/auth.js');

      // Should not throw
      expect(() => clearAuth()).not.toThrow();
    });
  });

  describe('getAuthFilePath', () => {
    it('should return the config file path', async () => {
      const { getAuthFilePath } = await import('../src/utils/auth.js');

      const path = getAuthFilePath();
      expect(path).toBe(mockConfPath);
    });
  });

  describe('encryption key management', () => {
    it('should create key directory and file on first use', async () => {
      const { saveAuthToken } = await import('../src/utils/auth.js');

      await saveAuthToken('token', {});

      // Verify key file was created
      expect(mockFs.dirs.has('/mock/home/.keyway')).toBe(true);
      expect(mockFs.files.has('/mock/home/.keyway/.key')).toBe(true);

      // Verify key format (64 hex chars = 32 bytes)
      const keyContent = mockFs.files.get('/mock/home/.keyway/.key');
      expect(keyContent).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should reuse existing key file', async () => {
      // Pre-create a key file
      const existingKey = 'a'.repeat(64);
      mockFs.dirs.add('/mock/home/.keyway');
      mockFs.files.set('/mock/home/.keyway/.key', existingKey);

      const { saveAuthToken, getStoredAuth } = await import('../src/utils/auth.js');

      await saveAuthToken('my-token', {});

      // Verify the key wasn't overwritten
      expect(mockFs.files.get('/mock/home/.keyway/.key')).toBe(existingKey);

      // Verify we can still read the auth back
      const auth = await getStoredAuth();
      expect(auth?.keywayToken).toBe('my-token');
    });

    it('should regenerate invalid key file', async () => {
      // Pre-create an invalid key file (wrong length)
      mockFs.dirs.add('/mock/home/.keyway');
      mockFs.files.set('/mock/home/.keyway/.key', 'tooshort');

      const { saveAuthToken } = await import('../src/utils/auth.js');

      await saveAuthToken('token', {});

      // Verify key was regenerated with correct length
      const keyContent = mockFs.files.get('/mock/home/.keyway/.key');
      expect(keyContent).toMatch(/^[0-9a-f]{64}$/);
      expect(keyContent).not.toBe('tooshort');
    });
  });

  describe('encryption/decryption round trip', () => {
    it('should correctly encrypt and decrypt various token formats', async () => {
      const { saveAuthToken, getStoredAuth } = await import('../src/utils/auth.js');

      const testCases = [
        { token: 'simple-token', login: 'user1' },
        { token: 'token-with-special-chars-!@#$%^&*()', login: 'user2' },
        { token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N', login: 'jwt-user' },
        { token: 'a'.repeat(1000), login: 'long-token-user' },
        { token: '{"nested":"json"}', login: 'json-user' },
      ];

      for (const { token, login } of testCases) {
        mockStore.clear();

        await saveAuthToken(token, { githubLogin: login });
        const auth = await getStoredAuth();

        expect(auth?.keywayToken).toBe(token);
        expect(auth?.githubLogin).toBe(login);
      }
    });
  });
});
