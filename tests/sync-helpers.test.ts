import { describe, it, expect } from 'vitest';
import {
  getEnvironmentMapping,
  mappingRequiresConfirmation,
  getProviderEnvironments,
  buildSyncPlan,
} from '../src/utils/sync-helpers.js';

describe('Environment Mapping', () => {
  describe('getEnvironmentMapping', () => {
    it('should map production to production for Vercel', () => {
      expect(getEnvironmentMapping('production', 'vercel')).toBe('production');
    });

    it('should map development to development for Vercel', () => {
      expect(getEnvironmentMapping('development', 'vercel')).toBe('development');
    });

    it('should map staging to preview for Vercel', () => {
      expect(getEnvironmentMapping('staging', 'vercel')).toBe('preview');
    });

    it('should return null for unknown environments', () => {
      expect(getEnvironmentMapping('qa', 'vercel')).toBeNull();
      expect(getEnvironmentMapping('test', 'vercel')).toBeNull();
      expect(getEnvironmentMapping('custom', 'vercel')).toBeNull();
    });

    it('should map production to production for Railway', () => {
      expect(getEnvironmentMapping('production', 'railway')).toBe('production');
    });

    it('should map staging to staging for Railway (not preview)', () => {
      expect(getEnvironmentMapping('staging', 'railway')).toBe('staging');
    });

    it('should pass through for unknown providers', () => {
      expect(getEnvironmentMapping('production', 'unknown')).toBe('production');
      expect(getEnvironmentMapping('custom', 'unknown')).toBe('custom');
    });

    it('should be case-insensitive for provider names', () => {
      expect(getEnvironmentMapping('production', 'Vercel')).toBe('production');
      expect(getEnvironmentMapping('staging', 'VERCEL')).toBe('preview');
    });

    it('should be case-insensitive for environment names', () => {
      expect(getEnvironmentMapping('Production', 'vercel')).toBe('production');
      expect(getEnvironmentMapping('STAGING', 'vercel')).toBe('preview');
    });
  });

  describe('mappingRequiresConfirmation', () => {
    it('should require confirmation for staging to preview', () => {
      expect(mappingRequiresConfirmation('staging', 'preview')).toBe(true);
    });

    it('should not require confirmation for direct mappings', () => {
      expect(mappingRequiresConfirmation('production', 'production')).toBe(false);
      expect(mappingRequiresConfirmation('development', 'development')).toBe(false);
    });

    it('should not require confirmation for other mappings', () => {
      expect(mappingRequiresConfirmation('qa', 'production')).toBe(false);
    });
  });

  describe('getProviderEnvironments', () => {
    it('should return Vercel environments', () => {
      const envs = getProviderEnvironments('vercel');
      expect(envs).toContain('production');
      expect(envs).toContain('preview');
      expect(envs).toContain('development');
      expect(envs).toHaveLength(3);
    });

    it('should return Railway environments', () => {
      const envs = getProviderEnvironments('railway');
      expect(envs).toContain('production');
      expect(envs).toContain('staging');
      expect(envs).toContain('development');
      expect(envs).toHaveLength(3);
    });

    it('should return default environments for unknown providers', () => {
      const envs = getProviderEnvironments('unknown');
      expect(envs).toContain('production');
      expect(envs).toContain('staging');
      expect(envs).toContain('development');
    });
  });
});

describe('buildSyncPlan', () => {
  const baseParams = {
    repoFullName: 'acme/backend',
    projectName: 'my-app',
    provider: 'vercel',
    keywayEnv: 'production',
    providerEnv: 'production',
    vaultSecretCount: 10,
    providerSecretCount: 5,
    changes: {
      toCreate: ['NEW_VAR'],
      toUpdate: ['EXISTING_VAR'],
      toDelete: [],
      toSkip: ['UNCHANGED'],
    },
    isFirstSync: false,
  };

  describe('push direction', () => {
    it('should set vault as source and provider as destination', () => {
      const plan = buildSyncPlan({ ...baseParams, direction: 'push' });

      expect(plan.source.type).toBe('vault');
      expect(plan.source.name).toBe('acme/backend');
      expect(plan.destination.type).toBe('vercel');
      expect(plan.destination.name).toBe('my-app');
    });

    it('should set correct environments', () => {
      const plan = buildSyncPlan({
        ...baseParams,
        direction: 'push',
        keywayEnv: 'staging',
        providerEnv: 'preview',
      });

      expect(plan.source.environment).toBe('staging');
      expect(plan.destination.environment).toBe('preview');
    });

    it('should add overwrite warning when provider has secrets', () => {
      const plan = buildSyncPlan({
        ...baseParams,
        direction: 'push',
        providerSecretCount: 10,
      });

      expect(plan.warnings).toContain(
        'This will overwrite existing Vercel environment variables.'
      );
    });

    it('should not add overwrite warning when provider is empty', () => {
      const plan = buildSyncPlan({
        ...baseParams,
        direction: 'push',
        providerSecretCount: 0,
      });

      expect(plan.warnings.find(w => w.includes('overwrite'))).toBeUndefined();
    });
  });

  describe('pull direction', () => {
    it('should set provider as source and vault as destination', () => {
      const plan = buildSyncPlan({ ...baseParams, direction: 'pull' });

      expect(plan.source.type).toBe('vercel');
      expect(plan.source.name).toBe('my-app');
      expect(plan.destination.type).toBe('vault');
      expect(plan.destination.name).toBe('acme/backend');
    });
  });

  describe('delete warnings', () => {
    it('should add delete warning when items will be deleted', () => {
      const plan = buildSyncPlan({
        ...baseParams,
        direction: 'push',
        changes: {
          ...baseParams.changes,
          toDelete: ['VAR1', 'VAR2', 'VAR3'],
        },
      });

      expect(plan.warnings).toContain('3 variable(s) will be deleted.');
    });

    it('should not add delete warning when no deletions', () => {
      const plan = buildSyncPlan({
        ...baseParams,
        direction: 'push',
        changes: {
          ...baseParams.changes,
          toDelete: [],
        },
      });

      expect(plan.warnings.find(w => w.includes('deleted'))).toBeUndefined();
    });
  });

  describe('changes passthrough', () => {
    it('should preserve changes from input', () => {
      const changes = {
        toCreate: ['A', 'B'],
        toUpdate: ['C'],
        toDelete: ['D'],
        toSkip: ['E', 'F', 'G'],
      };

      const plan = buildSyncPlan({
        ...baseParams,
        direction: 'push',
        changes,
      });

      expect(plan.changes).toEqual(changes);
    });
  });

  describe('first sync flag', () => {
    it('should preserve isFirstSync flag', () => {
      const plan1 = buildSyncPlan({ ...baseParams, direction: 'push', isFirstSync: true });
      const plan2 = buildSyncPlan({ ...baseParams, direction: 'push', isFirstSync: false });

      expect(plan1.isFirstSync).toBe(true);
      expect(plan2.isFirstSync).toBe(false);
    });
  });
});
