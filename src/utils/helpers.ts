/**
 * Shared utility functions for CLI commands
 */

import pc from 'picocolors';
import open from 'open';

/**
 * Promise-based sleep function
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Display a URL and attempt to open it in the browser.
 * Always shows the URL so users can copy it if auto-open fails.
 */
export async function openUrl(url: string): Promise<void> {
  console.log(pc.gray(`\nOpen this URL in your browser:\n${url}\n`));
  await open(url).catch(() => {
    // Silent fail - user already has the URL above
  });
}

/**
 * Check if the current terminal session is interactive
 * Returns false in CI environments or when stdin/stdout are not TTYs
 */
export function isInteractive(): boolean {
  return Boolean(process.stdout.isTTY && process.stdin.isTTY && !process.env.CI);
}

/**
 * Display an upgrade prompt for plan limits.
 */
export function showUpgradePrompt(message: string, upgradeUrl: string): void {
  console.log('');
  console.log(pc.dim('─'.repeat(50)));
  console.log('');
  console.log(`  ${pc.yellow('⚡')} ${pc.bold('Plan Limit Reached')}`);
  console.log('');
  console.log(pc.white(`  ${message}`));
  console.log('');
  console.log(`  ${pc.cyan('Upgrade now →')} ${pc.underline(upgradeUrl)}`);
  console.log('');
  console.log(pc.dim('─'.repeat(50)));
  console.log('');
}

/**
 * Maximum consecutive errors allowed in polling loops before giving up
 */
export const MAX_CONSECUTIVE_ERRORS = 5;
