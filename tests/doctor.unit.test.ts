import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as doctor from '../src/core/doctor';
import { execSync } from 'child_process';
import * as fs from 'fs';
import { fetch } from 'undici';

// Mock modules
vi.mock('child_process');
vi.mock('fs');
vi.mock('undici');

describe('Doctor checks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('checkNode', () => {
    it('should pass for Node 18+', async () => {
      const originalVersion = process.versions.node;
      Object.defineProperty(process.versions, 'node', {
        value: '18.12.0',
        configurable: true
      });

      const result = await doctor.checkNode();
      
      expect(result.status).toBe('pass');
      expect(result.id).toBe('node');
      expect(result.detail).toContain('18.12.0');

      Object.defineProperty(process.versions, 'node', {
        value: originalVersion,
        configurable: true
      });
    });

    it('should fail for Node < 18', async () => {
      const originalVersion = process.versions.node;
      Object.defineProperty(process.versions, 'node', {
        value: '16.14.0',
        configurable: true
      });

      const result = await doctor.checkNode();
      
      expect(result.status).toBe('fail');
      expect(result.detail).toContain('16.14.0');
      expect(result.detail).toContain('please upgrade');

      Object.defineProperty(process.versions, 'node', {
        value: originalVersion,
        configurable: true
      });
    });
  });

  describe('checkGit', () => {
    it('should pass when git is installed and in a repository', async () => {
      vi.mocked(execSync).mockImplementation((command: string) => {
        if (command === 'git --version') {
          return 'git version 2.39.0';
        }
        if (command === 'git rev-parse --is-inside-work-tree') {
          return 'true';
        }
        return '';
      });

      const result = await doctor.checkGit();
      
      expect(result.status).toBe('pass');
      expect(result.detail).toContain('git version 2.39.0');
      expect(result.detail).toContain('inside repository');
    });

    it('should warn when git is installed but not in a repository', async () => {
      vi.mocked(execSync).mockImplementation((command: string) => {
        if (command === 'git --version') {
          return 'git version 2.39.0';
        }
        if (command === 'git rev-parse --is-inside-work-tree') {
          throw new Error('Not in a git repository');
        }
        return '';
      });

      const result = await doctor.checkGit();
      
      expect(result.status).toBe('warn');
      expect(result.detail).toContain('not in a repository');
    });

    it('should warn when git is not installed', async () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('git: command not found');
      });

      const result = await doctor.checkGit();
      
      expect(result.status).toBe('warn');
      expect(result.detail).toBe('Git not installed');
    });
  });

  describe('checkNetwork', () => {
    it('should pass when API is reachable', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers()
      } as any);

      const result = await doctor.checkNetwork();
      
      expect(result.status).toBe('pass');
      expect(result.detail).toContain('Connected to api.keyway.sh');
    });

    it('should warn on timeout', async () => {
      vi.mocked(fetch).mockRejectedValue({ name: 'AbortError' });

      const result = await doctor.checkNetwork();
      
      expect(result.status).toBe('warn');
      expect(result.detail).toContain('timeout');
    });

    it('should fail on DNS error', async () => {
      vi.mocked(fetch).mockRejectedValue({ code: 'ENOTFOUND' });

      const result = await doctor.checkNetwork();
      
      expect(result.status).toBe('fail');
      expect(result.detail).toContain('DNS resolution failed');
    });

    it('should fail on SSL certificate error', async () => {
      vi.mocked(fetch).mockRejectedValue({ code: 'CERT_HAS_EXPIRED' });

      const result = await doctor.checkNetwork();
      
      expect(result.status).toBe('fail');
      expect(result.detail).toContain('SSL certificate error');
    });
  });

  describe('checkFileSystem', () => {
    it('should pass when write permissions are available', async () => {
      vi.mocked(fs.writeFileSync).mockImplementation(() => {});
      vi.mocked(fs.unlinkSync).mockImplementation(() => {});

      const result = await doctor.checkFileSystem();
      
      expect(result.status).toBe('pass');
      expect(result.detail).toBe('Write permissions verified');
    });

    it('should fail when write permissions are denied', async () => {
      vi.mocked(fs.writeFileSync).mockImplementation(() => {
        throw new Error('Permission denied');
      });

      const result = await doctor.checkFileSystem();
      
      expect(result.status).toBe('fail');
      expect(result.detail).toContain('Permission denied');
    });
  });

  describe('checkGitignore', () => {
    it('should pass when .env patterns are present', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('node_modules\n.env\n*.env.local');

      const result = await doctor.checkGitignore();
      
      expect(result.status).toBe('pass');
      expect(result.detail).toBe('Environment files are ignored');
    });

    it('should warn when .gitignore is missing', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const result = await doctor.checkGitignore();
      
      expect(result.status).toBe('warn');
      expect(result.detail).toBe('No .gitignore file found');
    });

    it('should warn when .env patterns are missing', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('node_modules\ndist/');

      const result = await doctor.checkGitignore();
      
      expect(result.status).toBe('warn');
      expect(result.detail).toBe('Missing .env patterns in .gitignore');
    });
  });

  describe('checkSystemClock', () => {
    it('should pass when clock is synchronized', async () => {
      const serverDate = new Date().toUTCString();
      vi.mocked(fetch).mockResolvedValue({
        headers: {
          get: () => serverDate
        }
      } as any);

      const result = await doctor.checkSystemClock();
      
      expect(result.status).toBe('pass');
      expect(result.detail).toContain('Synchronized');
    });

    it('should warn when clock drift is > 5 minutes', async () => {
      const driftedDate = new Date(Date.now() - 10 * 60 * 1000).toUTCString();
      vi.mocked(fetch).mockResolvedValue({
        headers: {
          get: () => driftedDate
        }
      } as any);

      const result = await doctor.checkSystemClock();
      
      expect(result.status).toBe('warn');
      expect(result.detail).toContain('Clock drift');
    });

    it('should pass when unable to verify', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('Network error'));

      const result = await doctor.checkSystemClock();
      
      expect(result.status).toBe('pass');
      expect(result.detail).toBe('Unable to verify');
    });
  });

  describe('runAllChecks', () => {
    it('should aggregate all check results', async () => {
      // Mock all individual checks to return predictable results
      vi.spyOn(doctor, 'checkNode').mockResolvedValue({
        id: 'node',
        name: 'Node.js version',
        status: 'pass',
        detail: 'v18.0.0'
      });
      
      vi.spyOn(doctor, 'checkGit').mockResolvedValue({
        id: 'git',
        name: 'Git repository',
        status: 'warn',
        detail: 'Not in repository'
      });

      vi.spyOn(doctor, 'checkNetwork').mockResolvedValue({
        id: 'network',
        name: 'API connectivity',
        status: 'pass',
        detail: 'Connected'
      });

      vi.spyOn(doctor, 'checkFileSystem').mockResolvedValue({
        id: 'filesystem',
        name: 'File system permissions',
        status: 'pass',
        detail: 'OK'
      });

      vi.spyOn(doctor, 'checkGitignore').mockResolvedValue({
        id: 'gitignore',
        name: '.gitignore configuration',
        status: 'pass',
        detail: 'OK'
      });

      vi.spyOn(doctor, 'checkSystemClock').mockResolvedValue({
        id: 'clock',
        name: 'System clock',
        status: 'pass',
        detail: 'Synchronized'
      });

      const results = await doctor.runAllChecks();
      
      expect(results.checks).toHaveLength(6);
      expect(results.summary.pass).toBe(5);
      expect(results.summary.warn).toBe(1);
      expect(results.summary.fail).toBe(0);
      expect(results.exitCode).toBe(0);
    });

    it('should convert warnings to failures in strict mode', async () => {
      vi.spyOn(doctor, 'checkNode').mockResolvedValue({
        id: 'node',
        name: 'Node.js version',
        status: 'pass',
        detail: 'v18.0.0'
      });
      
      vi.spyOn(doctor, 'checkGit').mockResolvedValue({
        id: 'git',
        name: 'Git repository',
        status: 'warn',
        detail: 'Not in repository'
      });

      vi.spyOn(doctor, 'checkNetwork').mockResolvedValue({
        id: 'network',
        name: 'API connectivity',
        status: 'warn',
        detail: 'Timeout'
      });

      vi.spyOn(doctor, 'checkFileSystem').mockResolvedValue({
        id: 'filesystem',
        name: 'File system permissions',
        status: 'pass',
        detail: 'OK'
      });

      vi.spyOn(doctor, 'checkGitignore').mockResolvedValue({
        id: 'gitignore',
        name: '.gitignore configuration',
        status: 'pass',
        detail: 'OK'
      });

      vi.spyOn(doctor, 'checkSystemClock').mockResolvedValue({
        id: 'clock',
        name: 'System clock',
        status: 'pass',
        detail: 'Synchronized'
      });

      const results = await doctor.runAllChecks({ strict: true });
      
      expect(results.summary.pass).toBe(4);
      expect(results.summary.warn).toBe(0);
      expect(results.summary.fail).toBe(2);
      expect(results.exitCode).toBe(1);
    });
  });
});