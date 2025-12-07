import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sleep, isInteractive, MAX_CONSECUTIVE_ERRORS } from '../src/utils/helpers.js';

describe('helpers', () => {
  describe('sleep', () => {
    it('should resolve after the specified time', async () => {
      const start = Date.now();
      await sleep(50);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(45); // Allow small variance
      expect(elapsed).toBeLessThan(150);
    });

    it('should return a promise', () => {
      const result = sleep(1);
      expect(result).toBeInstanceOf(Promise);
    });
  });

  describe('isInteractive', () => {
    const originalStdoutIsTTY = process.stdout.isTTY;
    const originalStdinIsTTY = process.stdin.isTTY;
    const originalCI = process.env.CI;

    afterEach(() => {
      // Restore original values
      Object.defineProperty(process.stdout, 'isTTY', {
        value: originalStdoutIsTTY,
        configurable: true,
      });
      Object.defineProperty(process.stdin, 'isTTY', {
        value: originalStdinIsTTY,
        configurable: true,
      });
      if (originalCI === undefined) {
        delete process.env.CI;
      } else {
        process.env.CI = originalCI;
      }
    });

    it('should return true when both TTYs are true and CI is not set', () => {
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
      Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
      delete process.env.CI;

      expect(isInteractive()).toBe(true);
    });

    it('should return false when stdout is not a TTY', () => {
      Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
      Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
      delete process.env.CI;

      expect(isInteractive()).toBe(false);
    });

    it('should return false when stdin is not a TTY', () => {
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
      Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
      delete process.env.CI;

      expect(isInteractive()).toBe(false);
    });

    it('should return false when CI environment variable is set', () => {
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
      Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
      process.env.CI = '1';

      expect(isInteractive()).toBe(false);
    });

    it('should return false when CI is set to any truthy value', () => {
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
      Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
      process.env.CI = 'true';

      expect(isInteractive()).toBe(false);
    });

    it('should return false when stdout.isTTY is undefined', () => {
      Object.defineProperty(process.stdout, 'isTTY', { value: undefined, configurable: true });
      Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
      delete process.env.CI;

      expect(isInteractive()).toBe(false);
    });
  });

  describe('MAX_CONSECUTIVE_ERRORS', () => {
    it('should be a positive integer', () => {
      expect(MAX_CONSECUTIVE_ERRORS).toBeGreaterThan(0);
      expect(Number.isInteger(MAX_CONSECUTIVE_ERRORS)).toBe(true);
    });

    it('should be 5', () => {
      expect(MAX_CONSECUTIVE_ERRORS).toBe(5);
    });
  });
});
