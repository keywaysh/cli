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

const API_BASE_URL = process.env.KEYWAY_API_URL || INTERNAL_API_URL;

export class APIError extends Error {
  constructor(
    public statusCode: number,
    public error: string,
    message: string
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
        throw new APIError(response.status, error.error, error.message);
      } catch {
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
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const response = await fetch(`${API_BASE_URL}/vaults/init`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  return handleResponse<InitVaultResponse>(response);
}

export async function pushSecrets(
  repoFullName: string,
  environment: string,
  content: string,
  accessToken: string
): Promise<PushSecretsResponse> {
  const body: PushSecretsRequest = { content };
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }
  const encodedRepo = encodeURIComponent(repoFullName);

  const response = await fetch(
    `${API_BASE_URL}/vaults/${encodedRepo}/${environment}/push`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }
  );

  return handleResponse<PushSecretsResponse>(response);
}

export async function pullSecrets(
  repoFullName: string,
  environment: string,
  accessToken: string
): Promise<PullSecretsResponse> {
  const encodedRepo = encodeURIComponent(repoFullName);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const response = await fetch(
    `${API_BASE_URL}/vaults/${encodedRepo}/${environment}/pull`,
    {
      method: 'GET',
      headers,
    }
  );

  return handleResponse<PullSecretsResponse>(response);
}

export async function startDeviceLogin(repository?: string | null): Promise<DeviceStartResponse> {
  const response = await fetch(`${API_BASE_URL}/auth/device/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(repository ? { repository } : {}),
  });

  return handleResponse<DeviceStartResponse>(response);
}

export async function pollDeviceLogin(deviceCode: string): Promise<DevicePollResponse> {
  const response = await fetch(`${API_BASE_URL}/auth/device/poll`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceCode }),
  });

  return handleResponse<DevicePollResponse>(response);
}

export async function validateToken(token: string): Promise<ValidateTokenResponse> {
  const response = await fetch(`${API_BASE_URL}/auth/token/validate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({}),
  });

  return handleResponse<ValidateTokenResponse>(response);
}
