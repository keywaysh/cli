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
  stats?: {
    created: number;
    updated: number;
    deleted: number;
  };
}

export interface PullSecretsResponse {
  content: string;
}

// Auth / login flows
export interface DeviceStartResponse {
  deviceCode: string;
  userCode: string;
  verificationUriComplete: string;
  verificationUri?: string;
  expiresIn?: number;
  interval?: number;
  githubAppInstallUrl?: string;
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

// Provider integrations
export interface ProviderInfo {
  name: string;
  displayName: string;
  configured: boolean;
}

export interface ConnectionInfo {
  id: string;
  provider: string;
  providerUserId: string | null;
  providerTeamId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderProject {
  id: string;
  name: string;
  framework?: string;
  linkedRepo?: string; // GitHub repo linked to this project (e.g., "owner/repo")
}

export interface SyncStatusInfo {
  isFirstSync: boolean;
  vaultIsEmpty: boolean;
  providerHasSecrets: boolean;
  providerSecretCount: number;
}

export interface SyncPreview {
  toCreate: string[];
  toUpdate: string[];
  toDelete: string[];
  toSkip: string[];
}

export interface SyncDiff {
  keywayCount: number;
  providerCount: number;
  onlyInKeyway: string[];
  onlyInProvider: string[];
  different: string[];
  same: string[];
}

export interface SyncResult {
  success: boolean;
  stats: {
    created: number;
    updated: number;
    deleted: number;
    total: number;
  };
  error?: string;
}
