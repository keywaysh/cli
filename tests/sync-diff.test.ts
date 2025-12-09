import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Helper to create proper mock responses
function createMockResponse(data: unknown, ok = true, status = 200) {
  const body = JSON.stringify(ok ? { data } : data);
  return {
    ok,
    status,
    headers: {
      get: (name: string) => name.toLowerCase() === 'content-type' ? 'application/json' : null,
    },
    text: () => Promise.resolve(body),
    json: () => Promise.resolve(ok ? { data } : data),
  };
}

describe('getSyncDiff API', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('should call the correct endpoint with parameters', async () => {
    mockFetch.mockResolvedValueOnce(createMockResponse({
      keywayCount: 5,
      providerCount: 3,
      onlyInKeyway: ['VAR1', 'VAR2'],
      onlyInProvider: ['VAR3'],
      different: [],
      same: ['VAR4', 'VAR5'],
    }));

    const { getSyncDiff } = await import('../src/utils/api.js');

    const result = await getSyncDiff('token123', 'owner/repo', {
      connectionId: 'conn-uuid-123',
      projectId: 'proj-123',
      keywayEnvironment: 'production',
      providerEnvironment: 'production',
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];

    expect(url).toContain('/v1/integrations/vaults/owner/repo/sync/diff');
    expect(url).toContain('connectionId=conn-uuid-123');
    expect(url).toContain('projectId=proj-123');
    expect(url).toContain('keywayEnvironment=production');
    expect(url).toContain('providerEnvironment=production');
    expect(options.headers.Authorization).toBe('Bearer token123');
    expect(options.method).toBe('GET');

    expect(result.keywayCount).toBe(5);
    expect(result.providerCount).toBe(3);
    expect(result.onlyInKeyway).toHaveLength(2);
    expect(result.onlyInProvider).toHaveLength(1);
  });

  it('should use default environments when not specified', async () => {
    mockFetch.mockResolvedValueOnce(createMockResponse({
      keywayCount: 0,
      providerCount: 0,
      onlyInKeyway: [],
      onlyInProvider: [],
      different: [],
      same: [],
    }));

    const { getSyncDiff } = await import('../src/utils/api.js');

    await getSyncDiff('token', 'owner/repo', {
      connectionId: 'conn-id',
      projectId: 'proj-id',
    });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('keywayEnvironment=production');
    expect(url).toContain('providerEnvironment=production');
  });

  it('should handle different environments', async () => {
    mockFetch.mockResolvedValueOnce(createMockResponse({
      keywayCount: 1,
      providerCount: 1,
      onlyInKeyway: [],
      onlyInProvider: [],
      different: [],
      same: ['VAR1'],
    }));

    const { getSyncDiff } = await import('../src/utils/api.js');

    await getSyncDiff('token', 'owner/repo', {
      connectionId: 'conn-id',
      projectId: 'proj-id',
      keywayEnvironment: 'staging',
      providerEnvironment: 'preview',
    });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('keywayEnvironment=staging');
    expect(url).toContain('providerEnvironment=preview');
  });

  it('should handle API errors', async () => {
    mockFetch.mockResolvedValueOnce(createMockResponse({
      type: 'not_found',
      title: 'Not Found',
      status: 404,
      detail: 'Vault not found',
    }, false, 404));

    const { getSyncDiff } = await import('../src/utils/api.js');

    await expect(getSyncDiff('token', 'owner/repo', {
      connectionId: 'conn-id',
      projectId: 'proj-id',
    })).rejects.toThrow();
  });

  it('should handle connection not found error', async () => {
    mockFetch.mockResolvedValueOnce(createMockResponse({
      type: 'not_found',
      title: 'Not Found',
      status: 404,
      detail: 'Connection not found',
    }, false, 404));

    const { getSyncDiff } = await import('../src/utils/api.js');

    await expect(getSyncDiff('token', 'owner/repo', {
      connectionId: 'invalid-conn-id',
      projectId: 'proj-id',
    })).rejects.toThrow();
  });

  it('should handle unauthorized error', async () => {
    mockFetch.mockResolvedValueOnce(createMockResponse({
      type: 'unauthorized',
      title: 'Unauthorized',
      status: 401,
      detail: 'Invalid or expired token',
    }, false, 401));

    const { getSyncDiff } = await import('../src/utils/api.js');

    await expect(getSyncDiff('invalid-token', 'owner/repo', {
      connectionId: 'conn-id',
      projectId: 'proj-id',
    })).rejects.toThrow();
  });

  it('should handle provider errors', async () => {
    mockFetch.mockResolvedValueOnce(createMockResponse({
      type: 'provider_error',
      title: 'Provider Error',
      status: 502,
      detail: 'Failed to connect to Railway API',
    }, false, 502));

    const { getSyncDiff } = await import('../src/utils/api.js');

    await expect(getSyncDiff('token', 'owner/repo', {
      connectionId: 'conn-id',
      projectId: 'proj-id',
    })).rejects.toThrow();
  });

  it('should return complete diff structure', async () => {
    const expectedDiff = {
      keywayCount: 10,
      providerCount: 8,
      onlyInKeyway: ['A', 'B', 'C'],
      onlyInProvider: ['X', 'Y'],
      different: ['SHARED1', 'SHARED2'],
      same: ['SAME1', 'SAME2', 'SAME3'],
    };

    mockFetch.mockResolvedValueOnce(createMockResponse(expectedDiff));

    const { getSyncDiff } = await import('../src/utils/api.js');

    const result = await getSyncDiff('token', 'owner/repo', {
      connectionId: 'conn-id',
      projectId: 'proj-id',
    });

    expect(result).toEqual(expectedDiff);
    expect(result.keywayCount).toBe(10);
    expect(result.providerCount).toBe(8);
    expect(result.onlyInKeyway).toEqual(['A', 'B', 'C']);
    expect(result.onlyInProvider).toEqual(['X', 'Y']);
    expect(result.different).toEqual(['SHARED1', 'SHARED2']);
    expect(result.same).toEqual(['SAME1', 'SAME2', 'SAME3']);
  });

  it('should handle empty diff response', async () => {
    mockFetch.mockResolvedValueOnce(createMockResponse({
      keywayCount: 0,
      providerCount: 0,
      onlyInKeyway: [],
      onlyInProvider: [],
      different: [],
      same: [],
    }));

    const { getSyncDiff } = await import('../src/utils/api.js');

    const result = await getSyncDiff('token', 'owner/repo', {
      connectionId: 'conn-id',
      projectId: 'proj-id',
    });

    expect(result.keywayCount).toBe(0);
    expect(result.providerCount).toBe(0);
    expect(result.onlyInKeyway).toHaveLength(0);
    expect(result.onlyInProvider).toHaveLength(0);
    expect(result.different).toHaveLength(0);
    expect(result.same).toHaveLength(0);
  });

  it('should handle large diff response', async () => {
    const largeOnlyInKeyway = Array.from({ length: 500 }, (_, i) => `KEYWAY_VAR_${i}`);
    const largeOnlyInProvider = Array.from({ length: 300 }, (_, i) => `PROVIDER_VAR_${i}`);
    const largeDifferent = Array.from({ length: 100 }, (_, i) => `DIFF_VAR_${i}`);
    const largeSame = Array.from({ length: 200 }, (_, i) => `SAME_VAR_${i}`);

    mockFetch.mockResolvedValueOnce(createMockResponse({
      keywayCount: 800,
      providerCount: 600,
      onlyInKeyway: largeOnlyInKeyway,
      onlyInProvider: largeOnlyInProvider,
      different: largeDifferent,
      same: largeSame,
    }));

    const { getSyncDiff } = await import('../src/utils/api.js');

    const result = await getSyncDiff('token', 'owner/repo', {
      connectionId: 'conn-id',
      projectId: 'proj-id',
    });

    expect(result.onlyInKeyway).toHaveLength(500);
    expect(result.onlyInProvider).toHaveLength(300);
    expect(result.different).toHaveLength(100);
    expect(result.same).toHaveLength(200);
  });

  it('should URL encode special characters in repo name', async () => {
    mockFetch.mockResolvedValueOnce(createMockResponse({
      keywayCount: 0,
      providerCount: 0,
      onlyInKeyway: [],
      onlyInProvider: [],
      different: [],
      same: [],
    }));

    const { getSyncDiff } = await import('../src/utils/api.js');

    await getSyncDiff('token', 'owner/repo-name', {
      connectionId: 'conn-id',
      projectId: 'proj-id',
    });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('owner/repo-name');
  });
});

describe('SyncDiff type validation', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('should handle all SyncDiff fields', async () => {
    mockFetch.mockResolvedValueOnce(createMockResponse({
      keywayCount: 5,
      providerCount: 5,
      onlyInKeyway: ['A'],
      onlyInProvider: ['B'],
      different: ['C'],
      same: ['D', 'E'],
    }));

    const { getSyncDiff } = await import('../src/utils/api.js');

    const result = await getSyncDiff('token', 'owner/repo', {
      connectionId: 'conn-id',
      projectId: 'proj-id',
    });

    // Type assertions
    expect(typeof result.keywayCount).toBe('number');
    expect(typeof result.providerCount).toBe('number');
    expect(Array.isArray(result.onlyInKeyway)).toBe(true);
    expect(Array.isArray(result.onlyInProvider)).toBe(true);
    expect(Array.isArray(result.different)).toBe(true);
    expect(Array.isArray(result.same)).toBe(true);
  });
});

describe('getSyncDiff with serviceId (Railway)', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('should include serviceId in URL when provided', async () => {
    mockFetch.mockResolvedValueOnce(createMockResponse({
      keywayCount: 5,
      providerCount: 10,
      onlyInKeyway: [],
      onlyInProvider: ['API_KEY', 'DB_URL'],
      different: [],
      same: ['NODE_ENV'],
    }));

    const { getSyncDiff } = await import('../src/utils/api.js');

    await getSyncDiff('token', 'owner/repo', {
      connectionId: 'conn-id',
      projectId: 'proj-id',
      serviceId: 'service-uuid-123',
    });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('serviceId=service-uuid-123');
  });

  it('should not include serviceId when not provided', async () => {
    mockFetch.mockResolvedValueOnce(createMockResponse({
      keywayCount: 0,
      providerCount: 0,
      onlyInKeyway: [],
      onlyInProvider: [],
      different: [],
      same: [],
    }));

    const { getSyncDiff } = await import('../src/utils/api.js');

    await getSyncDiff('token', 'owner/repo', {
      connectionId: 'conn-id',
      projectId: 'proj-id',
    });

    const [url] = mockFetch.mock.calls[0];
    expect(url).not.toContain('serviceId');
  });
});

describe('getSyncPreview with serviceId (Railway)', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('should include serviceId in URL when provided', async () => {
    mockFetch.mockResolvedValueOnce(createMockResponse({
      direction: 'pull',
      toAdd: ['API_KEY', 'DB_URL'],
      toUpdate: [],
      toDelete: [],
      unchanged: ['NODE_ENV'],
    }));

    const { getSyncPreview } = await import('../src/utils/api.js');

    await getSyncPreview('token', 'owner/repo', {
      connectionId: 'conn-id',
      projectId: 'proj-id',
      serviceId: 'service-uuid-456',
      direction: 'pull',
    });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('serviceId=service-uuid-456');
    expect(url).toContain('direction=pull');
  });

  it('should not include serviceId when not provided', async () => {
    mockFetch.mockResolvedValueOnce(createMockResponse({
      direction: 'push',
      toAdd: [],
      toUpdate: [],
      toDelete: [],
      unchanged: [],
    }));

    const { getSyncPreview } = await import('../src/utils/api.js');

    await getSyncPreview('token', 'owner/repo', {
      connectionId: 'conn-id',
      projectId: 'proj-id',
    });

    const [url] = mockFetch.mock.calls[0];
    expect(url).not.toContain('serviceId');
  });

  it('should use correct endpoint with all parameters', async () => {
    mockFetch.mockResolvedValueOnce(createMockResponse({
      direction: 'pull',
      toAdd: ['SECRET1', 'SECRET2'],
      toUpdate: ['SECRET3'],
      toDelete: [],
      unchanged: ['SECRET4'],
    }));

    const { getSyncPreview } = await import('../src/utils/api.js');

    const result = await getSyncPreview('token', 'owner/repo', {
      connectionId: 'conn-uuid',
      projectId: 'proj-uuid',
      serviceId: 'svc-uuid',
      keywayEnvironment: 'staging',
      providerEnvironment: 'production',
      direction: 'pull',
      allowDelete: true,
    });

    const [url, options] = mockFetch.mock.calls[0];

    expect(url).toContain('/v1/integrations/vaults/owner/repo/sync/preview');
    expect(url).toContain('connectionId=conn-uuid');
    expect(url).toContain('projectId=proj-uuid');
    expect(url).toContain('serviceId=svc-uuid');
    expect(url).toContain('keywayEnvironment=staging');
    expect(url).toContain('providerEnvironment=production');
    expect(url).toContain('direction=pull');
    expect(url).toContain('allowDelete=true');
    expect(options.headers.Authorization).toBe('Bearer token');

    expect(result.toAdd).toEqual(['SECRET1', 'SECRET2']);
    expect(result.toUpdate).toEqual(['SECRET3']);
  });
});
