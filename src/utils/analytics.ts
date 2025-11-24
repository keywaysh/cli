import { PostHog } from 'posthog-node';
import crypto from 'crypto';
import path from 'path';
import os from 'os';
import fs from 'fs';
import pkg from '../../package.json' assert { type: 'json' };
import { INTERNAL_POSTHOG_HOST, INTERNAL_POSTHOG_KEY } from '../config/internal.js';

let posthog: PostHog | null = null;
let distinctId: string | null = null;

const CONFIG_DIR = path.join(os.homedir(), '.config', 'keyway');
const ID_FILE = path.join(CONFIG_DIR, 'id.json');
const TELEMETRY_DISABLED = process.env.KEYWAY_DISABLE_TELEMETRY === '1';
const CI = process.env.CI === 'true' || process.env.CI === '1';

interface IdConfig {
  distinctId: string;
}

function getDistinctId(): string {
  if (distinctId) return distinctId;

  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }

    if (fs.existsSync(ID_FILE)) {
      const content = fs.readFileSync(ID_FILE, 'utf-8');
      const config: IdConfig = JSON.parse(content);
      distinctId = config.distinctId;
      return distinctId;
    }

    distinctId = crypto.randomUUID();
    const config: IdConfig = { distinctId };
    fs.writeFileSync(ID_FILE, JSON.stringify(config, null, 2), { encoding: 'utf-8', mode: 0o600 });
    // Harden permissions if the file already existed with looser perms
    try {
      fs.chmodSync(ID_FILE, 0o600);
    } catch {
      // Best effort
    }

    return distinctId;
  } catch (error) {
    console.warn('Failed to persist distinct ID, using session-based ID');
    distinctId = `session-${crypto.randomUUID()}`;
    return distinctId;
  }
}

function initPostHog() {
  if (posthog) return;
  if (TELEMETRY_DISABLED) return;

  const apiKey = process.env.KEYWAY_POSTHOG_KEY || INTERNAL_POSTHOG_KEY;
  if (!apiKey) return;

  posthog = new PostHog(apiKey, {
    host: process.env.KEYWAY_POSTHOG_HOST || INTERNAL_POSTHOG_HOST,
  });
}

export function trackEvent(event: string, properties?: Record<string, any>) {
  try {
    if (TELEMETRY_DISABLED) return;
    if (!posthog) initPostHog();
    if (!posthog) return;

    const id = getDistinctId();
    const sanitizedProperties = properties ? sanitizeProperties(properties) : {};

    posthog.capture({
      distinctId: id,
      event,
      properties: {
        ...sanitizedProperties,
        source: 'cli',
        platform: process.platform,
        nodeVersion: process.version,
        version: pkg.version,
        ci: CI,
      },
    });
  } catch (error) {
    console.debug('Analytics error:', error);
  }
}

function sanitizeProperties(properties: Record<string, any>): Record<string, any> {
  const sanitized: Record<string, any> = {};

  for (const [key, value] of Object.entries(properties)) {
    if (
      key.toLowerCase().includes('secret') ||
      key.toLowerCase().includes('token') ||
      key.toLowerCase().includes('password') ||
      key.toLowerCase().includes('content') ||
      key.toLowerCase().includes('key') ||
      key.toLowerCase().includes('value')
    ) {
      continue;
    }
    if (value && typeof value === 'string' && value.length > 500) {
      // Avoid sending large blobs
      sanitized[key] = `${value.slice(0, 200)}...`;
      continue;
    }
    sanitized[key] = value;
  }

  return sanitized;
}

export async function shutdownAnalytics() {
  if (posthog) {
    await posthog.shutdown();
  }
}

export const AnalyticsEvents = {
  CLI_INIT: 'cli_init',
  CLI_PUSH: 'cli_push',
  CLI_PULL: 'cli_pull',
  CLI_ERROR: 'cli_error',
  CLI_LOGIN: 'cli_login',
  CLI_DOCTOR: 'cli_doctor',
} as const;
