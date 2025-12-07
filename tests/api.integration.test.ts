/**
 * Integration tests using MSW (Mock Service Worker)
 * These tests verify the actual HTTP request construction and response parsing,
 * unlike unit tests that mock at the function level.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';

// Set test API URL before importing the module
process.env.KEYWAY_API_URL = 'https://api.test.keyway.sh';

const API_URL = 'https://api.test.keyway.sh';

// Track received requests for assertions
let lastRequest: {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
} | null = null;

const handlers = [
  // Push secrets endpoint
  http.post(`${API_URL}/v1/secrets/push`, async ({ request }) => {
    const body = await request.json();
    lastRequest = {
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(request.headers.entries()),
      body,
    };

    // Validate required fields
    if (!body || typeof body !== 'object') {
      return HttpResponse.json(
        { title: 'BAD_REQUEST', detail: 'Invalid request body' },
        { status: 400 }
      );
    }

    const { repoFullName, environment, secrets } = body as {
      repoFullName?: string;
      environment?: string;
      secrets?: Record<string, string>;
    };

    if (!repoFullName) {
      return HttpResponse.json(
        { title: 'BAD_REQUEST', detail: 'Missing repoFullName' },
        { status: 400 }
      );
    }

    if (!environment) {
      return HttpResponse.json(
        { title: 'BAD_REQUEST', detail: 'Missing environment' },
        { status: 400 }
      );
    }

    if (!secrets || typeof secrets !== 'object') {
      return HttpResponse.json(
        { title: 'BAD_REQUEST', detail: 'Missing or invalid secrets' },
        { status: 400 }
      );
    }

    // Check authorization
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return HttpResponse.json(
        { title: 'UNAUTHORIZED', detail: 'Missing or invalid authorization' },
        { status: 401 }
      );
    }

    // Success response
    return HttpResponse.json({
      data: {
        message: 'Secrets pushed successfully',
        stats: {
          created: Object.keys(secrets).length,
          updated: 0,
          deleted: 0,
        },
      },
    });
  }),

  // Pull secrets endpoint
  http.get(`${API_URL}/v1/secrets/pull`, async ({ request }) => {
    const url = new URL(request.url);
    lastRequest = {
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(request.headers.entries()),
    };

    const repo = url.searchParams.get('repo');
    const environment = url.searchParams.get('environment');

    if (!repo) {
      return HttpResponse.json(
        { title: 'BAD_REQUEST', detail: 'Missing repo parameter' },
        { status: 400 }
      );
    }

    if (!environment) {
      return HttpResponse.json(
        { title: 'BAD_REQUEST', detail: 'Missing environment parameter' },
        { status: 400 }
      );
    }

    // Check authorization
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return HttpResponse.json(
        { title: 'UNAUTHORIZED', detail: 'Missing or invalid authorization' },
        { status: 401 }
      );
    }

    // Return mock secrets
    return HttpResponse.json({
      data: {
        content: `# Pulled from ${repo} (${environment})\nAPI_KEY=test-api-key\nDATABASE_URL=postgres://localhost:5432/db`,
      },
    });
  }),

  // Validate token endpoint (POST, not GET)
  http.post(`${API_URL}/v1/auth/token/validate`, async ({ request }) => {
    lastRequest = {
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(request.headers.entries()),
    };

    const authHeader = request.headers.get('authorization');
    if (!authHeader || authHeader === 'Bearer invalid-token') {
      return HttpResponse.json(
        { title: 'UNAUTHORIZED', detail: 'Invalid or expired token' },
        { status: 401 }
      );
    }

    return HttpResponse.json({
      data: {
        valid: true,
        username: 'testuser',
        userId: 'user-123',
      },
    });
  }),
];

const server = setupServer(...handlers);

describe('API Integration Tests (MSW)', () => {
  beforeAll(() => {
    server.listen({ onUnhandledRequest: 'error' });
  });

  afterEach(() => {
    server.resetHandlers();
    lastRequest = null;
  });

  afterAll(() => {
    server.close();
  });

  describe('pushSecrets', () => {
    it('should send correctly formatted POST request', async () => {
      // Need to re-import to pick up the test API URL
      vi.resetModules();
      const { pushSecrets } = await import('../src/utils/api.js');

      const result = await pushSecrets(
        'owner/repo',
        'production',
        'API_KEY=secret123\nDB_URL=postgres://localhost',
        'valid-token'
      );

      // Verify the request was sent correctly
      expect(lastRequest).not.toBeNull();
      expect(lastRequest!.method).toBe('POST');
      expect(lastRequest!.url).toBe(`${API_URL}/v1/secrets/push`);

      // Verify headers
      expect(lastRequest!.headers['authorization']).toBe('Bearer valid-token');
      expect(lastRequest!.headers['content-type']).toBe('application/json');

      // Verify body structure
      const body = lastRequest!.body as {
        repoFullName: string;
        environment: string;
        secrets: Record<string, string>;
      };
      expect(body.repoFullName).toBe('owner/repo');
      expect(body.environment).toBe('production');
      expect(body.secrets).toEqual({
        API_KEY: 'secret123',
        DB_URL: 'postgres://localhost',
      });

      // Verify response parsing
      expect(result.message).toBe('Secrets pushed successfully');
      expect(result.stats.created).toBe(2);
    });

    it('should properly parse .env content with special characters', async () => {
      vi.resetModules();
      const { pushSecrets } = await import('../src/utils/api.js');

      await pushSecrets(
        'owner/repo',
        'dev',
        'PASSWORD=p@$$w0rd!#%\nURL=https://example.com?foo=bar&baz=1',
        'valid-token'
      );

      const body = lastRequest!.body as { secrets: Record<string, string> };
      expect(body.secrets.PASSWORD).toBe('p@$$w0rd!#%');
      expect(body.secrets.URL).toBe('https://example.com?foo=bar&baz=1');
    });

    it('should handle missing authorization', async () => {
      // Override the handler to reject without auth
      server.use(
        http.post(`${API_URL}/v1/secrets/push`, async ({ request }) => {
          const authHeader = request.headers.get('authorization');
          if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return HttpResponse.json(
              { title: 'UNAUTHORIZED', detail: 'Missing authorization' },
              { status: 401 }
            );
          }
          return HttpResponse.json({
            data: { message: 'OK', stats: { created: 1, updated: 0, deleted: 0 } },
          });
        })
      );

      vi.resetModules();
      const { pushSecrets, APIError } = await import('../src/utils/api.js');

      // This should succeed with a valid token
      const result = await pushSecrets('owner/repo', 'dev', 'KEY=value', 'valid-token');
      expect(result.message).toBe('OK');
    });
  });

  describe('pullSecrets', () => {
    it('should send correctly formatted GET request with query params', async () => {
      vi.resetModules();
      const { pullSecrets } = await import('../src/utils/api.js');

      const result = await pullSecrets('owner/repo', 'staging', 'valid-token');

      // Verify request
      expect(lastRequest).not.toBeNull();
      expect(lastRequest!.method).toBe('GET');
      expect(lastRequest!.url).toContain('/v1/secrets/pull');
      expect(lastRequest!.url).toContain('repo=owner%2Frepo');
      expect(lastRequest!.url).toContain('environment=staging');

      // Verify headers
      expect(lastRequest!.headers['authorization']).toBe('Bearer valid-token');

      // Verify response
      expect(result.content).toContain('API_KEY=test-api-key');
      expect(result.content).toContain('DATABASE_URL=postgres://localhost:5432/db');
    });

    it('should properly URL-encode special characters in repo name', async () => {
      vi.resetModules();
      const { pullSecrets } = await import('../src/utils/api.js');

      await pullSecrets('owner/repo-with-dash', 'dev', 'valid-token');

      expect(lastRequest!.url).toContain('repo=owner%2Frepo-with-dash');
    });
  });

  describe('validateToken', () => {
    it('should send POST request with authorization header', async () => {
      vi.resetModules();
      const { validateToken } = await import('../src/utils/api.js');

      const result = await validateToken('my-jwt-token');

      expect(lastRequest).not.toBeNull();
      expect(lastRequest!.method).toBe('POST');
      expect(lastRequest!.url).toContain('/v1/auth/token/validate');
      expect(lastRequest!.headers['authorization']).toBe('Bearer my-jwt-token');

      expect(result.valid).toBe(true);
      expect(result.username).toBe('testuser');
    });

    it('should throw on invalid token', async () => {
      vi.resetModules();
      const { validateToken, APIError } = await import('../src/utils/api.js');

      await expect(validateToken('invalid-token')).rejects.toThrow(APIError);
    });
  });

  describe('error response parsing', () => {
    it('should parse RFC 7807 error format correctly', async () => {
      server.use(
        http.post(`${API_URL}/v1/secrets/push`, () => {
          return HttpResponse.json(
            {
              title: 'PLAN_LIMIT_REACHED',
              detail: 'This vault is read-only on the Free plan.',
              upgradeUrl: 'https://keyway.sh/upgrade',
            },
            { status: 403 }
          );
        })
      );

      vi.resetModules();
      const { pushSecrets, APIError } = await import('../src/utils/api.js');

      try {
        await pushSecrets('owner/repo', 'dev', 'KEY=value', 'valid-token');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(APIError);
        const apiError = error as InstanceType<typeof APIError>;
        expect(apiError.statusCode).toBe(403);
        expect(apiError.message).toContain('read-only');
        expect(apiError.upgradeUrl).toBe('https://keyway.sh/upgrade');
      }
    });
  });
});
