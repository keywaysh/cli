import chalk from 'chalk';
import prompts from 'prompts';
import { getCurrentRepoFullName } from '../utils/git.js';
import { APIError, initVault } from '../utils/api.js';
import { trackEvent, AnalyticsEvents, shutdownAnalytics } from '../utils/analytics.js';
import { ensureLogin } from './login.js';
import { addBadgeToReadme } from './readme.js';
import { discoverEnvCandidates, pushCommand } from './push.js';

const DASHBOARD_URL = 'https://www.keyway.sh/dashboard/vaults';

interface InitOptions {
  loginPrompt?: boolean;
}

export async function initCommand(options: InitOptions = {}) {
  try {
    const repoFullName = getCurrentRepoFullName();
    const dashboardLink = `${DASHBOARD_URL}/${repoFullName}`;

    console.log(chalk.blue('🔐 Initializing Keyway vault...\n'));
    console.log(`  ${chalk.gray('Repository:')} ${chalk.white(repoFullName)}`);

    const accessToken = await ensureLogin({ allowPrompt: options.loginPrompt !== false });

    trackEvent(AnalyticsEvents.CLI_INIT, { repoFullName });

    const response = await initVault(repoFullName, accessToken);

    console.log(chalk.green('✓ Vault created!'));

    // Add badge to README
    try {
      await addBadgeToReadme();
      console.log(chalk.green('✓ Badge added to README.md'));
    } catch {
      // Silent fail for badge
    }
    console.log('');

    // Check for .env files
    const envCandidates = discoverEnvCandidates(process.cwd());
    const isInteractive = process.stdin.isTTY && process.stdout.isTTY;

    if (envCandidates.length > 0 && isInteractive) {
      console.log(chalk.gray(`  Found ${envCandidates.length} env file(s): ${envCandidates.map(c => c.file).join(', ')}\n`));

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
    console.log(chalk.dim('─'.repeat(50)));
    console.log('');

    if (envCandidates.length === 0) {
      console.log(`  ${chalk.yellow('→')} Create a ${chalk.cyan('.env')} file with your secrets`);
      console.log(`  ${chalk.yellow('→')} Run ${chalk.cyan('keyway push')} to sync them\n`);
    } else {
      console.log(`  ${chalk.yellow('→')} Run ${chalk.cyan('keyway push')} to sync your secrets\n`);
    }

    console.log(`  ${chalk.blue('⎔')} Dashboard: ${chalk.underline(dashboardLink)}`);
    console.log('');

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
