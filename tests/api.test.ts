import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { truncateMessage, APIError } from '../src/utils/api.js';

describe('api utilities', () => {
  describe('truncateMessage', () => {
    it('should return message unchanged if shorter than maxLength', () => {
      expect(truncateMessage('short', 200)).toBe('short');
    });

    it('should return message unchanged if equal to maxLength', () => {
      const msg = 'a'.repeat(200);
      expect(truncateMessage(msg, 200)).toBe(msg);
    });

    it('should truncate and add ellipsis if longer than maxLength', () => {
      const msg = 'a'.repeat(250);
      const result = truncateMessage(msg, 200);
      expect(result).toHaveLength(200);
      expect(result.endsWith('...')).toBe(true);
      expect(result).toBe('a'.repeat(197) + '...');
    });

    it('should use default maxLength of 200', () => {
      const msg = 'a'.repeat(250);
      const result = truncateMessage(msg);
      expect(result).toHaveLength(200);
    });

    it('should handle empty string', () => {
      expect(truncateMessage('')).toBe('');
    });

    it('should handle very short maxLength', () => {
      expect(truncateMessage('hello world', 5)).toBe('he...');
    });
  });

  describe('APIError', () => {
    it('should construct with required properties', () => {
      const error = new APIError(404, 'NOT_FOUND', 'Resource not found');

      expect(error.statusCode).toBe(404);
      expect(error.error).toBe('NOT_FOUND');
      expect(error.message).toBe('Resource not found');
      expect(error.upgradeUrl).toBeUndefined();
      expect(error.name).toBe('APIError');
    });

    it('should construct with upgradeUrl', () => {
      const error = new APIError(
        403,
        'PLAN_LIMIT',
        'You have reached your plan limit',
        'https://keyway.sh/upgrade'
      );

      expect(error.statusCode).toBe(403);
      expect(error.upgradeUrl).toBe('https://keyway.sh/upgrade');
    });

    it('should be instanceof Error', () => {
      const error = new APIError(500, 'INTERNAL', 'Something went wrong');
      expect(error instanceof Error).toBe(true);
      expect(error instanceof APIError).toBe(true);
    });

    it('should have correct name for stack traces', () => {
      const error = new APIError(400, 'BAD_REQUEST', 'Invalid input');
      expect(error.name).toBe('APIError');
      expect(error.stack).toContain('APIError');
    });
  });
});

describe('api functions with mocked fetch', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Helper to create mock response
  function createMockResponse(options: {
    ok?: boolean;
    status?: number;
    json?: object;
    text?: string;
    contentType?: string;
  }) {
    const { ok = true, status = 200, json, text, contentType = 'application/json' } = options;
    return {
      ok,
      status,
      headers: new Headers({ 'content-type': contentType }),
      text: () => Promise.resolve(json ? JSON.stringify(json) : text || ''),
    };
  }

  describe('pushSecrets', () => {
    it('should send correct request and return data on success', async () => {
      mockFetch.mockResolvedValue(createMockResponse({
        json: {
          data: {
            message: 'Secrets pushed successfully',
            stats: { created: 2, updated: 1, deleted: 0 },
          },
        },
      }));

      const { pushSecrets } = await import('../src/utils/api.js');
      const result = await pushSecrets('owner/repo', 'production', 'KEY1=value1\nKEY2=value2', 'test-token');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain('/v1/secrets/push');
      expect(options.method).toBe('POST');
      expect(options.headers.Authorization).toBe('Bearer test-token');

      const body = JSON.parse(options.body);
      expect(body.repoFullName).toBe('owner/repo');
      expect(body.environment).toBe('production');
      expect(body.secrets).toEqual({ KEY1: 'value1', KEY2: 'value2' });

      expect(result.message).toBe('Secrets pushed successfully');
      expect(result.stats).toEqual({ created: 2, updated: 1, deleted: 0 });
    });

    it('should parse env content with quoted values', async () => {
      mockFetch.mockResolvedValue(createMockResponse({
        json: { data: { message: 'OK', stats: { created: 1, updated: 0, deleted: 0 } } },
      }));

      const { pushSecrets } = await import('../src/utils/api.js');
      await pushSecrets('owner/repo', 'dev', 'KEY="quoted value"', 'token');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.secrets.KEY).toBe('quoted value');
    });

    it('should parse env content with single quoted values', async () => {
      mockFetch.mockResolvedValue(createMockResponse({
        json: { data: { message: 'OK', stats: { created: 1, updated: 0, deleted: 0 } } },
      }));

      const { pushSecrets } = await import('../src/utils/api.js');
      await pushSecrets('owner/repo', 'dev', "KEY='single quoted'", 'token');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.secrets.KEY).toBe('single quoted');
    });

    it('should skip comments and empty lines', async () => {
      mockFetch.mockResolvedValue(createMockResponse({
        json: { data: { message: 'OK', stats: { created: 1, updated: 0, deleted: 0 } } },
      }));

      const { pushSecrets } = await import('../src/utils/api.js');
      await pushSecrets('owner/repo', 'dev', '# comment\n\nKEY=value\n  \n# another', 'token');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(Object.keys(body.secrets)).toEqual(['KEY']);
    });

    it('should throw APIError on 403 plan limit', async () => {
      mockFetch.mockResolvedValue(createMockResponse({
        ok: false,
        status: 403,
        json: {
          title: 'PLAN_LIMIT_REACHED',
          detail: 'This vault is read-only on Free plan',
          upgradeUrl: 'https://keyway.sh/upgrade',
        },
      }));

      const { pushSecrets } = await import('../src/utils/api.js');

      await expect(pushSecrets('owner/repo', 'prod', 'K=V', 'token'))
        .rejects.toThrow(APIError);

      try {
        await pushSecrets('owner/repo', 'prod', 'K=V', 'token');
      } catch (e) {
        expect(e).toBeInstanceOf(APIError);
        expect((e as APIError).statusCode).toBe(403);
        expect((e as APIError).upgradeUrl).toBe('https://keyway.sh/upgrade');
      }
    });
  });

  describe('pullSecrets', () => {
    it('should return content on success', async () => {
      mockFetch.mockResolvedValue(createMockResponse({
        json: {
          data: { content: 'KEY1=secret1\nKEY2=secret2' },
        },
      }));

      const { pullSecrets } = await import('../src/utils/api.js');
      const result = await pullSecrets('owner/repo', 'production', 'test-token');

      expect(result.content).toBe('KEY1=secret1\nKEY2=secret2');

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain('/v1/secrets/pull');
      expect(url).toContain('repo=owner%2Frepo');
      expect(url).toContain('environment=production');
      expect(options.method).toBe('GET');
    });

    it('should throw APIError on 404', async () => {
      mockFetch.mockResolvedValue(createMockResponse({
        ok: false,
        status: 404,
        json: {
          title: 'NOT_FOUND',
          detail: "Environment 'staging' does not exist",
        },
      }));

      const { pullSecrets } = await import('../src/utils/api.js');

      await expect(pullSecrets('owner/repo', 'staging', 'token'))
        .rejects.toThrow(APIError);
    });
  });

  describe('validateToken', () => {
    it('should return user info on valid token', async () => {
      mockFetch.mockResolvedValue(createMockResponse({
        json: {
          data: {
            valid: true,
            username: 'testuser',
            userId: '123',
          },
        },
      }));

      const { validateToken } = await import('../src/utils/api.js');
      const result = await validateToken('valid-token');

      expect(result.username).toBe('testuser');
      expect(result.valid).toBe(true);
    });

    it('should throw APIError on 401 invalid token', async () => {
      mockFetch.mockResolvedValue(createMockResponse({
        ok: false,
        status: 401,
        json: {
          title: 'UNAUTHORIZED',
          detail: 'Invalid or expired token',
        },
      }));

      const { validateToken } = await import('../src/utils/api.js');

      await expect(validateToken('invalid-token'))
        .rejects.toThrow(APIError);
    });
  });

  describe('device login flow', () => {
    it('startDeviceLogin should return device code info', async () => {
      mockFetch.mockResolvedValue(createMockResponse({
        json: {
          deviceCode: 'abc123',
          userCode: 'USER-CODE',
          verificationUri: 'https://keyway.sh/device',
          verificationUriComplete: 'https://keyway.sh/device?code=USER-CODE',
          expiresIn: 900,
          interval: 5,
        },
      }));

      const { startDeviceLogin } = await import('../src/utils/api.js');
      const result = await startDeviceLogin('owner/repo');

      expect(result.deviceCode).toBe('abc123');
      expect(result.userCode).toBe('USER-CODE');
      expect(result.interval).toBe(5);
    });

    it('pollDeviceLogin should return pending status', async () => {
      mockFetch.mockResolvedValue(createMockResponse({
        json: { status: 'pending' },
      }));

      const { pollDeviceLogin } = await import('../src/utils/api.js');
      const result = await pollDeviceLogin('abc123');

      expect(result.status).toBe('pending');
    });

    it('pollDeviceLogin should return approved status with token', async () => {
      mockFetch.mockResolvedValue(createMockResponse({
        json: {
          status: 'approved',
          keywayToken: 'jwt-token',
          githubLogin: 'testuser',
        },
      }));

      const { pollDeviceLogin } = await import('../src/utils/api.js');
      const result = await pollDeviceLogin('abc123');

      expect(result.status).toBe('approved');
      expect(result.keywayToken).toBe('jwt-token');
      expect(result.githubLogin).toBe('testuser');
    });
  });

  describe('env parsing edge cases', () => {
    it('should handle values with equals signs', async () => {
      mockFetch.mockResolvedValue(createMockResponse({
        json: { data: { message: 'OK', stats: { created: 1, updated: 0, deleted: 0 } } },
      }));

      const { pushSecrets } = await import('../src/utils/api.js');
      await pushSecrets('owner/repo', 'dev', 'URL=https://example.com?foo=bar&baz=qux', 'token');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.secrets.URL).toBe('https://example.com?foo=bar&baz=qux');
    });

    it('should handle values with special characters', async () => {
      mockFetch.mockResolvedValue(createMockResponse({
        json: { data: { message: 'OK', stats: { created: 1, updated: 0, deleted: 0 } } },
      }));

      const { pushSecrets } = await import('../src/utils/api.js');
      await pushSecrets('owner/repo', 'dev', 'PASSWORD=p@$$w0rd!#%^&*()', 'token');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.secrets.PASSWORD).toBe('p@$$w0rd!#%^&*()');
    });

    it('should handle multiline values in quotes', async () => {
      mockFetch.mockResolvedValue(createMockResponse({
        json: { data: { message: 'OK', stats: { created: 1, updated: 0, deleted: 0 } } },
      }));

      const { pushSecrets } = await import('../src/utils/api.js');
      const content = 'CERT="-----BEGIN CERTIFICATE-----\nMIIC...\n-----END CERTIFICATE-----"';
      await pushSecrets('owner/repo', 'dev', content, 'token');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.secrets.CERT).toContain('BEGIN CERTIFICATE');
    });

    it('should handle empty values', async () => {
      mockFetch.mockResolvedValue(createMockResponse({
        json: { data: { message: 'OK', stats: { created: 1, updated: 0, deleted: 0 } } },
      }));

      const { pushSecrets } = await import('../src/utils/api.js');
      await pushSecrets('owner/repo', 'dev', 'EMPTY_VAR=', 'token');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.secrets.EMPTY_VAR).toBe('');
    });

    it('should handle keys with underscores and numbers', async () => {
      mockFetch.mockResolvedValue(createMockResponse({
        json: { data: { message: 'OK', stats: { created: 1, updated: 0, deleted: 0 } } },
      }));

      const { pushSecrets } = await import('../src/utils/api.js');
      await pushSecrets('owner/repo', 'dev', 'MY_API_KEY_2=value123', 'token');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.secrets.MY_API_KEY_2).toBe('value123');
    });

    it('should preserve whitespace in quoted values', async () => {
      mockFetch.mockResolvedValue(createMockResponse({
        json: { data: { message: 'OK', stats: { created: 1, updated: 0, deleted: 0 } } },
      }));

      const { pushSecrets } = await import('../src/utils/api.js');
      await pushSecrets('owner/repo', 'dev', 'SPACED="  leading and trailing  "', 'token');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.secrets.SPACED).toBe('  leading and trailing  ');
    });

    it('should skip lines without equals sign', async () => {
      mockFetch.mockResolvedValue(createMockResponse({
        json: { data: { message: 'OK', stats: { created: 1, updated: 0, deleted: 0 } } },
      }));

      const { pushSecrets } = await import('../src/utils/api.js');
      await pushSecrets('owner/repo', 'dev', 'INVALID_LINE\nVALID_KEY=value', 'token');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(Object.keys(body.secrets)).toEqual(['VALID_KEY']);
      expect(body.secrets.VALID_KEY).toBe('value');
    });
  });

  describe('request headers validation', () => {
    it('should send correct Content-Type header', async () => {
      mockFetch.mockResolvedValue(createMockResponse({
        json: { data: { message: 'OK', stats: { created: 1, updated: 0, deleted: 0 } } },
      }));

      const { pushSecrets } = await import('../src/utils/api.js');
      await pushSecrets('owner/repo', 'dev', 'K=V', 'token');

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('should send Authorization header with Bearer token', async () => {
      mockFetch.mockResolvedValue(createMockResponse({
        json: { data: { message: 'OK', stats: { created: 1, updated: 0, deleted: 0 } } },
      }));

      const { pushSecrets } = await import('../src/utils/api.js');
      await pushSecrets('owner/repo', 'dev', 'K=V', 'my-secret-token');

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers.Authorization).toBe('Bearer my-secret-token');
    });
  });

  describe('error handling', () => {
    it('should throw timeout error', async () => {
      mockFetch.mockImplementation(() => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        return Promise.reject(error);
      });

      const { pushSecrets } = await import('../src/utils/api.js');

      await expect(pushSecrets('owner/repo', 'dev', 'K=V', 'token'))
        .rejects.toThrow(/timeout/i);
    });

    it('should handle network errors with friendly messages', async () => {
      const networkError = new Error('fetch failed');
      (networkError as any).cause = { code: 'ECONNREFUSED' };
      mockFetch.mockRejectedValue(networkError);

      const { pushSecrets } = await import('../src/utils/api.js');

      await expect(pushSecrets('owner/repo', 'dev', 'K=V', 'token'))
        .rejects.toThrow(/connect|server/i);
    });

    it('should parse non-JSON error responses', async () => {
      mockFetch.mockResolvedValue(createMockResponse({
        ok: false,
        status: 500,
        text: 'Internal Server Error',
        contentType: 'text/plain',
      }));

      const { pushSecrets } = await import('../src/utils/api.js');

      await expect(pushSecrets('owner/repo', 'dev', 'K=V', 'token'))
        .rejects.toThrow(APIError);
    });

    it('should handle DNS resolution errors (ENOTFOUND)', async () => {
      const dnsError = new Error('getaddrinfo ENOTFOUND api.keyway.sh');
      (dnsError as any).cause = { code: 'ENOTFOUND' };
      mockFetch.mockRejectedValue(dnsError);

      const { pushSecrets } = await import('../src/utils/api.js');

      await expect(pushSecrets('owner/repo', 'dev', 'K=V', 'token'))
        .rejects.toThrow();
    });

    it('should handle socket timeout errors (ETIMEDOUT)', async () => {
      const timeoutError = new Error('connect ETIMEDOUT');
      (timeoutError as any).cause = { code: 'ETIMEDOUT' };
      mockFetch.mockRejectedValue(timeoutError);

      const { pushSecrets } = await import('../src/utils/api.js');

      await expect(pushSecrets('owner/repo', 'dev', 'K=V', 'token'))
        .rejects.toThrow();
    });
  });

  describe('robustness tests', () => {
    it('should handle env content with UTF-8 BOM', async () => {
      mockFetch.mockResolvedValue(createMockResponse({
        json: { data: { message: 'OK', stats: { created: 1, updated: 0, deleted: 0 } } },
      }));

      const { pushSecrets } = await import('../src/utils/api.js');
      // UTF-8 BOM is \uFEFF (EF BB BF in bytes)
      const contentWithBOM = '\uFEFFKEY=value';
      await pushSecrets('owner/repo', 'dev', contentWithBOM, 'token');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      // The key should be parsed correctly even with BOM
      expect(Object.keys(body.secrets).length).toBeGreaterThan(0);
      // Either the BOM is stripped or included in the key name
      const hasKey = 'KEY' in body.secrets || '\uFEFFKEY' in body.secrets;
      expect(hasKey).toBe(true);
    });

    it('should handle env content with Windows line endings (CRLF)', async () => {
      mockFetch.mockResolvedValue(createMockResponse({
        json: { data: { message: 'OK', stats: { created: 2, updated: 0, deleted: 0 } } },
      }));

      const { pushSecrets } = await import('../src/utils/api.js');
      const windowsContent = 'KEY1=value1\r\nKEY2=value2\r\n';
      await pushSecrets('owner/repo', 'dev', windowsContent, 'token');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.secrets.KEY1).toBe('value1');
      expect(body.secrets.KEY2).toBe('value2');
    });

    it('should handle very long values', async () => {
      mockFetch.mockResolvedValue(createMockResponse({
        json: { data: { message: 'OK', stats: { created: 1, updated: 0, deleted: 0 } } },
      }));

      const { pushSecrets } = await import('../src/utils/api.js');
      const longValue = 'x'.repeat(10000);
      await pushSecrets('owner/repo', 'dev', `LONG_KEY=${longValue}`, 'token');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.secrets.LONG_KEY).toBe(longValue);
    });

    it('should handle unicode characters in values', async () => {
      mockFetch.mockResolvedValue(createMockResponse({
        json: { data: { message: 'OK', stats: { created: 1, updated: 0, deleted: 0 } } },
      }));

      const { pushSecrets } = await import('../src/utils/api.js');
      const unicodeContent = 'MESSAGE=Hello 世界 🚀 مرحبا';
      await pushSecrets('owner/repo', 'dev', unicodeContent, 'token');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.secrets.MESSAGE).toBe('Hello 世界 🚀 مرحبا');
    });

    it('should handle 401 expired token error', async () => {
      mockFetch.mockResolvedValue(createMockResponse({
        ok: false,
        status: 401,
        json: {
          title: 'UNAUTHORIZED',
          detail: 'Token has expired',
        },
      }));

      const { pushSecrets } = await import('../src/utils/api.js');

      try {
        await pushSecrets('owner/repo', 'dev', 'K=V', 'expired-token');
        expect.fail('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(APIError);
        expect((e as APIError).statusCode).toBe(401);
        expect((e as APIError).message).toContain('expired');
      }
    });

    it('should handle response with empty body gracefully', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 204,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(''),
      });

      const { pushSecrets } = await import('../src/utils/api.js');

      // Empty 204 response should be handled gracefully (returns undefined)
      const result = await pushSecrets('owner/repo', 'dev', 'K=V', 'token');
      expect(result).toBeUndefined();
    });
  });
});
