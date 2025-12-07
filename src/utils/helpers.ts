/**
 * Shared utility functions for CLI commands
 */

/**
 * Promise-based sleep function
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if the current terminal session is interactive
 * Returns false in CI environments or when stdin/stdout are not TTYs
 */
export function isInteractive(): boolean {
  return Boolean(process.stdout.isTTY && process.stdin.isTTY && !process.env.CI);
}

/**
 * Maximum consecutive errors allowed in polling loops before giving up
 */
export const MAX_CONSECUTIVE_ERRORS = 5;
