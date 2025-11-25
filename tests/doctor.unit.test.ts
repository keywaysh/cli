import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as doctor from '../src/core/doctor';
import { execSync } from 'child_process';
import * as fs from 'fs';

// Mock modules
vi.mock('child_process');
vi.mock('fs');

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

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
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers()
      } as any);

      const result = await doctor.checkNetwork();

      expect(result.status).toBe('pass');
      expect(result.detail).toContain('api.keyway.sh');
    });

    it('should warn on timeout', async () => {
      mockFetch.mockRejectedValue({ name: 'AbortError' });

      const result = await doctor.checkNetwork();

      expect(result.status).toBe('warn');
      expect(result.detail).toContain('timeout');
    });

    it('should fail on DNS error', async () => {
      mockFetch.mockRejectedValue({ code: 'ENOTFOUND' });

      const result = await doctor.checkNetwork();

      expect(result.status).toBe('fail');
      expect(result.detail).toContain('DNS resolution failed');
    });

    it('should fail on SSL certificate error', async () => {
      mockFetch.mockRejectedValue({ code: 'CERT_HAS_EXPIRED' });

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
      mockFetch.mockResolvedValue({
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
      mockFetch.mockResolvedValue({
        headers: {
          get: () => driftedDate
        }
      } as any);

      const result = await doctor.checkSystemClock();

      expect(result.status).toBe('warn');
      expect(result.detail).toContain('Clock drift');
    });

    it('should pass when unable to verify', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const result = await doctor.checkSystemClock();

      expect(result.status).toBe('pass');
      expect(result.detail).toBe('Unable to verify');
    });
  });

  describe('runAllChecks', () => {
    it('should return 6 checks', async () => {
      // Set up mocks for network calls
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'date': new Date().toUTCString() })
      } as any);

      const results = await doctor.runAllChecks();

      expect(results.checks).toHaveLength(6);
      expect(results.summary.pass + results.summary.warn + results.summary.fail).toBe(6);
    });

    it('should return exitCode 0 when no failures', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'date': new Date().toUTCString() })
      } as any);

      const results = await doctor.runAllChecks();

      // exitCode is 0 only if there are no failures
      if (results.summary.fail === 0) {
        expect(results.exitCode).toBe(0);
      } else {
        expect(results.exitCode).toBe(1);
      }
    });

    it('should convert warnings to failures in strict mode', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'date': new Date().toUTCString() })
      } as any);

      const results = await doctor.runAllChecks({ strict: true });

      // In strict mode, there should be no warnings
      expect(results.summary.warn).toBe(0);
      // And the fail count should include converted warnings
      expect(results.checks).toHaveLength(6);
    });
  });
});