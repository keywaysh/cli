import { describe, it, expect } from 'vitest';
import { insertBadgeIntoReadme, generateBadge } from '../src/cmds/readme.js';

const badge = generateBadge('acme/backend');

describe('generateBadge', () => {
  it('generates correct badge URL format', () => {
    const result = generateBadge('NicolasRitouet/guideeco.fr');
    expect(result).toContain('https://www.keyway.sh/badge.svg?repo=NicolasRitouet/guideeco.fr');
    expect(result).toContain('https://www.keyway.sh/vaults/NicolasRitouet/guideeco.fr');
  });

  it('generates markdown image link', () => {
    const result = generateBadge('acme/backend');
    expect(result).toMatch(/^\[!\[Keyway Secrets\]\(.*\)\]\(.*\)$/);
  });
});

describe('insertBadgeIntoReadme', () => {
  it('returns unchanged when badge already present', () => {
    const content = `# Title\n\n${badge}\n\nSome content`;
    expect(insertBadgeIntoReadme(content, badge)).toBe(content);
  });

  it('inserts after first title with spacing', () => {
    const content = '# Title\n\nSome content';
    const updated = insertBadgeIntoReadme(content, badge);
    expect(updated).toBe(`# Title\n\n${badge}\n\nSome content`);
  });

  it('inserts at top when no title', () => {
    const content = 'Intro\n\nMore text';
    const updated = insertBadgeIntoReadme(content, badge);
    expect(updated).toBe(`${badge}\n\n${content}`);
  });

  it('inserts at top when only h2 title (no h1)', () => {
    // The regex /^#(?!#)\s+/ only matches h1 ("# "), not h2+ ("## "), so h2-only content gets badge at top
    const content = '## Secondary Title\n\nContent here';
    const updated = insertBadgeIntoReadme(content, badge);
    expect(updated).toBe(`${badge}\n\n${content}`);
  });

  it('handles multiple titles - inserts after first', () => {
    const content = '# Main Title\n\n## Section\n\nContent';
    const updated = insertBadgeIntoReadme(content, badge);
    expect(updated).toBe(`# Main Title\n\n${badge}\n\n## Section\n\nContent`);
  });

  it('handles empty content', () => {
    const content = '';
    const updated = insertBadgeIntoReadme(content, badge);
    expect(updated).toBe(`${badge}\n\n`);
  });

  it('handles content with only a title', () => {
    const content = '# Just a Title';
    const updated = insertBadgeIntoReadme(content, badge);
    // Empty after array joins as trailing newline
    expect(updated).toBe(`# Just a Title\n\n${badge}\n`);
  });

  it('handles Windows line endings (CRLF)', () => {
    const content = '# Title\r\n\r\nSome content';
    const updated = insertBadgeIntoReadme(content, badge);
    expect(updated).toContain(badge);
    expect(updated).toContain('# Title');
    expect(updated).toContain('Some content');
  });

  it('detects existing badge with different repo', () => {
    const existingBadge = generateBadge('other/repo');
    const content = `# Title\n\n${existingBadge}\n\nContent`;
    const updated = insertBadgeIntoReadme(content, badge);
    // Should not add another badge
    expect(updated).toBe(content);
  });

  it('handles multiple blank lines between title and content', () => {
    const content = '# Title\n\n\n\nSome content';
    const updated = insertBadgeIntoReadme(content, badge);
    expect(updated).toBe(`# Title\n\n${badge}\n\nSome content`);
  });

  // Regression tests for h1-only matching
  it('does NOT insert badge after h2/h3 headers', () => {
    const content = '## Getting Started\n\n### Install\n\nContent';
    const updated = insertBadgeIntoReadme(content, badge);
    // No h1 = badge at top
    expect(updated).toBe(`${badge}\n\n${content}`);
  });

  it('does NOT insert badge after comments in code blocks', () => {
    const content = `# Project

\`\`\`bash
npm run dev
# this is a comment
yarn dev
\`\`\``;
    const updated = insertBadgeIntoReadme(content, badge);
    // Badge should be after h1 title, not affected by # in code block
    expect(updated).toBe(`# Project\n\n${badge}\n\n\`\`\`bash
npm run dev
# this is a comment
yarn dev
\`\`\``);
  });
});
