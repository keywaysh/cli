import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockCaptures: any[] = [];

vi.mock('posthog-node', () => {
  class PostHog {
    capture(payload: any) {
      mockCaptures.push(payload);
    }
    shutdown() {
      return Promise.resolve();
    }
  }
  return { PostHog };
});

describe('analytics trackEvent', () => {
  beforeEach(() => {
    mockCaptures.length = 0;
    vi.resetModules();
    delete process.env.KEYWAY_DISABLE_TELEMETRY;
    process.env.KEYWAY_POSTHOG_KEY = 'ph_test_key';
    process.env.KEYWAY_POSTHOG_HOST = 'https://example.com';
    process.env.CI = '1';
  });

  it('captures event with version and ci metadata', async () => {
    const { trackEvent, shutdownAnalytics } = await import('../src/utils/analytics.js');
    trackEvent('test_event', { foo: 'bar' });
    await shutdownAnalytics();
    expect(mockCaptures.length).toBe(1);
    const payload = mockCaptures[0];
    expect(payload.event).toBe('test_event');
    expect(payload.properties.version).toBeDefined();
    expect(payload.properties.ci).toBe(true);
    expect(payload.properties.platform).toBe(process.platform);
  });

  it('does not capture when telemetry is disabled', async () => {
    vi.resetModules();
    mockCaptures.length = 0;
    process.env.KEYWAY_DISABLE_TELEMETRY = '1';
    process.env.KEYWAY_POSTHOG_KEY = 'ph_test_key';
    const { trackEvent, shutdownAnalytics } = await import('../src/utils/analytics.js');
    trackEvent('test_event', { foo: 'bar' });
    await shutdownAnalytics();
    expect(mockCaptures.length).toBe(0);
  });
});
