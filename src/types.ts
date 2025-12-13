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
  serviceId?: string; // For Railway: service ID to sync with
  serviceName?: string; // For Railway: service name (more meaningful than project name)
  framework?: string;
  linkedRepo?: string; // GitHub repo linked to this project (e.g., "owner/repo")
  environments?: string[]; // Available environments in the project (for Railway)
}

/**
 * Project with connection info for multi-account support
 * Used when fetching projects from ALL connections
 */
export interface ProjectWithConnection extends ProviderProject {
  connectionId: string;
  teamId: string | null;
  teamName?: string;
}

/**
 * Response from getAllProviderProjects
 */
export interface AllProviderProjectsResponse {
  projects: ProjectWithConnection[];
  connections: ConnectionInfo[];
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
