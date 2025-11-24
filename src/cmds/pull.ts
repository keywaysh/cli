import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import prompts from 'prompts';
import { getCurrentRepoFullName } from '../utils/git.js';
import { APIError, pullSecrets } from '../utils/api.js';
import { trackEvent, AnalyticsEvents, shutdownAnalytics } from '../utils/analytics.js';
import { ensureLogin } from './login.js';

interface PullOptions {
  env?: string;
  file?: string;
  yes?: boolean;
  loginPrompt?: boolean;
}

export async function pullCommand(options: PullOptions) {
  try {
    const environment = options.env || 'development';
    const envFile = options.file || '.env';

    console.log(chalk.blue('🔐 Pulling secrets from Keyway...\n'));

    console.log(`Environment: ${chalk.cyan(environment)}`);

    const repoFullName = getCurrentRepoFullName();
    console.log(`Repository: ${chalk.cyan(repoFullName)}`);

    const accessToken = await ensureLogin({ allowPrompt: options.loginPrompt !== false });

    trackEvent(AnalyticsEvents.CLI_PULL, {
      repoFullName,
      environment,
    });

    console.log('\nDownloading secrets...');
    const response = await pullSecrets(repoFullName, environment, accessToken);

    const envFilePath = path.resolve(process.cwd(), envFile);
    if (fs.existsSync(envFilePath)) {
      const isInteractive = process.stdin.isTTY && process.stdout.isTTY;
      if (options.yes) {
        console.log(chalk.yellow(`\n⚠ Overwriting existing file: ${envFile}`));
      } else if (!isInteractive) {
        throw new Error(`File ${envFile} exists. Re-run with --yes to overwrite or choose a different --file.`);
      } else {
        const { confirm } = await prompts(
          {
            type: 'confirm',
            name: 'confirm',
            message: `${envFile} exists. Overwrite with secrets from ${environment}?`,
            initial: false,
          },
          {
            onCancel: () => {
              throw new Error('Pull cancelled by user.');
            },
          }
        );

        if (!confirm) {
          console.log(chalk.yellow('Pull aborted.'));
          return;
        }
      }
    }

    fs.writeFileSync(envFilePath, response.content, 'utf-8');

    const lines = response.content.split('\n').filter((line) => {
      const trimmed = line.trim();
      return trimmed.length > 0 && !trimmed.startsWith('#');
    });

    console.log(chalk.green(`\n✓ Secrets downloaded successfully`));
    console.log(`\nFile: ${chalk.cyan(envFile)}`);
    console.log(`Variables: ${chalk.cyan(lines.length.toString())}`);

    await shutdownAnalytics();
  } catch (error) {
    const message = error instanceof APIError
      ? `API ${error.statusCode}: ${error.message}`
      : error instanceof Error
        ? error.message.slice(0, 200)
        : 'Unknown error';

    trackEvent(AnalyticsEvents.CLI_ERROR, {
      command: 'pull',
      error: message,
    });

    await shutdownAnalytics();

    console.error(chalk.red(`\n✗ Error: ${message}`));

    process.exit(1);
  }
}
