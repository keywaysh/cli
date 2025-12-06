import { describe, it, expect } from 'vitest';
import {
  findMatchingProject,
  projectMatchesRepo,
  mapToVercelEnvironment,
  ProjectWithLinkedRepo,
} from '../src/cmds/sync.js';

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
