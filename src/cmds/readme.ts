import fs from 'fs';
import path from 'path';
import prompts from 'prompts';
import pc from 'picocolors';
import { detectGitRepo } from '../utils/git.js';

export function generateBadge(repo: string): string {
  return `[![Keyway Secrets](https://www.keyway.sh/badge.svg?repo=${repo})](https://www.keyway.sh/vaults/${repo})`;
}

export function insertBadgeIntoReadme(readmeContent: string, badge: string): string {
  if (readmeContent.includes('keyway.sh/badge.svg')) {
    return readmeContent;
  }

  const lines = readmeContent.split(/\r?\n/);
  const titleIndex = lines.findIndex((line) => /^#(?!#)\s+/.test(line.trim()));

  if (titleIndex !== -1) {
    const before = lines.slice(0, titleIndex + 1);
    const after = lines.slice(titleIndex + 1);
    // Remove leading empty lines from after (we'll add our own spacing)
    while (after.length > 0 && after[0].trim() === '') {
      after.shift();
    }
    const newLines = [...before, '', badge, '', ...after];
    return newLines.join('\n');
  }

  return `${badge}\n\n${readmeContent}`;
}

export function findReadmePath(cwd: string): string | null {
  const candidates = ['README.md', 'readme.md', 'Readme.md'];
  for (const candidate of candidates) {
    const candidatePath = path.join(cwd, candidate);
    if (fs.existsSync(candidatePath)) {
      return candidatePath;
    }
  }
  return null;
}

async function ensureReadme(repoName: string, cwd: string): Promise<string | null> {
  const existing = findReadmePath(cwd);
  if (existing) return existing;

  const isInteractive = process.stdin.isTTY && process.stdout.isTTY;
  if (!isInteractive) {
    console.log(pc.yellow('No README found. Run "keyway readme add-badge" from a repo with a README.'));
    return null;
  }

  const { confirm } = await prompts(
    {
      type: 'confirm',
      name: 'confirm',
      message: 'No README found. Create a default README.md?',
      initial: false,
    },
    {
      onCancel: () => ({ confirm: false }),
    }
  );

  if (!confirm) {
    console.log(pc.yellow('Skipping badge insertion (no README).'));
    return null;
  }

  const defaultPath = path.join(cwd, 'README.md');
  const content = `# ${repoName}\n\n`;
  fs.writeFileSync(defaultPath, content, 'utf-8');
  return defaultPath;
}

export async function addBadgeToReadme(silent = false): Promise<boolean> {
  const repo = detectGitRepo();
  if (!repo) {
    throw new Error('This directory is not a Git repository.');
  }

  const cwd = process.cwd();
  const readmePath = await ensureReadme(repo, cwd);
  if (!readmePath) return false;

  const badge = generateBadge(repo);
  const content = fs.readFileSync(readmePath, 'utf-8');
  const updated = insertBadgeIntoReadme(content, badge);

  if (updated === content) {
    if (!silent) {
      console.log(pc.gray('Keyway badge already present in README.'));
    }
    return false;
  }

  fs.writeFileSync(readmePath, updated, 'utf-8');
  if (!silent) {
    console.log(pc.green(`✓ Keyway badge added to ${path.basename(readmePath)}`));
  }
  return true;
}
