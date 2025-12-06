import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import { execSync } from 'child_process';
import { checkEnvGitignore } from '../src/utils/git.js';

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
