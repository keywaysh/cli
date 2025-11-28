import type {
  InitVaultRequest,
  InitVaultResponse,
  PushSecretsRequest,
  PushSecretsResponse,
  PullSecretsResponse,
  ErrorResponse,
  DeviceStartResponse,
  DevicePollResponse,
  ValidateTokenResponse,
} from '../types.js';
import { INTERNAL_API_URL } from '../config/internal.js';
import pkg from '../../package.json' with { type: 'json' };

const API_BASE_URL = process.env.KEYWAY_API_URL || INTERNAL_API_URL;
const USER_AGENT = `keyway-cli/${pkg.version}`;

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
        const error = JSON.parse(text) as ErrorResponse;
        throw new APIError(response.status, error.error, error.message, error.upgrade_url);
      } catch (e) {
        if (e instanceof APIError) throw e;
        throw new APIError(response.status, 'http_error', text || `HTTP ${response.status}`);
      }
    }
    throw new APIError(response.status, 'http_error', text || `HTTP ${response.status}`);
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

  const response = await fetch(`${API_BASE_URL}/v1/vaults`, {
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

  const response = await fetch(`${API_BASE_URL}/v1/secrets/push`, {
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

  const response = await fetch(`${API_BASE_URL}/v1/secrets/pull?${params}`, {
    method: 'GET',
    headers,
  });

  const result = await handleResponse<{ data: { content: string } }>(response);
  return { content: result.data.content };
}

export async function startDeviceLogin(repository?: string | null): Promise<DeviceStartResponse> {
  const response = await fetch(`${API_BASE_URL}/v1/auth/device/start`, {
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
  const response = await fetch(`${API_BASE_URL}/v1/auth/device/poll`, {
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
  const response = await fetch(`${API_BASE_URL}/v1/auth/token/validate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({}),
  });

  return handleResponse<ValidateTokenResponse>(response);
}
