import fs from 'fs';
import path from 'path';
import prompts from 'prompts';
import pc from 'picocolors';
import balanced from 'balanced-match';
import { detectGitRepo } from '../utils/git.js';

export function generateBadge(repo: string): string {
  return `[![Keyway Secrets](https://www.keyway.sh/badge.svg?repo=${repo})](https://www.keyway.sh/vaults/${repo})`;
}

// Regex to detect the START of a markdown badge: [![alt](img-url)](
const BADGE_PREFIX = /\[!\[[^\]]*\]\([^)]*\)\]\(/g;
const H1_PATTERN = /^#\s+/;
const CODE_FENCE = /^```/;

/**
 * Find the end position of the last badge on a line.
 * Uses balanced-match to handle URLs with parentheses like Wikipedia links.
 */
function findLastBadgeEnd(line: string): number {
  let lastEnd = -1;
  let match;
  BADGE_PREFIX.lastIndex = 0;

  while ((match = BADGE_PREFIX.exec(line)) !== null) {
    const prefixEnd = match.index + match[0].length - 1; // position of "("
    const remainder = line.substring(prefixEnd);
    const balancedMatch = balanced('(', ')', remainder);
    if (balancedMatch) {
      lastEnd = prefixEnd + balancedMatch.end + 1; // +1 to include ")"
    }
  }
  return lastEnd;
}

export function insertBadgeIntoReadme(readmeContent: string, badge: string): string {
  // Idempotence check
  if (readmeContent.includes('keyway.sh/badge.svg')) {
    return readmeContent;
  }

  const lines = readmeContent.split(/\r?\n/);

  // Parser state
  let inCodeBlock = false;
  let inHtmlComment = false;
  let lastBadgeLine = -1;
  let lastBadgeEndIndex = -1;
  let firstH1Line = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Track code blocks (toggle on ```)
    if (CODE_FENCE.test(trimmed)) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    // Track HTML comments (simplified handling)
    if (trimmed.includes('<!--')) inHtmlComment = true;
    if (trimmed.includes('-->')) {
      inHtmlComment = false;
      continue;
    }
    if (inHtmlComment) continue;

    // Find badges
    BADGE_PREFIX.lastIndex = 0;
    if (BADGE_PREFIX.test(line)) {
      lastBadgeLine = i;
      lastBadgeEndIndex = findLastBadgeEnd(line);
    }

    // Find first H1
    if (firstH1Line === -1 && H1_PATTERN.test(line)) {
      firstH1Line = i;
    }
  }

  // Decision: where to insert
  if (lastBadgeLine >= 0 && lastBadgeEndIndex > 0) {
    // Insert after last badge on that line
    const line = lines[lastBadgeLine];
    lines[lastBadgeLine] =
      line.slice(0, lastBadgeEndIndex) + ' ' + badge + line.slice(lastBadgeEndIndex);
    return lines.join('\n');
  }

  if (firstH1Line >= 0) {
    // Insert after H1
    const before = lines.slice(0, firstH1Line + 1);
    const after = lines.slice(firstH1Line + 1);
    // Remove leading empty lines from after (we'll add our own spacing)
    while (after.length > 0 && after[0].trim() === '') {
      after.shift();
    }
    if (after.length > 0) {
      return [...before, '', badge, '', ...after].join('\n');
    } else {
      // Only title, no content after
      return [...before, '', badge, ''].join('\n');
    }
  }

  // No H1, insert at beginning
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
