import pc from 'picocolors';
import prompts from 'prompts';
import open from 'open';
import { getCurrentRepoFullName } from '../utils/git.js';
import { APIError, initVault, truncateMessage, checkGitHubAppInstallation, checkVaultExists } from '../utils/api.js';
import { trackEvent, AnalyticsEvents, shutdownAnalytics, identifyUser } from '../utils/analytics.js';
import { addBadgeToReadme } from './readme.js';
import { discoverEnvCandidates, pushCommand } from './push.js';
import { getStoredAuth, saveAuthToken } from '../utils/auth.js';
import { pollDeviceLogin, startDeviceLogin } from '../utils/api.js';

const DASHBOARD_URL = 'https://www.keyway.sh/dashboard/vaults';
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 120000; // 2 minutes

interface InitOptions {
  loginPrompt?: boolean;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isInteractive(): boolean {
  return Boolean(process.stdout.isTTY && process.stdin.isTTY && !process.env.CI);
}

/**
 * Unified flow: handles both login AND GitHub App installation in one step.
 *
 * When user is not logged in AND needs GitHub App:
 * - Opens browser to GitHub App installation page
 * - GitHub App has "Request user authorization during installation" enabled
 * - After installation, user is both authenticated AND app is installed
 * - We poll for both states using device flow
 *
 * When user is already logged in but needs GitHub App:
 * - Opens browser to GitHub App installation page
 * - Polls for installation completion
 *
 * Returns the access token on success.
 */
async function ensureLoginAndGitHubApp(
  repoFullName: string,
  options: { allowPrompt?: boolean } = {}
): Promise<string> {
  const [repoOwner, repoName] = repoFullName.split('/');

  // Check if already logged in
  const envToken = process.env.KEYWAY_TOKEN;
  if (envToken) {
    // User has env token, check GitHub App installation
    const result = await ensureGitHubAppInstalledOnly(repoFullName, envToken);
    if (result === null) {
      // Token was invalid - for env tokens, user must fix manually
      throw new Error('KEYWAY_TOKEN is invalid or expired. Please update the token.');
    }
    return result;
  }

  const stored = await getStoredAuth();
  if (stored?.keywayToken) {
    // User is already logged in, try to check GitHub App installation
    const result = await ensureGitHubAppInstalledOnly(repoFullName, stored.keywayToken);
    if (result !== null) {
      return result;
    }
    // Token was invalid (401), fall through to unified login flow below
  }

  // User is NOT logged in - use unified flow
  const allowPrompt = options.allowPrompt !== false;
  if (!allowPrompt || !isInteractive()) {
    throw new Error('No Keyway session found. Run "keyway login" to authenticate.');
  }

  // Prompt for unified flow
  console.log('');
  console.log(pc.gray('  Keyway uses a GitHub App for secure access.'));
  console.log(pc.gray('  Installing the app will also log you in.'));
  console.log('');

  const { shouldProceed } = await prompts({
    type: 'confirm',
    name: 'shouldProceed',
    message: 'Open browser to install Keyway & sign in?',
    initial: true,
  });

  if (!shouldProceed) {
    throw new Error('Setup required. Run "keyway init" when ready.');
  }

  // Start device flow for login (this creates the device code before opening browser)
  const deviceStart = await startDeviceLogin(repoFullName);

  // Get install URL from API response (allows different URLs per environment)
  const installUrl = deviceStart.githubAppInstallUrl || 'https://github.com/apps/keyway/installations/new';

  // Open browser to GitHub App installation page
  // User will authorize the app AND log in during installation
  console.log(pc.gray('\n  Opening browser...'));
  await open(installUrl);

  console.log('');
  console.log(pc.blue('⏳ Waiting for installation & authorization...'));
  console.log(pc.gray('   (Press Ctrl+C to cancel)\n'));

  // Poll for both login AND installation
  const pollIntervalMs = Math.max((deviceStart.interval ?? 5) * 1000, POLL_INTERVAL_MS);
  const startTime = Date.now();
  let accessToken: string | null = null;

  while (Date.now() - startTime < POLL_TIMEOUT_MS) {
    await sleep(pollIntervalMs);

    try {
      // Poll device login first
      if (!accessToken) {
        const result = await pollDeviceLogin(deviceStart.deviceCode);
        if (result.status === 'approved' && result.keywayToken) {
          accessToken = result.keywayToken;
          await saveAuthToken(result.keywayToken, {
            githubLogin: result.githubLogin,
            expiresAt: result.expiresAt,
          });
          console.log(pc.green('✓ Signed in!'));
          if (result.githubLogin) {
            identifyUser(result.githubLogin, {
              github_username: result.githubLogin,
              login_method: 'github_app',
            });
          }
        }
      }

      // If we have a token, check GitHub App installation
      if (accessToken) {
        const installStatus = await checkGitHubAppInstallation(repoOwner, repoName, accessToken);
        if (installStatus.installed) {
          console.log(pc.green('✓ GitHub App installed!'));
          console.log('');
          return accessToken;
        }
      }

      process.stdout.write(pc.gray('.'));
    } catch {
      // Ignore polling errors, keep trying
    }
  }

  // Timeout
  console.log('');
  console.log(pc.yellow('⚠ Timed out waiting for setup.'));
  console.log(pc.gray(`  Install the GitHub App: ${installUrl}`));
  throw new Error('Setup timed out. Please try again.');
}

/**
 * Check GitHub App installation when user is already logged in.
 * Returns null if the token is invalid (401 error), signaling that re-auth is needed.
 */
async function ensureGitHubAppInstalledOnly(
  repoFullName: string,
  accessToken: string
): Promise<string | null> {
  const [repoOwner, repoName] = repoFullName.split('/');

  let status;
  try {
    status = await checkGitHubAppInstallation(repoOwner, repoName, accessToken);
  } catch (error) {
    // If we get a 401, the token is invalid (user not found in this environment)
    // Clear the stored token and signal that re-auth is needed
    if (error instanceof APIError && error.statusCode === 401) {
      console.log(pc.yellow('\n⚠ Session expired or invalid. Clearing credentials...'));
      const { clearAuth } = await import('../utils/auth.js');
      clearAuth();
      return null; // Signal that we need to restart auth flow
    }
    throw error;
  }

  if (status.installed) {
    return accessToken;
  }

  // GitHub App not installed - prompt user
  console.log('');
  console.log(pc.yellow('⚠ GitHub App not installed for this repository'));
  console.log('');
  console.log(pc.gray('  The Keyway GitHub App is required to securely manage secrets.'));
  console.log(pc.gray('  It only requests minimal permissions (repository metadata).'));
  console.log('');

  if (!isInteractive()) {
    console.log(pc.gray(`  Install the Keyway GitHub App: ${status.installUrl}`));
    throw new Error('GitHub App installation required.');
  }

  const { shouldInstall } = await prompts({
    type: 'confirm',
    name: 'shouldInstall',
    message: 'Open browser to install Keyway GitHub App?',
    initial: true,
  });

  if (!shouldInstall) {
    console.log(pc.gray(`\n  You can install later: ${status.installUrl}`));
    throw new Error('GitHub App installation required.');
  }

  // Open browser
  console.log(pc.gray('\n  Opening browser...'));
  await open(status.installUrl);

  console.log('');
  console.log(pc.blue('⏳ Waiting for GitHub App installation...'));
  console.log(pc.gray('   (Press Ctrl+C to cancel)\n'));

  // Poll for installation
  const startTime = Date.now();
  while (Date.now() - startTime < POLL_TIMEOUT_MS) {
    await sleep(POLL_INTERVAL_MS);

    try {
      const pollStatus = await checkGitHubAppInstallation(repoOwner, repoName, accessToken);
      if (pollStatus.installed) {
        console.log(pc.green('✓ GitHub App installed!'));
        console.log('');
        return accessToken;
      }
      process.stdout.write(pc.gray('.'));
    } catch {
      // Ignore polling errors, keep trying
    }
  }

  // Timeout
  console.log('');
  console.log(pc.yellow('⚠ Timed out waiting for installation.'));
  console.log(pc.gray(`  You can install the GitHub App later: ${status.installUrl}`));
  throw new Error('GitHub App installation timed out.');
}

export async function initCommand(options: InitOptions = {}) {
  try {
    const repoFullName = getCurrentRepoFullName();
    const dashboardLink = `${DASHBOARD_URL}/${repoFullName}`;

    console.log(pc.blue('🔐 Initializing Keyway vault...\n'));
    console.log(`  ${pc.gray('Repository:')} ${pc.white(repoFullName)}`);

    // Unified flow: handles login + GitHub App installation in one step
    const accessToken = await ensureLoginAndGitHubApp(repoFullName, {
      allowPrompt: options.loginPrompt !== false,
    });

    trackEvent(AnalyticsEvents.CLI_INIT, { repoFullName, githubAppInstalled: true });

    // Check if vault already exists before trying to create
    const vaultExists = await checkVaultExists(accessToken, repoFullName);
    if (vaultExists) {
      console.log(pc.green('\n✓ Already initialized!\n'));
      console.log(`  ${pc.yellow('→')} Run ${pc.cyan('keyway push')} to sync your secrets`);
      console.log(`  ${pc.blue('⎔')} Dashboard: ${pc.underline(dashboardLink)}`);
      console.log('');
      await shutdownAnalytics();
      return;
    }

    await initVault(repoFullName, accessToken);

    console.log(pc.green('✓ Vault created!'));

    // Add badge to README (silent mode - we handle the message ourselves)
    try {
      const badgeAdded = await addBadgeToReadme(true);
      if (badgeAdded) {
        console.log(pc.green('✓ Badge added to README.md'));
      }
    } catch {
      // Silent fail for badge
    }
    console.log('');

    // Check for .env files
    const envCandidates = discoverEnvCandidates(process.cwd());
    const isInteractive = process.stdin.isTTY && process.stdout.isTTY;

    if (envCandidates.length > 0 && isInteractive) {
      console.log(pc.gray(`  Found ${envCandidates.length} env file(s): ${envCandidates.map(c => c.file).join(', ')}\n`));

      const { shouldPush } = await prompts({
        type: 'confirm',
        name: 'shouldPush',
        message: 'Push secrets now?',
        initial: true,
      });

      if (shouldPush) {
        console.log('');
        await pushCommand({ loginPrompt: false, yes: false });
        return;
      }
    }

    // Show next steps if not pushing
    console.log(pc.dim('─'.repeat(50)));
    console.log('');

    if (envCandidates.length === 0) {
      console.log(`  ${pc.yellow('→')} Create a ${pc.cyan('.env')} file with your secrets`);
      console.log(`  ${pc.yellow('→')} Run ${pc.cyan('keyway push')} to sync them\n`);
    } else {
      console.log(`  ${pc.yellow('→')} Run ${pc.cyan('keyway push')} to sync your secrets\n`);
    }

    console.log(`  ${pc.blue('⎔')} Dashboard: ${pc.underline(dashboardLink)}`);
    console.log('');

    await shutdownAnalytics();
  } catch (error) {
    // Handle specific error cases with friendly messages
    if (error instanceof APIError) {
      if (error.statusCode === 409) {
        console.log(pc.green('\n✓ Already initialized!\n'));
        console.log(`  ${pc.yellow('→')} Run ${pc.cyan('keyway push')} to sync your secrets`);
        console.log(`  ${pc.blue('⎔')} Dashboard: ${pc.underline(`${DASHBOARD_URL}/${getCurrentRepoFullName()}`)}`);
        console.log('');
        await shutdownAnalytics();
        return;
      }

      if (error.error === 'Plan Limit Reached' || error.upgradeUrl) {
        const upgradeUrl = error.upgradeUrl || 'https://keyway.sh/pricing';
        console.log('');
        console.log(pc.dim('─'.repeat(50)));
        console.log('');
        console.log(`  ${pc.yellow('⚡')} ${pc.bold('Plan Limit Reached')}`);
        console.log('');
        console.log(pc.white(`  ${error.message}`));
        console.log('');
        console.log(`  ${pc.cyan('Upgrade now →')} ${pc.underline(upgradeUrl)}`);
        console.log('');
        console.log(pc.dim('─'.repeat(50)));
        console.log('');
        await shutdownAnalytics();
        process.exit(1);
      }
    }

    const message = error instanceof APIError
      ? error.message
      : error instanceof Error
        ? truncateMessage(error.message)
        : 'Unknown error';

    trackEvent(AnalyticsEvents.CLI_ERROR, {
      command: 'init',
      error: message,
    });

    await shutdownAnalytics();

    console.error(pc.red(`\n✗ ${message}`));

    process.exit(1);
  }
}
