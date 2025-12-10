import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import pc from 'picocolors';
import prompts from 'prompts';

export function getCurrentRepoFullName(): string {
  try {
    if (!isGitRepository()) {
      throw new Error('Not in a git repository');
    }

    const remoteUrl = execSync('git config --get remote.origin.url', {
      encoding: 'utf-8',
    }).trim();

    return parseGitHubUrl(remoteUrl);
  } catch (error) {
    throw new Error('Failed to get repository name. Make sure you are in a git repository with a GitHub remote.');
  }
}

export function isGitRepository(): boolean {
  try {
    execSync('git rev-parse --is-inside-work-tree', {
      encoding: 'utf-8',
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

export function detectGitRepo(): string | null {
  try {
    const remoteUrl = execSync('git remote get-url origin', {
      encoding: 'utf-8',
      stdio: 'pipe',
    }).trim();

    return parseGitHubUrl(remoteUrl);
  } catch {
    return null;
  }
}

function parseGitHubUrl(url: string): string {
  const sshMatch = url.match(/git@github\.com:(.+)\/(.+)\.git/);
  if (sshMatch) {
    return `${sshMatch[1]}/${sshMatch[2]}`;
  }

  const httpsMatch = url.match(/https:\/\/github\.com\/(.+)\/(.+)\.git/);
  if (httpsMatch) {
    return `${httpsMatch[1]}/${httpsMatch[2]}`;
  }

  const httpsMatch2 = url.match(/https:\/\/github\.com\/(.+)\/(.+)/);
  if (httpsMatch2) {
    return `${httpsMatch2[1]}/${httpsMatch2[2]}`;
  }

  throw new Error(`Invalid GitHub URL: ${url}`);
}

/**
 * Check if .env files are in .gitignore
 * Returns true if properly gitignored, false otherwise
 */
export function checkEnvGitignore(): boolean {
  try {
    const gitRoot = execSync('git rev-parse --show-toplevel', {
      encoding: 'utf-8',
      stdio: 'pipe',
    }).trim();

    const gitignorePath = path.join(gitRoot, '.gitignore');

    if (!fs.existsSync(gitignorePath)) {
      return false;
    }

    const content = fs.readFileSync(gitignorePath, 'utf-8');
    const lines = content.split('\n').map(l => l.trim());

    // Check for patterns that would ignore .env files
    const envPatterns = ['.env', '.env*', '.env.*', '*.env'];
    return envPatterns.some(pattern => lines.includes(pattern));
  } catch {
    // Not a git repo or other error - don't warn
    return true;
  }
}

/**
 * Add .env to .gitignore file
 */
export function addEnvToGitignore(): boolean {
  try {
    const gitRoot = execSync('git rev-parse --show-toplevel', {
      encoding: 'utf-8',
      stdio: 'pipe',
    }).trim();

    const gitignorePath = path.join(gitRoot, '.gitignore');
    const envEntry = '.env*';

    if (fs.existsSync(gitignorePath)) {
      const content = fs.readFileSync(gitignorePath, 'utf-8');
      // Add with newline if file doesn't end with one
      const newContent = content.endsWith('\n')
        ? `${content}${envEntry}\n`
        : `${content}\n${envEntry}\n`;
      fs.writeFileSync(gitignorePath, newContent);
    } else {
      fs.writeFileSync(gitignorePath, `${envEntry}\n`);
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Warn if .env files are not gitignored and offer to add them
 */
export async function warnIfEnvNotGitignored(): Promise<void> {
  if (checkEnvGitignore()) {
    return;
  }

  console.log(pc.yellow('⚠️  .env files are not in .gitignore - secrets may be committed'));

  const { addToGitignore } = await prompts({
    type: 'confirm',
    name: 'addToGitignore',
    message: 'Add .env* to .gitignore?',
    initial: true,
  });

  if (addToGitignore) {
    if (addEnvToGitignore()) {
      console.log(pc.green('✓ Added .env* to .gitignore'));
    } else {
      console.log(pc.red('✗ Failed to update .gitignore'));
    }
  }
}