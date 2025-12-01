/**
 * Sync Helpers
 * Centralized utilities for sync operations with clear UX messaging
 */

import pc from 'picocolors';
import prompts from 'prompts';

// =============================================================================
// Types
// =============================================================================

export type ProviderType = 'vault' | 'vercel' | 'railway';
export type SyncDirection = 'push' | 'pull';

export interface SyncEndpoint {
  type: ProviderType;
  name: string;        // "acme/backend" or "my-app"
  environment: string; // "production"
  secretCount: number;
}

export interface SyncPlan {
  direction: SyncDirection;
  source: SyncEndpoint;
  destination: SyncEndpoint;
  changes: {
    toCreate: string[];
    toUpdate: string[];
    toDelete: string[];
    toSkip: string[];
  };
  isFirstSync: boolean;
  warnings: string[];
}

export interface SyncResult {
  success: boolean;
  created: number;
  updated: number;
  deleted: number;
}

// =============================================================================
// Environment Mapping
// =============================================================================

const VERCEL_ENVIRONMENTS = ['production', 'preview', 'development'] as const;
const RAILWAY_ENVIRONMENTS = ['production', 'staging', 'development'] as const;

type VercelEnvironment = typeof VERCEL_ENVIRONMENTS[number];
type RailwayEnvironment = typeof RAILWAY_ENVIRONMENTS[number];

// Default mappings from Keyway env to provider env
const ENV_MAPPINGS: Record<string, Record<string, string>> = {
  vercel: {
    production: 'production',
    staging: 'preview',      // Non-obvious mapping
    development: 'development',
  },
  railway: {
    production: 'production',
    staging: 'staging',
    development: 'development',
  },
};

// Mappings that require confirmation (non-obvious)
const MAPPINGS_REQUIRING_CONFIRMATION = new Set(['staging:preview']);

/**
 * Map Keyway environment to provider environment
 * Returns null if mapping is unknown and needs user selection
 */
export function getEnvironmentMapping(
  keywayEnv: string,
  provider: string
): string | null {
  const providerMappings = ENV_MAPPINGS[provider.toLowerCase()];
  if (!providerMappings) return keywayEnv; // Unknown provider, pass through

  return providerMappings[keywayEnv.toLowerCase()] ?? null;
}

/**
 * Check if this mapping requires user confirmation
 */
export function mappingRequiresConfirmation(keywayEnv: string, providerEnv: string): boolean {
  return MAPPINGS_REQUIRING_CONFIRMATION.has(`${keywayEnv}:${providerEnv}`);
}

/**
 * Get available environments for a provider
 */
export function getProviderEnvironments(provider: string): string[] {
  switch (provider.toLowerCase()) {
    case 'vercel':
      return [...VERCEL_ENVIRONMENTS];
    case 'railway':
      return [...RAILWAY_ENVIRONMENTS];
    default:
      return ['production', 'staging', 'development'];
  }
}

/**
 * Prompt user to select provider environment when no default mapping exists
 */
export async function promptEnvironmentMapping(
  keywayEnv: string,
  provider: string
): Promise<string | null> {
  const environments = getProviderEnvironments(provider);
  const providerName = capitalize(provider);

  console.log('');
  console.log(pc.yellow(`⚠️  No default mapping for "${keywayEnv}" on ${providerName}.`));
  console.log('');

  const { selected } = await prompts({
    type: 'select',
    name: 'selected',
    message: `Select ${providerName} environment:`,
    choices: environments.map((env, i) => ({
      title: env,
      value: env,
    })),
  });

  return selected ?? null;
}

/**
 * Confirm non-obvious environment mapping
 */
export async function confirmEnvironmentMapping(
  keywayEnv: string,
  providerEnv: string,
  provider: string
): Promise<boolean> {
  const providerName = capitalize(provider);

  console.log('');
  console.log(pc.blue(`ℹ️  Mapping: ${keywayEnv} → ${providerEnv} (${providerName})`));

  const { confirmed } = await prompts({
    type: 'confirm',
    name: 'confirmed',
    message: 'Continue?',
    initial: true,
  });

  return confirmed ?? false;
}

/**
 * Resolve environment mapping with user interaction if needed
 */
export async function resolveEnvironmentMapping(
  keywayEnv: string,
  provider: string,
  skipConfirm: boolean = false
): Promise<string | null> {
  const mapped = getEnvironmentMapping(keywayEnv, provider);

  // No mapping found - need user selection
  if (mapped === null) {
    return promptEnvironmentMapping(keywayEnv, provider);
  }

  // Mapping found but requires confirmation
  if (!skipConfirm && mappingRequiresConfirmation(keywayEnv, mapped)) {
    const confirmed = await confirmEnvironmentMapping(keywayEnv, mapped, provider);
    if (!confirmed) return null;
  }

  return mapped;
}

// =============================================================================
// Sync Plan Building
// =============================================================================

export interface BuildSyncPlanParams {
  repoFullName: string;
  projectName: string;
  provider: string;
  direction: SyncDirection;
  keywayEnv: string;
  providerEnv: string;
  vaultSecretCount: number;
  providerSecretCount: number;
  changes: {
    toCreate: string[];
    toUpdate: string[];
    toDelete: string[];
    toSkip: string[];
  };
  isFirstSync: boolean;
}

/**
 * Build a sync plan from API data
 */
export function buildSyncPlan(params: BuildSyncPlanParams): SyncPlan {
  const {
    repoFullName,
    projectName,
    provider,
    direction,
    keywayEnv,
    providerEnv,
    vaultSecretCount,
    providerSecretCount,
    changes,
    isFirstSync,
  } = params;

  const providerType = provider.toLowerCase() as ProviderType;
  const warnings: string[] = [];

  // Build source and destination based on direction
  const vault: SyncEndpoint = {
    type: 'vault',
    name: repoFullName,
    environment: keywayEnv,
    secretCount: vaultSecretCount,
  };

  const providerEndpoint: SyncEndpoint = {
    type: providerType,
    name: projectName,
    environment: providerEnv,
    secretCount: providerSecretCount,
  };

  const source = direction === 'push' ? vault : providerEndpoint;
  const destination = direction === 'push' ? providerEndpoint : vault;

  // Generate warnings
  if (direction === 'push' && providerSecretCount > 0) {
    warnings.push(`This will overwrite existing ${capitalize(provider)} environment variables.`);
  }

  if (changes.toDelete.length > 0) {
    warnings.push(`${changes.toDelete.length} variable(s) will be deleted.`);
  }

  return {
    direction,
    source,
    destination,
    changes,
    isFirstSync,
    warnings,
  };
}

// =============================================================================
// Sync Plan Display
// =============================================================================

/**
 * Print sync plan with clear source → destination format
 */
export function printSyncPlan(plan: SyncPlan): void {
  const { direction, source, destination, changes, warnings } = plan;
  const providerName = capitalize(source.type === 'vault' ? destination.type : source.type);

  console.log('');

  // Header based on direction
  if (direction === 'push') {
    console.log(pc.cyan(`🔄 Preparing ${providerName} sync…`));
  } else {
    console.log(pc.cyan(`📥 Importing from ${providerName} → Vault`));
  }

  console.log('');

  // Source and destination
  if (direction === 'pull') {
    // Pull: show counts first
    console.log(pc.white(`🔍 Found ${source.secretCount} variables in ${capitalize(source.type)} (${source.environment})`));
    console.log(pc.white(`🔐 Vault currently has ${destination.secretCount} variables.`));
    console.log('');
    console.log(pc.gray('Plan:'));
    console.log(pc.white(`   ${capitalize(source.type)} (${source.type === 'vault' ? source.name : `project=${source.name}`}, env=${source.environment})`));
    console.log(pc.white(`   → ${capitalize(destination.type)} (${destination.type === 'vault' ? destination.name : `project=${destination.name}`}, env=${destination.environment})`));
  } else {
    // Push: show From/To format
    console.log(pc.white(`📦 From: ${capitalize(source.type)} (${source.name}, env=${source.environment})`));
    console.log(pc.white(`📤 To:   ${capitalize(destination.type)} (project=${destination.name}, env=${destination.environment})`));
  }

  // Changes summary (if any)
  const totalChanges = changes.toCreate.length + changes.toUpdate.length + changes.toDelete.length;

  if (totalChanges > 0) {
    console.log('');

    if (changes.toCreate.length > 0) {
      console.log(pc.green(`   + ${changes.toCreate.length} to create`));
    }
    if (changes.toUpdate.length > 0) {
      console.log(pc.yellow(`   ~ ${changes.toUpdate.length} to update`));
    }
    if (changes.toDelete.length > 0) {
      console.log(pc.red(`   - ${changes.toDelete.length} to delete`));
    }
    if (changes.toSkip.length > 0) {
      console.log(pc.gray(`   ○ ${changes.toSkip.length} unchanged`));
    }
  }

  // Warnings
  if (warnings.length > 0) {
    console.log('');
    for (const warning of warnings) {
      console.log(pc.yellow(warning));
    }
  }

  console.log('');
}

// =============================================================================
// Confirmation
// =============================================================================

/**
 * Confirm sync execution
 */
export async function confirmSync(
  plan: SyncPlan,
  skipConfirm: boolean
): Promise<boolean> {
  if (skipConfirm) return true;

  const { confirmed } = await prompts({
    type: 'confirm',
    name: 'confirmed',
    message: 'Continue?',
    initial: true,
  });

  return confirmed ?? false;
}

// =============================================================================
// First-time Sync Detection
// =============================================================================

export interface FirstSyncChoice {
  direction: SyncDirection;
  cancelled: boolean;
}

/**
 * Handle first-time sync when vault is empty but provider has secrets
 */
export async function handleFirstSync(
  providerSecretCount: number,
  provider: string
): Promise<FirstSyncChoice> {
  const providerName = capitalize(provider);

  console.log('');
  console.log(pc.yellow(`⚠️  Vault is empty. ${providerName} has ${providerSecretCount} variables.`));
  console.log('');
  console.log(pc.white('Do you want to:'));
  console.log(pc.green('1) Import ' + providerName + ' → Vault   (recommended first-time)'));
  console.log(pc.yellow('2) Push Vault → ' + providerName + '     (will delete ' + providerName + ' vars)'));
  console.log('');

  const { choice } = await prompts({
    type: 'select',
    name: 'choice',
    message: 'Select an option:',
    choices: [
      { title: `Import ${providerName} → Vault (recommended)`, value: 'pull' },
      { title: `Push Vault → ${providerName}`, value: 'push' },
    ],
    initial: 0,
  });

  if (!choice) {
    return { direction: 'push', cancelled: true };
  }

  return { direction: choice as SyncDirection, cancelled: false };
}

// =============================================================================
// Result Display
// =============================================================================

/**
 * Print sync result
 */
export function printSyncResult(result: SyncResult): void {
  console.log('');

  if (result.success) {
    console.log(pc.green('✅ Sync complete!'));
    console.log(pc.gray(`   Created: ${result.created}`));
    console.log(pc.gray(`   Updated: ${result.updated}`));
    if (result.deleted > 0) {
      console.log(pc.gray(`   Deleted: ${result.deleted}`));
    }
  } else {
    console.log(pc.red('❌ Sync failed'));
  }

  console.log('');
}

/**
 * Print "already in sync" message
 */
export function printAlreadyInSync(): void {
  console.log('');
  console.log(pc.green('✅ Already in sync. No changes needed.'));
  console.log('');
}

// =============================================================================
// Utilities
// =============================================================================

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
