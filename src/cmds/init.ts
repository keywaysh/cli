import chalk from 'chalk';
import { getCurrentRepoFullName } from '../utils/git.js';
import { APIError, initVault } from '../utils/api.js';
import { trackEvent, AnalyticsEvents, shutdownAnalytics } from '../utils/analytics.js';
import { ensureLogin } from './login.js';
import { addBadgeToReadme } from './readme.js';

interface InitOptions {
  loginPrompt?: boolean;
}

export async function initCommand(options: InitOptions = {}) {
  try {
    console.log(chalk.blue('🔐 Initializing Keyway vault...\n'));

    const repoFullName = getCurrentRepoFullName();
    console.log(`Repository: ${chalk.cyan(repoFullName)}`);

    const accessToken = await ensureLogin({ allowPrompt: options.loginPrompt !== false });

    trackEvent(AnalyticsEvents.CLI_INIT, { repoFullName });

    console.log('\nInitializing vault...');
    const response = await initVault(repoFullName, accessToken);

    console.log(chalk.green('\n✓ ' + response.message));
    console.log(`\nVault ID: ${chalk.gray(response.vaultId)}`);
    console.log('\nNext steps:');
    console.log(`  1. Create a ${chalk.cyan('.env')} file with your secrets`);
    console.log(`  2. Run ${chalk.cyan('keyway push')} to upload your secrets`);

    try {
      await addBadgeToReadme();
    } catch (badgeError) {
      console.log(chalk.yellow('Badge insertion skipped:'), badgeError instanceof Error ? badgeError.message : String(badgeError));
    }

    await shutdownAnalytics();
  } catch (error) {
    const message = error instanceof APIError
      ? `API ${error.statusCode}: ${error.message}`
      : error instanceof Error
        ? error.message.slice(0, 200)
        : 'Unknown error';

    trackEvent(AnalyticsEvents.CLI_ERROR, {
      command: 'init',
      error: message,
    });

    await shutdownAnalytics();

    console.error(chalk.red(`\n✗ Error: ${message}`));

    process.exit(1);
  }
}
