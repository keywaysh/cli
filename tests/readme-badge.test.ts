import { describe, it, expect } from 'vitest';
import { insertBadgeIntoReadme, generateBadge } from '../src/cmds/readme.js';

const badge = generateBadge('acme/backend');

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
});
