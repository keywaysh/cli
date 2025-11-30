import pc from 'picocolors';
import prompts from 'prompts';
import { getCurrentRepoFullName } from '../utils/git.js';
import { APIError, initVault, truncateMessage } from '../utils/api.js';
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

    console.log(pc.blue('🔐 Initializing Keyway vault...\n'));
    console.log(`  ${pc.gray('Repository:')} ${pc.white(repoFullName)}`);

    const accessToken = await ensureLogin({ allowPrompt: options.loginPrompt !== false });

    trackEvent(AnalyticsEvents.CLI_INIT, { repoFullName });

    const response = await initVault(repoFullName, accessToken);

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
        console.log(pc.yellow('\n⚠ Vault already exists for this repository.\n'));
        console.log(`  ${pc.yellow('→')} Run ${pc.cyan('keyway push')} to sync your secrets`);
        console.log(`  ${pc.blue('⎔')} Dashboard: ${pc.underline(`${DASHBOARD_URL}/${getCurrentRepoFullName()}`)}`);
        console.log('');
        await shutdownAnalytics();
        return;
      }

      if (error.error === 'PLAN_LIMIT_REACHED') {
        console.log('');
        console.log(pc.dim('─'.repeat(50)));
        console.log('');
        console.log(`  ${pc.yellow('⚡')} ${pc.bold('Upgrade Required')}`);
        console.log('');
        console.log(pc.gray(`  ${error.message}`));
        console.log('');
        console.log(`  ${pc.cyan('→')} ${pc.underline(error.upgradeUrl || 'https://keyway.sh/upgrade')}`);
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
