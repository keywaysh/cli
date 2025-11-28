import chalk from 'chalk';
import readline from 'node:readline';
import open from 'open';
import prompts from 'prompts';
import { pollDeviceLogin, startDeviceLogin, validateToken } from '../utils/api.js';
import { clearAuth, getAuthFilePath, getStoredAuth, saveAuthToken } from '../utils/auth.js';
import { detectGitRepo } from '../utils/git.js';
import { trackEvent, AnalyticsEvents } from '../utils/analytics.js';

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isInteractive(): boolean {
  return Boolean(process.stdout.isTTY && process.stdin.isTTY && !process.env.CI);
}

async function promptYesNo(question: string, defaultYes = true): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(question, (answer) => {
      rl.close();
      const normalized = answer.trim().toLowerCase();
      if (!normalized) return resolve(defaultYes);
      if (['y', 'yes'].includes(normalized)) return resolve(true);
      if (['n', 'no'].includes(normalized)) return resolve(false);
      return resolve(defaultYes);
    });
  });
}

export async function runLoginFlow(): Promise<string> {
  console.log(chalk.blue('🔐 Starting Keyway login...\n'));

  const repoName = detectGitRepo();
  const start = await startDeviceLogin(repoName);
  const verifyUrl = start.verificationUriComplete || start.verificationUri;

  if (!verifyUrl) {
    throw new Error('Missing verification URL from the auth server.');
  }

  console.log(`Code: ${chalk.green.bold(start.userCode)}`);
  console.log('Waiting for auth...');

  // Best-effort open browser; user still sees the URL.
  open(verifyUrl).catch(() => {
    console.log(chalk.gray(`Open this URL in your browser: ${verifyUrl}`));
  });

  const pollIntervalMs = (start.interval ?? 5) * 1000;
  // Use server-provided expiration, capped at 30 minutes max
  const maxTimeoutMs = Math.min((start.expiresIn ?? 900) * 1000, 30 * 60 * 1000);
  const startTime = Date.now();

  while (true) {
    // Check for timeout
    if (Date.now() - startTime > maxTimeoutMs) {
      throw new Error('Login timed out. Please run "keyway login" again.');
    }

    await sleep(pollIntervalMs);
    const result = await pollDeviceLogin(start.deviceCode);

    if (result.status === 'pending') {
      continue;
    }

    if (result.status === 'approved' && result.keywayToken) {
      await saveAuthToken(result.keywayToken, {
        githubLogin: result.githubLogin,
        expiresAt: result.expiresAt,
      });

      trackEvent(AnalyticsEvents.CLI_LOGIN, {
        method: 'device',
        repo: repoName,
      });

      console.log(chalk.green('\n✓ Login successful'));
      if (result.githubLogin) {
        console.log(`Authenticated GitHub user: ${chalk.cyan(result.githubLogin)}`);
      }
      return result.keywayToken;
    }

    throw new Error(result.message || 'Authentication failed');
  }
}

export async function ensureLogin(options: { allowPrompt?: boolean } = {}): Promise<string> {
  const envToken = process.env.KEYWAY_TOKEN || process.env.GITHUB_TOKEN;
  if (envToken) {
    return envToken;
  }

  const stored = await getStoredAuth();
  if (stored?.keywayToken) {
    return stored.keywayToken;
  }

  const allowPrompt = options.allowPrompt !== false;
  const canPrompt = allowPrompt && isInteractive();

  if (!canPrompt) {
    throw new Error('No Keyway session found. Run "keyway login" to authenticate.');
  }

  const proceed = await promptYesNo('No Keyway session found. Open the browser to sign in now? (Y/n) ');
  if (!proceed) {
    throw new Error('Login required. Aborting.');
  }

  return runLoginFlow();
}

async function runTokenLogin(): Promise<string> {
  const repoName = detectGitRepo();
  if (repoName) {
    console.log(`📁 Detected: ${chalk.cyan(repoName)}`);
  }

  const description = repoName ? `Keyway CLI for ${repoName}` : 'Keyway CLI';
  const url = `https://github.com/settings/personal-access-tokens/new?description=${encodeURIComponent(description)}`;

  console.log('Opening GitHub...');
  open(url).catch(() => {
    console.log(chalk.gray(`Open this URL in your browser: ${url}`));
  });

  console.log(chalk.gray('Select the detected repo (or scope manually).'));
  console.log(chalk.gray('Permissions: Metadata → Read-only; Account permissions: None.'));

  const { token } = await prompts(
    {
      type: 'password',
      name: 'token',
      message: 'Paste token:',
      validate: (value: string) => {
        if (!value || typeof value !== 'string') return 'Token is required';
        if (!value.startsWith('github_pat_')) return 'Token must start with github_pat_';
        return true;
      },
    },
    {
      onCancel: () => {
        throw new Error('Login cancelled.');
      },
    }
  );

  if (!token || typeof token !== 'string') {
    throw new Error('Token is required.');
  }

  const trimmedToken = token.trim();
  if (!trimmedToken.startsWith('github_pat_')) {
    throw new Error('Token must start with github_pat_.');
  }

  const validation = await validateToken(trimmedToken);

  await saveAuthToken(trimmedToken, {
    githubLogin: validation.username,
  });

  trackEvent(AnalyticsEvents.CLI_LOGIN, {
    method: 'pat',
    repo: repoName,
  });

  console.log(chalk.green('✅ Authenticated'), `as ${chalk.cyan(`@${validation.username}`)}`);
  return trimmedToken;
}

interface LoginOptions {
  token?: boolean;
}

export async function loginCommand(options: LoginOptions = {}) {
  try {
    if (options.token) {
      await runTokenLogin();
    } else {
      await runLoginFlow();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected login error';
    trackEvent(AnalyticsEvents.CLI_ERROR, {
      command: 'login',
      error: message.slice(0, 200),
    });
    console.error(chalk.red(`\n✗ ${message}`));
    process.exit(1);
  }
}

export async function logoutCommand() {
  clearAuth();
  console.log(chalk.green('✓ Logged out of Keyway'));
  console.log(chalk.gray(`Auth cache cleared: ${getAuthFilePath()}`));
}
