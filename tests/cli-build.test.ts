import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

describe('CLI Build', () => {
  const distPath = join(rootDir, 'dist', 'cli.js');

  beforeAll(() => {
    // Ensure the build is fresh
    execSync('pnpm run build', { cwd: rootDir, stdio: 'pipe' });
  });

  it('should produce a dist/cli.js file', () => {
    expect(existsSync(distPath)).toBe(true);
  });

  it('should execute without errors', () => {
    // Test that the CLI can at least show version without crashing
    const result = execSync(`node ${distPath} --version`, {
      encoding: 'utf-8',
      cwd: rootDir,
    });
    expect(result).toMatch(/\d+\.\d+\.\d+/);
  });

  it('should execute help without errors', () => {
    const result = execSync(`node ${distPath} --help`, {
      encoding: 'utf-8',
      cwd: rootDir,
    });
    expect(result).toContain('keyway');
    expect(result).toContain('Sync secrets with your team and infra');
  });

  it('should show banner without crashing (picocolors compatibility)', () => {
    // This test specifically catches the pc.cyan.bold() bug
    // The banner runs on CLI startup, so any version/help call would catch it
    const result = execSync(`node ${distPath} -V`, {
      encoding: 'utf-8',
      cwd: rootDir,
    });
    expect(result).toContain('Keyway CLI');
  });

  it('should have all commands registered', () => {
    const result = execSync(`node ${distPath} --help`, {
      encoding: 'utf-8',
      cwd: rootDir,
    });

    // Core commands
    expect(result).toContain('init');
    expect(result).toContain('push');
    expect(result).toContain('pull');
    expect(result).toContain('login');
    expect(result).toContain('logout');
    expect(result).toContain('doctor');

    // Integration commands
    expect(result).toContain('connect');
    expect(result).toContain('connections');
    expect(result).toContain('disconnect');
    expect(result).toContain('sync');
  });
});

describe('Picocolors Usage', () => {
  it('should not use chained color methods (pc.color.modifier)', () => {
    // picocolors doesn't support chaining like chalk does
    // e.g., pc.cyan.bold() is INVALID, should be pc.bold(pc.cyan())
    const srcDir = join(rootDir, 'src');

    const checkFile = (filePath: string) => {
      const content = readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');

      // Pattern to detect chained picocolors calls like pc.cyan.bold(
      // This catches: pc.color.modifier( where modifier is bold, dim, italic, etc.
      const chainedPattern = /pc\.(cyan|red|green|yellow|blue|magenta|white|gray|black)\.(bold|dim|italic|underline|inverse|hidden|strikethrough)\(/g;

      const matches: string[] = [];
      lines.forEach((line, index) => {
        const lineMatches = line.match(chainedPattern);
        if (lineMatches) {
          matches.push(`Line ${index + 1}: ${lineMatches.join(', ')}`);
        }
      });

      return matches;
    };

    // Get all TypeScript files in src
    const getAllTsFiles = (dir: string): string[] => {
      const { readdirSync, statSync } = require('fs');
      const files: string[] = [];

      const entries = readdirSync(dir);
      for (const entry of entries) {
        const fullPath = join(dir, entry);
        const stat = statSync(fullPath);

        if (stat.isDirectory()) {
          files.push(...getAllTsFiles(fullPath));
        } else if (entry.endsWith('.ts')) {
          files.push(fullPath);
        }
      }

      return files;
    };

    const tsFiles = getAllTsFiles(srcDir);
    const allIssues: { file: string; issues: string[] }[] = [];

    for (const file of tsFiles) {
      const issues = checkFile(file);
      if (issues.length > 0) {
        allIssues.push({
          file: file.replace(rootDir, ''),
          issues,
        });
      }
    }

    if (allIssues.length > 0) {
      const message = allIssues
        .map(({ file, issues }) => `${file}:\n  ${issues.join('\n  ')}`)
        .join('\n\n');

      throw new Error(
        `Found chained picocolors calls (not supported):\n\n${message}\n\n` +
        'Fix: Change pc.color.modifier() to pc.modifier(pc.color())\n' +
        'Example: pc.cyan.bold("text") → pc.bold(pc.cyan("text"))'
      );
    }
  });
});
