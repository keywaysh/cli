import type {
  InitVaultRequest,
  InitVaultResponse,
  PushSecretsRequest,
  PushSecretsResponse,
  PullSecretsResponse,
  DeviceStartResponse,
  DevicePollResponse,
  ValidateTokenResponse,
  ProviderInfo,
  ConnectionInfo,
  ProviderProject,
  SyncStatusInfo,
  SyncDiff,
  SyncPreview,
  SyncResult,
} from '../types.js';
import { INTERNAL_API_URL } from '../config/internal.js';
import pkg from '../../package.json' with { type: 'json' };

const API_BASE_URL = process.env.KEYWAY_API_URL || INTERNAL_API_URL;
const USER_AGENT = `keyway-cli/${pkg.version}`;
const DEFAULT_TIMEOUT_MS = 30000; // 30 seconds

/**
 * Truncate a string with ellipsis indicator
 */
export function truncateMessage(message: string, maxLength = 200): string {
  if (message.length <= maxLength) return message;
  return message.slice(0, maxLength - 3) + '...';
}

/**
 * Network error codes and their user-friendly messages
 */
const NETWORK_ERROR_MESSAGES: Record<string, string> = {
  ECONNREFUSED: 'Cannot connect to Keyway API server. Is the server running?',
  ECONNRESET: 'Connection was reset. Please try again.',
  ENOTFOUND: 'DNS lookup failed. Check your internet connection.',
  ETIMEDOUT: 'Connection timed out. Check your network connection.',
  ENETUNREACH: 'Network is unreachable. Check your internet connection.',
  EHOSTUNREACH: 'Host is unreachable. Check your network connection.',
  CERT_HAS_EXPIRED: 'SSL certificate has expired. Contact support.',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'SSL certificate verification failed.',
  EPROTO: 'SSL/TLS protocol error. Try again later.',
};

/**
 * Convert network errors to user-friendly messages
 */
function handleNetworkError(error: Error & { code?: string; cause?: { code?: string } }): Error {
  // Check error code directly or in cause (Node.js fetch wraps errors)
  const errorCode = error.code || (error.cause as { code?: string })?.code;

  if (errorCode && NETWORK_ERROR_MESSAGES[errorCode]) {
    return new Error(NETWORK_ERROR_MESSAGES[errorCode]);
  }

  // Check for common error message patterns
  const message = error.message.toLowerCase();
  if (message.includes('fetch failed') || message.includes('network')) {
    return new Error('Network error. Check your internet connection and try again.');
  }

  return error;
}

/**
 * Fetch with timeout and network error handling
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error) {
      // Handle timeout
      if (error.name === 'AbortError') {
        throw new Error(`Request timeout after ${timeoutMs / 1000}s. Check your network connection.`);
      }
      // Handle network errors
      throw handleNetworkError(error as Error & { code?: string; cause?: { code?: string } });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

// Security: Enforce HTTPS for production API
function validateApiUrl(url: string): void {
  const parsed = new URL(url);

  // Only allow HTTPS in production
  if (parsed.protocol !== 'https:') {
    // Allow HTTP only for localhost/development
    const isLocalhost = parsed.hostname === 'localhost' ||
                       parsed.hostname === '127.0.0.1' ||
                       parsed.hostname === '0.0.0.0';

    if (!isLocalhost) {
      throw new Error(
        `Insecure API URL detected: ${url}\n` +
        `HTTPS is required for security. If this is a development server, ` +
        `use localhost or configure HTTPS.`
      );
    }

    // Warn about HTTP usage even for localhost
    if (!process.env.KEYWAY_DISABLE_SECURITY_WARNINGS) {
      console.warn(
        `⚠️  WARNING: Using insecure HTTP connection to ${url}\n` +
        `This should only be used for local development.\n` +
        `Set KEYWAY_DISABLE_SECURITY_WARNINGS=1 to suppress this warning.`
      );
    }
  }
}

// Validate API URL on module load
validateApiUrl(API_BASE_URL);

export class APIError extends Error {
  constructor(
    public statusCode: number,
    public error: string,
    message: string,
    public upgradeUrl?: string
  ) {
    super(message);
    this.name = 'APIError';
  }
}

async function handleResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get('content-type') || '';
  const text = await response.text();

  if (!response.ok) {
    if (contentType.includes('application/json')) {
      try {
        const error = JSON.parse(text);
        // RFC 7807 format: {type, title, status, detail}
        throw new APIError(response.status, error.title || 'Error', error.detail || `HTTP ${response.status}`, error.upgradeUrl);
      } catch (e) {
        if (e instanceof APIError) throw e;
        throw new APIError(response.status, 'Error', text || `HTTP ${response.status}`);
      }
    }
    throw new APIError(response.status, 'Error', text || `HTTP ${response.status}`);
  }

  if (!text) {
    return {} as T;
  }

  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(text) as T;
    } catch {
      // Fall through to treat as text
    }
  }

  // For endpoints that return plain text (e.g., env content)
  return { content: text } as unknown as T;
}

export async function initVault(
  repoFullName: string,
  accessToken: string
): Promise<InitVaultResponse> {
  const body: InitVaultRequest = { repoFullName };
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': USER_AGENT,
  };
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const response = await fetchWithTimeout(`${API_BASE_URL}/v1/vaults`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  const result = await handleResponse<{ data: InitVaultResponse }>(response);
  return result.data;
}

/**
 * Parse .env content into key-value pairs
 */
function parseEnvContent(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;

    const key = trimmed.substring(0, eqIndex).trim();
    let value = trimmed.substring(eqIndex + 1);

    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (key) result[key] = value;
  }

  return result;
}

export async function pushSecrets(
  repoFullName: string,
  environment: string,
  content: string,
  accessToken: string
): Promise<PushSecretsResponse> {
  const secrets = parseEnvContent(content);
  const body = { repoFullName, environment, secrets };
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': USER_AGENT,
  };
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const response = await fetchWithTimeout(`${API_BASE_URL}/v1/secrets/push`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  const result = await handleResponse<{ data: PushSecretsResponse }>(response);
  return result.data;
}

export async function pullSecrets(
  repoFullName: string,
  environment: string,
  accessToken: string
): Promise<PullSecretsResponse> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': USER_AGENT,
  };
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const params = new URLSearchParams({
    repo: repoFullName,
    environment,
  });

  const response = await fetchWithTimeout(`${API_BASE_URL}/v1/secrets/pull?${params}`, {
    method: 'GET',
    headers,
  });

  const result = await handleResponse<{ data: { content: string } }>(response);
  return { content: result.data.content };
}

export async function startDeviceLogin(repository?: string | null): Promise<DeviceStartResponse> {
  const response = await fetchWithTimeout(`${API_BASE_URL}/v1/auth/device/start`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
    },
    body: JSON.stringify(repository ? { repository } : {}),
  });

  return handleResponse<DeviceStartResponse>(response);
}

export async function pollDeviceLogin(deviceCode: string): Promise<DevicePollResponse> {
  const response = await fetchWithTimeout(`${API_BASE_URL}/v1/auth/device/poll`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
    },
    body: JSON.stringify({ deviceCode }),
  });

  return handleResponse<DevicePollResponse>(response);
}

export async function validateToken(token: string): Promise<ValidateTokenResponse> {
  const response = await fetchWithTimeout(`${API_BASE_URL}/v1/auth/token/validate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({}),
  });

  // Response uses wrapper format: { data: ValidateTokenResponse, meta: { requestId } }
  const wrapped = await handleResponse<{ data: ValidateTokenResponse }>(response);
  return wrapped.data;
}

// ==================== Provider Integrations ====================

/**
 * Get list of available providers
 */
export async function getProviders(): Promise<{ providers: ProviderInfo[] }> {
  const response = await fetchWithTimeout(`${API_BASE_URL}/v1/integrations`, {
    method: 'GET',
    headers: {
      'User-Agent': USER_AGENT,
    },
  });

  // Response uses wrapper format: { data: { providers }, meta: { requestId } }
  const wrapped = await handleResponse<{ data: { providers: ProviderInfo[] } }>(response);
  return wrapped.data;
}

/**
 * Get user's provider connections
 */
export async function getConnections(accessToken: string): Promise<{ connections: ConnectionInfo[] }> {
  const response = await fetchWithTimeout(`${API_BASE_URL}/v1/integrations/connections`, {
    method: 'GET',
    headers: {
      'User-Agent': USER_AGENT,
      Authorization: `Bearer ${accessToken}`,
    },
  });

  // Response uses wrapper format: { data: { connections }, meta: { requestId } }
  const wrapped = await handleResponse<{ data: { connections: ConnectionInfo[] } }>(response);
  return wrapped.data;
}

/**
 * Delete a provider connection
 * Returns 204 No Content on success
 */
export async function deleteConnection(accessToken: string, connectionId: string): Promise<void> {
  const response = await fetchWithTimeout(`${API_BASE_URL}/v1/integrations/connections/${connectionId}`, {
    method: 'DELETE',
    headers: {
      'User-Agent': USER_AGENT,
      Authorization: `Bearer ${accessToken}`,
    },
  });

  // DELETE returns 204 No Content - handleResponse returns {} for empty responses
  await handleResponse<Record<string, never>>(response);
}

/**
 * Get OAuth authorization URL for a provider
 */
export function getProviderAuthUrl(provider: string, redirectUri?: string): string {
  const params = redirectUri ? `?redirect_uri=${encodeURIComponent(redirectUri)}` : '';
  return `${API_BASE_URL}/v1/integrations/${provider}/authorize${params}`;
}

/**
 * Get projects for a connection
 */
export async function getConnectionProjects(
  accessToken: string,
  connectionId: string
): Promise<{ projects: ProviderProject[] }> {
  const response = await fetchWithTimeout(`${API_BASE_URL}/v1/integrations/connections/${connectionId}/projects`, {
    method: 'GET',
    headers: {
      'User-Agent': USER_AGENT,
      Authorization: `Bearer ${accessToken}`,
    },
  });

  // Response uses wrapper format: { data: { projects }, meta: { requestId } }
  const wrapped = await handleResponse<{ data: { projects: ProviderProject[] } }>(response);
  return wrapped.data;
}

/**
 * Get sync status (for first-time detection)
 */
export async function getSyncStatus(
  accessToken: string,
  repoFullName: string,
  connectionId: string,
  projectId: string,
  environment: string = 'production'
): Promise<SyncStatusInfo> {
  const [owner, repo] = repoFullName.split('/');
  const params = new URLSearchParams({
    connectionId,
    projectId,
    environment,
  });

  const response = await fetchWithTimeout(
    `${API_BASE_URL}/v1/integrations/vaults/${owner}/${repo}/sync/status?${params}`,
    {
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  // Response uses wrapper format: { data: SyncStatusInfo, meta: { requestId } }
  const wrapped = await handleResponse<{ data: SyncStatusInfo }>(response);
  return wrapped.data;
}

/**
 * Get bi-directional sync diff (compare Keyway vs Provider)
 */
export async function getSyncDiff(
  accessToken: string,
  repoFullName: string,
  options: {
    connectionId: string;
    projectId: string;
    serviceId?: string; // Railway: service ID for service-specific variables
    keywayEnvironment?: string;
    providerEnvironment?: string;
  }
): Promise<SyncDiff> {
  const [owner, repo] = repoFullName.split('/');
  const params = new URLSearchParams({
    connectionId: options.connectionId,
    projectId: options.projectId,
    keywayEnvironment: options.keywayEnvironment || 'production',
    providerEnvironment: options.providerEnvironment || 'production',
  });
  if (options.serviceId) {
    params.set('serviceId', options.serviceId);
  }

  // Use longer timeout as it fetches secrets from both sides
  const response = await fetchWithTimeout(
    `${API_BASE_URL}/v1/integrations/vaults/${owner}/${repo}/sync/diff?${params}`,
    {
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        Authorization: `Bearer ${accessToken}`,
      },
    },
    60000 // 60 seconds
  );

  const wrapped = await handleResponse<{ data: SyncDiff }>(response);
  return wrapped.data;
}

/**
 * Get sync preview (what would change)
 */
export async function getSyncPreview(
  accessToken: string,
  repoFullName: string,
  options: {
    connectionId: string;
    projectId: string;
    serviceId?: string; // Railway: service ID for service-specific variables
    keywayEnvironment?: string;
    providerEnvironment?: string;
    direction?: 'push' | 'pull';
    allowDelete?: boolean;
  }
): Promise<SyncPreview> {
  const [owner, repo] = repoFullName.split('/');
  const params = new URLSearchParams({
    connectionId: options.connectionId,
    projectId: options.projectId,
    keywayEnvironment: options.keywayEnvironment || 'production',
    providerEnvironment: options.providerEnvironment || 'production',
    direction: options.direction || 'push',
    allowDelete: String(options.allowDelete || false),
  });
  if (options.serviceId) {
    params.set('serviceId', options.serviceId);
  }

  // Use longer timeout for sync preview as it may involve many secrets
  const response = await fetchWithTimeout(
    `${API_BASE_URL}/v1/integrations/vaults/${owner}/${repo}/sync/preview?${params}`,
    {
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        Authorization: `Bearer ${accessToken}`,
      },
    },
    60000 // 60 seconds for sync operations
  );

  // Response uses wrapper format: { data: SyncPreview, meta: { requestId } }
  const wrapped = await handleResponse<{ data: SyncPreview }>(response);
  return wrapped.data;
}

/**
 * Execute a sync operation
 */
export async function executeSync(
  accessToken: string,
  repoFullName: string,
  options: {
    connectionId: string;
    projectId: string;
    serviceId?: string; // Railway: service ID for service-specific variables
    keywayEnvironment?: string;
    providerEnvironment?: string;
    direction?: 'push' | 'pull';
    allowDelete?: boolean;
  }
): Promise<SyncResult> {
  const [owner, repo] = repoFullName.split('/');

  // Use longer timeout for sync execution as it may involve many API calls
  const response = await fetchWithTimeout(
    `${API_BASE_URL}/v1/integrations/vaults/${owner}/${repo}/sync`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        connectionId: options.connectionId,
        projectId: options.projectId,
        serviceId: options.serviceId,
        keywayEnvironment: options.keywayEnvironment || 'production',
        providerEnvironment: options.providerEnvironment || 'production',
        direction: options.direction || 'push',
        allowDelete: options.allowDelete || false,
      }),
    },
    120000 // 2 minutes for sync execution
  );

  // Response uses wrapper format: { data: SyncResult, meta: { requestId } }
  const wrapped = await handleResponse<{ data: SyncResult }>(response);
  return wrapped.data;
}

/**
 * Connect to a provider using a direct API token (e.g., Railway)
 */
export async function connectWithToken(
  accessToken: string,
  provider: string,
  providerToken: string
): Promise<{ success: boolean; provider: string; user: { id: string; username: string; teamName?: string } }> {
  const response = await fetchWithTimeout(`${API_BASE_URL}/v1/integrations/${provider}/connect`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ token: providerToken }),
  });

  const wrapped = await handleResponse<{ data: { success: boolean; provider: string; user: { id: string; username: string; teamName?: string } } }>(response);
  return wrapped.data;
}

/**
 * Check if a vault exists for a repository
 */
export async function checkVaultExists(
  accessToken: string,
  repoFullName: string
): Promise<boolean> {
  const [owner, repo] = repoFullName.split('/');

  try {
    const response = await fetchWithTimeout(
      `${API_BASE_URL}/v1/vaults/${owner}/${repo}`,
      {
        method: 'GET',
        headers: {
          'User-Agent': USER_AGENT,
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Get vault environments for a repository
 */
export async function getVaultEnvironments(
  accessToken: string,
  repoFullName: string
): Promise<string[]> {
  const [owner, repo] = repoFullName.split('/');

  try {
    const response = await fetchWithTimeout(
      `${API_BASE_URL}/v1/vaults/${owner}/${repo}`,
      {
        method: 'GET',
        headers: {
          'User-Agent': USER_AGENT,
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    const wrapped = await handleResponse<{ data: { environments?: string[] } }>(response);
    return wrapped.data.environments || ['production'];
  } catch {
    return ['production'];
  }
}

// ==================== GitHub App Installation ====================

export interface GitHubAppInstallationStatus {
  installed: boolean;
  installationId?: number;
  installUrl: string;
  message?: string;
}

/**
 * Check if GitHub App is installed for a repository
 */
export async function checkGitHubAppInstallation(
  repoOwner: string,
  repoName: string,
  accessToken: string
): Promise<GitHubAppInstallationStatus> {
  const response = await fetchWithTimeout(`${API_BASE_URL}/v1/github/check-installation`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ repoOwner, repoName }),
  });

  const wrapped = await handleResponse<{ data: GitHubAppInstallationStatus }>(response);
  return wrapped.data;
}
