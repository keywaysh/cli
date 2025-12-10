import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import { execSync } from 'child_process';
import { checkEnvGitignore, addEnvToGitignore } from '../src/utils/git.js';

vi.mock('child_process');
vi.mock('fs');

describe('checkEnvGitignore', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return true when .env is in gitignore', () => {
    vi.mocked(execSync).mockReturnValue('/some/repo\n');
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('node_modules\n.env\ndist\n');

    expect(checkEnvGitignore()).toBe(true);
  });

  it('should return true when .env* pattern is in gitignore', () => {
    vi.mocked(execSync).mockReturnValue('/some/repo\n');
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('node_modules\n.env*\ndist\n');

    expect(checkEnvGitignore()).toBe(true);
  });

  it('should return true when .env.* pattern is in gitignore', () => {
    vi.mocked(execSync).mockReturnValue('/some/repo\n');
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('.env.*\n');

    expect(checkEnvGitignore()).toBe(true);
  });

  it('should return true when *.env pattern is in gitignore', () => {
    vi.mocked(execSync).mockReturnValue('/some/repo\n');
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('*.env\n');

    expect(checkEnvGitignore()).toBe(true);
  });

  it('should return false when .env patterns are missing from gitignore', () => {
    vi.mocked(execSync).mockReturnValue('/some/repo\n');
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('node_modules\ndist\n');

    expect(checkEnvGitignore()).toBe(false);
  });

  it('should return false when gitignore does not exist', () => {
    vi.mocked(execSync).mockReturnValue('/some/repo\n');
    vi.mocked(fs.existsSync).mockReturnValue(false);

    expect(checkEnvGitignore()).toBe(false);
  });

  it('should return true when not in a git repository', () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error('Not a git repository');
    });

    // Returns true to avoid warning outside git repos
    expect(checkEnvGitignore()).toBe(true);
  });

  it('should handle gitignore with comments and empty lines', () => {
    vi.mocked(execSync).mockReturnValue('/some/repo\n');
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      '# Dependencies\nnode_modules\n\n# Environment\n.env\n\n# Build\ndist\n'
    );

    expect(checkEnvGitignore()).toBe(true);
  });

  it('should handle gitignore with leading/trailing whitespace', () => {
    vi.mocked(execSync).mockReturnValue('/some/repo\n');
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('  .env  \n');

    expect(checkEnvGitignore()).toBe(true);
  });
});

describe('addEnvToGitignore', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should add .env* to existing gitignore file', () => {
    vi.mocked(execSync).mockReturnValue('/some/repo\n');
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('node_modules\ndist\n');
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});

    const result = addEnvToGitignore();

    expect(result).toBe(true);
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      '/some/repo/.gitignore',
      'node_modules\ndist\n.env*\n'
    );
  });

  it('should add .env* with newline when file does not end with newline', () => {
    vi.mocked(execSync).mockReturnValue('/some/repo\n');
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('node_modules\ndist');
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});

    const result = addEnvToGitignore();

    expect(result).toBe(true);
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      '/some/repo/.gitignore',
      'node_modules\ndist\n.env*\n'
    );
  });

  it('should create gitignore file if it does not exist', () => {
    vi.mocked(execSync).mockReturnValue('/some/repo\n');
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});

    const result = addEnvToGitignore();

    expect(result).toBe(true);
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      '/some/repo/.gitignore',
      '.env*\n'
    );
  });

  it('should return false when not in a git repository', () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error('Not a git repository');
    });

    const result = addEnvToGitignore();

    expect(result).toBe(false);
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('should return false when writeFileSync fails', () => {
    vi.mocked(execSync).mockReturnValue('/some/repo\n');
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('node_modules\n');
    vi.mocked(fs.writeFileSync).mockImplementation(() => {
      throw new Error('Permission denied');
    });

    const result = addEnvToGitignore();

    expect(result).toBe(false);
  });
});
