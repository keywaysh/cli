import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  findMatchingProject,
  projectMatchesRepo,
  mapToVercelEnvironment,
  mapToRailwayEnvironment,
  displayDiffSummary,
  ProjectWithLinkedRepo,
} from '../src/cmds/sync.js';
import type { SyncDiff } from '../src/types.js';

describe('findMatchingProject', () => {
  const projects: ProjectWithLinkedRepo[] = [
    { id: '1', name: 'soma-app', linkedRepo: 'owner/soma-app' },
    { id: '2', name: 'other-project', linkedRepo: 'owner/other-repo' },
    { id: '3', name: 'my-frontend', linkedRepo: undefined },
    { id: '4', name: 'soma-backend' },
  ];

  describe('linkedRepo matching (priority 1)', () => {
    it('should match by linkedRepo when exact match exists', () => {
      const result = findMatchingProject(projects, 'owner/soma-app');

      expect(result).toBeDefined();
      expect(result!.project.id).toBe('1');
      expect(result!.matchType).toBe('linked_repo');
    });

    it('should match linkedRepo case-insensitively', () => {
      const result = findMatchingProject(projects, 'Owner/Soma-App');

      expect(result).toBeDefined();
      expect(result!.project.id).toBe('1');
      expect(result!.matchType).toBe('linked_repo');
    });

    it('should prefer linkedRepo over exact name match', () => {
      // Project "other-project" has linkedRepo "owner/other-repo"
      // Even if there was a project named "other-repo", linkedRepo should win
      const projectsWithNameConflict: ProjectWithLinkedRepo[] = [
        { id: '1', name: 'wrong-name', linkedRepo: 'owner/target-repo' },
        { id: '2', name: 'target-repo' }, // Same name as repo but no linkedRepo
      ];

      const result = findMatchingProject(projectsWithNameConflict, 'owner/target-repo');

      expect(result).toBeDefined();
      expect(result!.project.id).toBe('1'); // linkedRepo wins
      expect(result!.matchType).toBe('linked_repo');
    });
  });

  describe('exact name matching (priority 2)', () => {
    it('should match by exact name when no linkedRepo match', () => {
      const result = findMatchingProject(projects, 'owner/my-frontend');

      expect(result).toBeDefined();
      expect(result!.project.id).toBe('3');
      expect(result!.matchType).toBe('exact_name');
    });

    it('should match name case-insensitively', () => {
      const result = findMatchingProject(projects, 'owner/MY-FRONTEND');

      expect(result).toBeDefined();
      expect(result!.project.id).toBe('3');
      expect(result!.matchType).toBe('exact_name');
    });
  });

  describe('partial name matching (priority 3)', () => {
    it('should match partial name if only one match exists', () => {
      const projectsWithUnique: ProjectWithLinkedRepo[] = [
        { id: '1', name: 'my-unique-project' },
        { id: '2', name: 'other-thing' },
      ];

      const result = findMatchingProject(projectsWithUnique, 'owner/unique');

      expect(result).toBeDefined();
      expect(result!.project.id).toBe('1');
      expect(result!.matchType).toBe('partial_name');
    });

    it('should not match partial name if multiple matches exist', () => {
      // "soma-app" and "soma-backend" both contain "soma"
      const result = findMatchingProject(projects, 'owner/soma');

      expect(result).toBeUndefined();
    });

    it('should match when repo name contains project name', () => {
      const projectsSimple: ProjectWithLinkedRepo[] = [
        { id: '1', name: 'app' },
      ];

      const result = findMatchingProject(projectsSimple, 'owner/my-app-frontend');

      expect(result).toBeDefined();
      expect(result!.project.id).toBe('1');
      expect(result!.matchType).toBe('partial_name');
    });
  });

  describe('no match cases', () => {
    it('should return undefined when no match found', () => {
      const result = findMatchingProject(projects, 'owner/completely-different');

      expect(result).toBeUndefined();
    });

    it('should return undefined for invalid repo format', () => {
      const result = findMatchingProject(projects, 'invalid-format');

      expect(result).toBeUndefined();
    });

    it('should return undefined for empty projects list', () => {
      const result = findMatchingProject([], 'owner/soma-app');

      expect(result).toBeUndefined();
    });
  });
});

describe('projectMatchesRepo', () => {
  it('should return true for linkedRepo match', () => {
    const project: ProjectWithLinkedRepo = {
      id: '1',
      name: 'different-name',
      linkedRepo: 'owner/my-repo',
    };

    expect(projectMatchesRepo(project, 'owner/my-repo')).toBe(true);
  });

  it('should return true for linkedRepo match case-insensitively', () => {
    const project: ProjectWithLinkedRepo = {
      id: '1',
      name: 'different-name',
      linkedRepo: 'Owner/My-Repo',
    };

    expect(projectMatchesRepo(project, 'owner/my-repo')).toBe(true);
  });

  it('should return true for exact name match', () => {
    const project: ProjectWithLinkedRepo = {
      id: '1',
      name: 'my-repo',
    };

    expect(projectMatchesRepo(project, 'owner/my-repo')).toBe(true);
  });

  it('should return true for exact name match case-insensitively', () => {
    const project: ProjectWithLinkedRepo = {
      id: '1',
      name: 'My-Repo',
    };

    expect(projectMatchesRepo(project, 'owner/my-repo')).toBe(true);
  });

  it('should return false when neither linkedRepo nor name matches', () => {
    const project: ProjectWithLinkedRepo = {
      id: '1',
      name: 'other-project',
      linkedRepo: 'owner/other-repo',
    };

    expect(projectMatchesRepo(project, 'owner/my-repo')).toBe(false);
  });

  it('should return false for partial name match only', () => {
    const project: ProjectWithLinkedRepo = {
      id: '1',
      name: 'my-repo-frontend', // Contains "my-repo" but not exact
    };

    expect(projectMatchesRepo(project, 'owner/my-repo')).toBe(false);
  });

  it('should return false for project without linkedRepo and different name', () => {
    const project: ProjectWithLinkedRepo = {
      id: '1',
      name: 'completely-different',
    };

    expect(projectMatchesRepo(project, 'owner/my-repo')).toBe(false);
  });
});

describe('mapToVercelEnvironment', () => {
  it('should map production to production', () => {
    expect(mapToVercelEnvironment('production')).toBe('production');
  });

  it('should map staging to preview', () => {
    expect(mapToVercelEnvironment('staging')).toBe('preview');
  });

  it('should map dev to development', () => {
    expect(mapToVercelEnvironment('dev')).toBe('development');
  });

  it('should map development to development', () => {
    expect(mapToVercelEnvironment('development')).toBe('development');
  });

  it('should be case-insensitive', () => {
    expect(mapToVercelEnvironment('PRODUCTION')).toBe('production');
    expect(mapToVercelEnvironment('Staging')).toBe('preview');
    expect(mapToVercelEnvironment('DEV')).toBe('development');
  });

  it('should default to production for unknown environments', () => {
    expect(mapToVercelEnvironment('test')).toBe('production');
    expect(mapToVercelEnvironment('qa')).toBe('production');
    expect(mapToVercelEnvironment('custom-env')).toBe('production');
  });
});

describe('mapToRailwayEnvironment', () => {
  it('should map production to production', () => {
    expect(mapToRailwayEnvironment('production')).toBe('production');
  });

  it('should map staging to staging', () => {
    expect(mapToRailwayEnvironment('staging')).toBe('staging');
  });

  it('should map dev to development', () => {
    expect(mapToRailwayEnvironment('dev')).toBe('development');
  });

  it('should map development to development', () => {
    expect(mapToRailwayEnvironment('development')).toBe('development');
  });

  it('should be case-insensitive', () => {
    expect(mapToRailwayEnvironment('PRODUCTION')).toBe('production');
    expect(mapToRailwayEnvironment('Staging')).toBe('staging');
    expect(mapToRailwayEnvironment('DEV')).toBe('development');
  });

  it('should default to production for unknown environments', () => {
    expect(mapToRailwayEnvironment('test')).toBe('production');
    expect(mapToRailwayEnvironment('qa')).toBe('production');
    expect(mapToRailwayEnvironment('custom-env')).toBe('production');
  });

  it('should differ from Vercel mapping for staging', () => {
    // Vercel maps staging -> preview, Railway maps staging -> staging
    expect(mapToVercelEnvironment('staging')).toBe('preview');
    expect(mapToRailwayEnvironment('staging')).toBe('staging');
  });
});

describe('findMatchingProject edge cases', () => {
  it('should handle projects with empty names', () => {
    const projects: ProjectWithLinkedRepo[] = [
      { id: '1', name: '', linkedRepo: 'owner/repo' },
    ];
    const result = findMatchingProject(projects, 'owner/repo');
    expect(result).toBeDefined();
    expect(result!.matchType).toBe('linked_repo');
  });

  it('should handle repo names with special characters', () => {
    const projects: ProjectWithLinkedRepo[] = [
      { id: '1', name: 'my-app_v2.0', linkedRepo: 'owner/my-app_v2.0' },
    ];
    const result = findMatchingProject(projects, 'owner/my-app_v2.0');
    expect(result).toBeDefined();
    expect(result!.matchType).toBe('linked_repo');
  });

  it('should handle very long repo names', () => {
    const longName = 'a'.repeat(100);
    const projects: ProjectWithLinkedRepo[] = [
      { id: '1', name: longName, linkedRepo: `owner/${longName}` },
    ];
    const result = findMatchingProject(projects, `owner/${longName}`);
    expect(result).toBeDefined();
    expect(result!.matchType).toBe('linked_repo');
  });

  it('should handle projects with null-ish linkedRepo', () => {
    const projects: ProjectWithLinkedRepo[] = [
      { id: '1', name: 'my-repo', linkedRepo: undefined },
      { id: '2', name: 'other', linkedRepo: '' },
    ];
    const result = findMatchingProject(projects, 'owner/my-repo');
    expect(result).toBeDefined();
    expect(result!.project.id).toBe('1');
    expect(result!.matchType).toBe('exact_name');
  });

  it('should handle multiple linkedRepo matches (first wins)', () => {
    const projects: ProjectWithLinkedRepo[] = [
      { id: '1', name: 'first', linkedRepo: 'owner/my-repo' },
      { id: '2', name: 'second', linkedRepo: 'owner/my-repo' },
    ];
    const result = findMatchingProject(projects, 'owner/my-repo');
    expect(result).toBeDefined();
    expect(result!.project.id).toBe('1');
  });

  it('should handle org/repo format variations', () => {
    const projects: ProjectWithLinkedRepo[] = [
      { id: '1', name: 'repo', linkedRepo: 'Organization-Name/Repo-Name' },
    ];
    // Case insensitive match
    const result = findMatchingProject(projects, 'organization-name/repo-name');
    expect(result).toBeDefined();
    expect(result!.matchType).toBe('linked_repo');
  });

  it('should match partial name when unique (expected behavior)', () => {
    const projects: ProjectWithLinkedRepo[] = [
      { id: '1', name: 'app', linkedRepo: 'owner/my-app' },
    ];
    // "app" is contained in "my-app-frontend", so partial match is found
    // This is expected behavior - partial matches work when unique
    const result = findMatchingProject(projects, 'owner/my-app-frontend');
    expect(result).toBeDefined();
    expect(result!.matchType).toBe('partial_name');
  });
});

describe('projectMatchesRepo edge cases', () => {
  it('should handle empty repo name', () => {
    const project: ProjectWithLinkedRepo = { id: '1', name: 'test' };
    expect(projectMatchesRepo(project, 'owner/')).toBe(false);
  });

  it('should match name even with missing owner (split gives empty string)', () => {
    const project: ProjectWithLinkedRepo = { id: '1', name: 'test' };
    // '/test'.split('/')[1] = 'test', which matches project.name
    expect(projectMatchesRepo(project, '/test')).toBe(true);
  });

  it('should handle linkedRepo with different format', () => {
    const project: ProjectWithLinkedRepo = {
      id: '1',
      name: 'test',
      linkedRepo: 'github.com/owner/repo', // Wrong format
    };
    expect(projectMatchesRepo(project, 'owner/repo')).toBe(false);
  });
});

describe('displayDiffSummary', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('should display "Already in sync" when no differences', () => {
    const diff: SyncDiff = {
      keywayCount: 5,
      providerCount: 5,
      onlyInKeyway: [],
      onlyInProvider: [],
      different: [],
      same: ['VAR1', 'VAR2', 'VAR3', 'VAR4', 'VAR5'],
    };

    displayDiffSummary(diff, 'Vercel');

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Already in sync'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('5 secrets'));
  });

  it('should display secrets only in Keyway', () => {
    const diff: SyncDiff = {
      keywayCount: 3,
      providerCount: 0,
      onlyInKeyway: ['DATABASE_URL', 'API_KEY', 'JWT_SECRET'],
      onlyInProvider: [],
      different: [],
      same: [],
    };

    displayDiffSummary(diff, 'Railway');

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Comparison Summary'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('3 only in Keyway'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('DATABASE_URL'));
  });

  it('should display secrets only in provider', () => {
    const diff: SyncDiff = {
      keywayCount: 0,
      providerCount: 2,
      onlyInKeyway: [],
      onlyInProvider: ['VERCEL_ENV', 'VERCEL_URL'],
      different: [],
      same: [],
    };

    displayDiffSummary(diff, 'Vercel');

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('2 only in Vercel'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('VERCEL_ENV'));
  });

  it('should display secrets with different values', () => {
    const diff: SyncDiff = {
      keywayCount: 2,
      providerCount: 2,
      onlyInKeyway: [],
      onlyInProvider: [],
      different: ['API_KEY', 'DATABASE_URL'],
      same: [],
    };

    displayDiffSummary(diff, 'Railway');

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('2 with different values'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('API_KEY'));
  });

  it('should display identical secrets count', () => {
    const diff: SyncDiff = {
      keywayCount: 5,
      providerCount: 5,
      onlyInKeyway: ['NEW_VAR'],
      onlyInProvider: [],
      different: [],
      same: ['VAR1', 'VAR2', 'VAR3', 'VAR4'],
    };

    displayDiffSummary(diff, 'Vercel');

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('4 identical'));
  });

  it('should display all categories when all have values', () => {
    const diff: SyncDiff = {
      keywayCount: 10,
      providerCount: 8,
      onlyInKeyway: ['KEYWAY_ONLY_1', 'KEYWAY_ONLY_2'],
      onlyInProvider: ['PROVIDER_ONLY'],
      different: ['CONFLICT_VAR'],
      same: ['SAME_1', 'SAME_2', 'SAME_3', 'SAME_4', 'SAME_5'],
    };

    displayDiffSummary(diff, 'Railway');

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Keyway: 10 secrets'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Railway: 8 secrets'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('2 only in Keyway'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('1 only in Railway'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('1 with different values'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('5 identical'));
  });

  it('should truncate long lists to 3 items with "and X more"', () => {
    const diff: SyncDiff = {
      keywayCount: 10,
      providerCount: 0,
      onlyInKeyway: ['VAR1', 'VAR2', 'VAR3', 'VAR4', 'VAR5', 'VAR6'],
      onlyInProvider: [],
      different: [],
      same: [],
    };

    displayDiffSummary(diff, 'Vercel');

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('6 only in Keyway'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('VAR1'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('VAR2'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('VAR3'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('and 3 more'));
  });

  it('should handle empty diff with no secrets on either side', () => {
    const diff: SyncDiff = {
      keywayCount: 0,
      providerCount: 0,
      onlyInKeyway: [],
      onlyInProvider: [],
      different: [],
      same: [],
    };

    displayDiffSummary(diff, 'Railway');

    // Should show comparison summary with 0 secrets
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Keyway: 0 secrets'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Railway: 0 secrets'));
  });

  it('should handle provider names with special characters', () => {
    const diff: SyncDiff = {
      keywayCount: 1,
      providerCount: 1,
      onlyInKeyway: [],
      onlyInProvider: ['SPECIAL_VAR'],
      different: [],
      same: [],
    };

    displayDiffSummary(diff, 'Provider-Name_123');

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Provider-Name_123: 1 secrets'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('1 only in Provider-Name_123'));
  });

  it('should display correct arrow symbols for direction hints', () => {
    const diff: SyncDiff = {
      keywayCount: 2,
      providerCount: 1,
      onlyInKeyway: ['KEYWAY_VAR'],
      onlyInProvider: ['PROVIDER_VAR'],
      different: [],
      same: [],
    };

    displayDiffSummary(diff, 'Vercel');

    // Check that the output contains the right directional symbols
    const calls = consoleSpy.mock.calls.map(call => call[0]);
    const hasRightArrow = calls.some(call => typeof call === 'string' && call.includes('→'));
    const hasLeftArrow = calls.some(call => typeof call === 'string' && call.includes('←'));

    expect(hasRightArrow).toBe(true); // → for onlyInKeyway
    expect(hasLeftArrow).toBe(true);  // ← for onlyInProvider
  });
});

describe('SyncDiff edge cases', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('should handle very long secret names', () => {
    const longName = 'A'.repeat(100);
    const diff: SyncDiff = {
      keywayCount: 1,
      providerCount: 0,
      onlyInKeyway: [longName],
      onlyInProvider: [],
      different: [],
      same: [],
    };

    displayDiffSummary(diff, 'Vercel');

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining(longName));
  });

  it('should handle secret names with special characters', () => {
    const diff: SyncDiff = {
      keywayCount: 3,
      providerCount: 0,
      onlyInKeyway: ['MY_VAR_123', 'SPECIAL-VAR', 'var.with.dots'],
      onlyInProvider: [],
      different: [],
      same: [],
    };

    displayDiffSummary(diff, 'Railway');

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('MY_VAR_123'));
  });

  it('should handle large number of secrets', () => {
    const manySecrets = Array.from({ length: 1000 }, (_, i) => `VAR_${i}`);
    const diff: SyncDiff = {
      keywayCount: 1000,
      providerCount: 500,
      onlyInKeyway: manySecrets.slice(0, 500),
      onlyInProvider: [],
      different: [],
      same: manySecrets.slice(500),
    };

    displayDiffSummary(diff, 'Vercel');

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('500 only in Keyway'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('and 497 more'));
  });

  it('should handle counts mismatch with arrays (defensive)', () => {
    // Test that the display still works even if counts don't match array lengths
    const diff: SyncDiff = {
      keywayCount: 100, // Doesn't match actual array
      providerCount: 50,
      onlyInKeyway: ['VAR1'],
      onlyInProvider: ['VAR2'],
      different: [],
      same: [],
    };

    // Should not throw
    expect(() => displayDiffSummary(diff, 'Railway')).not.toThrow();
  });

  it('should handle unicode in secret names', () => {
    const diff: SyncDiff = {
      keywayCount: 1,
      providerCount: 0,
      onlyInKeyway: ['VAR_日本語'],
      onlyInProvider: [],
      different: [],
      same: [],
    };

    expect(() => displayDiffSummary(diff, 'Vercel')).not.toThrow();
  });

  it('should display nothing for identical category when count is 0', () => {
    const diff: SyncDiff = {
      keywayCount: 2,
      providerCount: 0,
      onlyInKeyway: ['VAR1', 'VAR2'],
      onlyInProvider: [],
      different: [],
      same: [], // Empty
    };

    displayDiffSummary(diff, 'Vercel');

    const calls = consoleSpy.mock.calls.map(call => call[0]);
    const hasIdentical = calls.some(call => typeof call === 'string' && call.includes('identical'));

    expect(hasIdentical).toBe(false); // Should not show "0 identical"
  });
});
