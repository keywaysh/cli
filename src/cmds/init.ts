import pc from 'picocolors';
import prompts from 'prompts';
import { getCurrentRepoFullName } from '../utils/git.js';
import { APIError, initVault, truncateMessage, checkGitHubAppInstallation, checkVaultExists } from '../utils/api.js';
import { trackEvent, AnalyticsEvents, shutdownAnalytics, identifyUser } from '../utils/analytics.js';
import { addBadgeToReadme } from './readme.js';
import { discoverEnvCandidates, pushCommand } from './push.js';
import { getStoredAuth, saveAuthToken } from '../utils/auth.js';
import { pollDeviceLogin, startDeviceLogin } from '../utils/api.js';
import { sleep, isInteractive, MAX_CONSECUTIVE_ERRORS, openUrl, showUpgradePrompt } from '../utils/helpers.js';

const DASHBOARD_URL = 'https://www.keyway.sh/dashboard/vaults';
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 120000; // 2 minutes

interface InitOptions {
  loginPrompt?: boolean;
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

  // User is NOT logged in
  const allowPrompt = options.allowPrompt !== false;
  if (!allowPrompt || !isInteractive()) {
    throw new Error('No Keyway session found. Run "keyway login" to authenticate.');
  }

  // Start device flow
  const deviceStart = await startDeviceLogin(repoFullName);
  const installUrl = deviceStart.githubAppInstallUrl || 'https://github.com/apps/keyway/installations/new';

  // Prompt user
  console.log('');
  const { shouldProceed } = await prompts({
    type: 'confirm',
    name: 'shouldProceed',
    message: 'Open browser to sign in?',
    initial: true,
  });

  if (!shouldProceed) {
    throw new Error('Setup required. Run "keyway init" when ready.');
  }

  // ALWAYS use verification URL for auth (device flow standard)
  await openUrl(deviceStart.verificationUriComplete);
  console.log(pc.blue('⏳ Waiting for authorization...'));
  console.log(pc.gray('   (Press Ctrl+C to cancel)\n'));

  // STEP 1: Poll for login
  const pollIntervalMs = Math.max((deviceStart.interval ?? 5) * 1000, POLL_INTERVAL_MS);
  const startTime = Date.now();
  let accessToken: string | null = null;
  let consecutiveErrors = 0;

  while (Date.now() - startTime < POLL_TIMEOUT_MS) {
    await sleep(pollIntervalMs);

    try {
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
            login_method: 'device_flow',
          });
        }
        break;
      }
      consecutiveErrors = 0;
      process.stdout.write(pc.gray('.'));
    } catch (error) {
      consecutiveErrors++;
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        throw new Error(`Login failed after ${MAX_CONSECUTIVE_ERRORS} consecutive errors: ${errorMsg}`);
      }
    }
  }

  if (!accessToken) {
    console.log('');
    console.log(pc.yellow('⚠ Timed out waiting for sign in.'));
    throw new Error('Sign in timed out. Please try again.');
  }

  // STEP 2: Check installation now that we're authenticated
  const installStatus = await checkGitHubAppInstallation(repoOwner, repoName, accessToken);
  if (installStatus.installed) {
    console.log(pc.green('✓ GitHub App installed'));
    console.log('');
    return accessToken;
  }

  // App not installed - ask user to install
  console.log('');
  console.log(pc.yellow('⚠ GitHub App not installed on this repository'));
  console.log(pc.gray('  The Keyway GitHub App is required for secure access.'));
  console.log('');

  const { shouldInstall } = await prompts({
    type: 'confirm',
    name: 'shouldInstall',
    message: 'Open browser to install GitHub App?',
    initial: true,
  });

  if (!shouldInstall) {
    console.log(pc.gray(`\n  Install later: ${installUrl}`));
    throw new Error('GitHub App installation required.');
  }

  // Open installation page
  await openUrl(installUrl);
  console.log(pc.blue('⏳ Waiting for GitHub App installation...'));
  console.log(pc.gray('   Add this repository and click "Install"'));
  console.log(pc.gray('   Then return here - the CLI will detect it automatically'));
  console.log(pc.gray('   (Press Ctrl+C to cancel)\n'));

  // STEP 3: Poll for installation
  const installStartTime = Date.now();
  consecutiveErrors = 0;

  while (Date.now() - installStartTime < POLL_TIMEOUT_MS) {
    await sleep(POLL_INTERVAL_MS);

    try {
      const pollStatus = await checkGitHubAppInstallation(repoOwner, repoName, accessToken);
      if (pollStatus.installed) {
        console.log(pc.green('✓ GitHub App installed!'));
        console.log('');
        return accessToken;
      }
      consecutiveErrors = 0;
      process.stdout.write(pc.gray('.'));
    } catch (error) {
      consecutiveErrors++;
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        throw new Error(`Installation check failed after ${MAX_CONSECUTIVE_ERRORS} consecutive errors: ${errorMsg}`);
      }
    }
  }

  // Timeout
  console.log('');
  console.log(pc.yellow('⚠ Timed out waiting for installation.'));
  console.log(pc.gray(`  Install the GitHub App: ${installUrl}`));
  throw new Error('GitHub App installation timed out.');
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
  await openUrl(status.installUrl);
  console.log(pc.blue('⏳ Waiting for GitHub App installation...'));
  console.log(pc.gray('   (Press Ctrl+C to cancel)\n'));

  // Poll for installation
  const startTime = Date.now();
  let consecutiveErrors = 0;

  while (Date.now() - startTime < POLL_TIMEOUT_MS) {
    await sleep(POLL_INTERVAL_MS);

    try {
      const pollStatus = await checkGitHubAppInstallation(repoOwner, repoName, accessToken);
      if (pollStatus.installed) {
        console.log(pc.green('✓ GitHub App installed!'));
        console.log('');
        return accessToken;
      }
      consecutiveErrors = 0; // Reset on successful API call
      process.stdout.write(pc.gray('.'));
    } catch (error) {
      consecutiveErrors++;
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        throw new Error(`Installation check failed after ${MAX_CONSECUTIVE_ERRORS} consecutive errors: ${errorMsg}`);
      }
      // Continue polling on transient errors
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
      console.log(`${pc.yellow('⚠')} No .env file found - your vault is empty`);
      console.log(`  Next: Create ${pc.cyan('.env')} and run ${pc.cyan('keyway push')}\n`);
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
        showUpgradePrompt(error.message, upgradeUrl);
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
