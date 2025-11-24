import { execSync } from 'child_process';

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