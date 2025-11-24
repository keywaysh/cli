/**
 * Shared types between CLI and API
 * These are duplicated from the API to keep the CLI standalone
 */

// API Request/Response types
export interface InitVaultRequest {
  repoFullName: string;
}

export interface InitVaultResponse {
  vaultId: string;
  repoFullName: string;
  message: string;
}

export interface PushSecretsRequest {
  content: string;
}

export interface PushSecretsResponse {
  success: boolean;
  message: string;
}

export interface PullSecretsResponse {
  content: string;
}

export interface ErrorResponse {
  error: string;
  message: string;
  statusCode?: number;
}

// Auth / login flows
export interface DeviceStartResponse {
  deviceCode: string;
  userCode: string;
  verificationUriComplete: string;
  verificationUri?: string;
  expiresIn?: number;
  interval?: number;
}

export interface DevicePollResponse {
  status: 'pending' | 'approved' | 'expired' | 'denied';
  keywayToken?: string;
  githubLogin?: string;
  expiresAt?: string;
  message?: string;
}

export interface ValidateTokenResponse {
  username: string;
  githubId?: string;
}
