import pc from 'picocolors';
import fs from 'fs';
import path from 'path';
import prompts from 'prompts';
import { getCurrentRepoFullName } from '../utils/git.js';
import { APIError, pushSecrets, truncateMessage } from '../utils/api.js';
import { trackEvent, AnalyticsEvents, shutdownAnalytics } from '../utils/analytics.js';
import { ensureLogin } from './login.js';

export function deriveEnvFromFile(file: string): string {
  const base = path.basename(file);
  const match = base.match(/\.env(?:\.(.+))?$/);
  if (match) {
    return match[1] || 'development';
  }
  return 'development';
}

export function discoverEnvCandidates(cwd: string): { file: string; env: string }[] {
  try {
    const entries = fs.readdirSync(cwd);
    const hasEnvLocal = entries.includes('.env.local');
    if (hasEnvLocal) {
      console.log(pc.gray('ℹ️  Detected .env.local — not synced by design (machine-specific secrets)'));
    }

    const candidates = entries
      .filter((name) => name.startsWith('.env') && name !== '.env.local')
      .map((name) => {
        const fullPath = path.join(cwd, name);
        try {
          const stat = fs.statSync(fullPath);
          if (!stat.isFile()) return null;
          return { file: name, env: deriveEnvFromFile(name) };
        } catch {
          return null;
        }
      })
      .filter((c): c is { file: string; env: string } => Boolean(c));

    // Deduplicate by file name
    const seen = new Set<string>();
    const unique: { file: string; env: string }[] = [];
    for (const c of candidates) {
      if (seen.has(c.file)) continue;
      seen.add(c.file);
      unique.push(c);
    }
    return unique;
  } catch {
    return [];
  }
}

interface PushOptions {
  env?: string;
  file?: string;
  yes?: boolean;
  loginPrompt?: boolean;
}

export async function pushCommand(options: PushOptions) {
  try {
    console.log(pc.blue('🔐 Pushing secrets to Keyway...\n'));

    const isInteractive = process.stdin.isTTY && process.stdout.isTTY;
    let environment = options.env;
    let envFile = options.file;

    const candidates = discoverEnvCandidates(process.cwd());

    // If env provided but file not, try to match a discovered file
    if (environment && !envFile) {
      const match = candidates.find((c) => c.env === environment);
      if (match) {
        envFile = match.file;
      }
    }

    // If neither provided, prompt to pick from discovered files
    if (!environment && !envFile && isInteractive && candidates.length > 0) {
      const { choice } = await prompts(
        {
          type: 'select',
          name: 'choice',
          message: 'Select an env file to push:',
          choices: [
            ...candidates.map((c) => ({
              title: `${c.file} (env: ${c.env})`,
              value: c,
            })),
            { title: 'Enter a different file...', value: 'custom' },
          ],
        },
        {
          onCancel: () => {
            throw new Error('Push cancelled by user.');
          },
        }
      );

      if (choice && choice !== 'custom') {
        envFile = choice.file;
        environment = choice.env;
      } else if (choice === 'custom') {
        const { fileInput } = await prompts(
          {
            type: 'text',
            name: 'fileInput',
            message: 'Path to env file:',
            validate: (value: string) => {
              if (!value) return 'Path is required';
              const resolved = path.resolve(process.cwd(), value);
              if (!fs.existsSync(resolved)) return `File not found: ${value}`;
              return true;
            },
          },
          {
            onCancel: () => {
              throw new Error('Push cancelled by user.');
            },
          }
        );

        envFile = fileInput;
        environment = deriveEnvFromFile(fileInput);
      }
    }

    if (!environment) {
      environment = 'development';
    }

    if (!envFile) {
      envFile = '.env';
    }

    let envFilePath = path.resolve(process.cwd(), envFile);
    if (!fs.existsSync(envFilePath)) {
      if (!isInteractive) {
        throw new Error(`File not found: ${envFile}. Provide --file <path> or run interactively to choose a file.`);
      }

      const { newPath } = await prompts(
        {
          type: 'text',
          name: 'newPath',
          message: `File not found: ${envFile}. Enter an env file path to use:`,
          validate: (value: string) => {
            if (!value || typeof value !== 'string') return 'Path is required';
            const resolved = path.resolve(process.cwd(), value);
            if (!fs.existsSync(resolved)) return `File not found: ${value}`;
            return true;
          },
        },
        {
          onCancel: () => {
            throw new Error('Push cancelled (no env file provided).');
          },
        }
      );

      if (!newPath || typeof newPath !== 'string') {
        throw new Error('Push cancelled (no env file provided).');
      }

      envFile = newPath.trim();
      envFilePath = path.resolve(process.cwd(), envFile);
    }

    const content = fs.readFileSync(envFilePath, 'utf-8');

    if (content.trim().length === 0) {
      throw new Error(`File is empty: ${envFile}`);
    }

    const lines = content.split('\n').filter((line) => {
      const trimmed = line.trim();
      return trimmed.length > 0 && !trimmed.startsWith('#');
    });

    console.log(`File: ${pc.cyan(envFile)}`);
    console.log(`Environment: ${pc.cyan(environment)}`);
    console.log(`Variables: ${pc.cyan(lines.length.toString())}`);

    const repoFullName = getCurrentRepoFullName();
    console.log(`Repository: ${pc.cyan(repoFullName)}`);

    if (!options.yes) {
      const isInteractive = process.stdin.isTTY && process.stdout.isTTY;
      if (!isInteractive) {
        throw new Error('Confirmation required. Re-run with --yes in non-interactive environments.');
      }

      const { confirm } = await prompts(
        {
          type: 'confirm',
          name: 'confirm',
          message: `Send ${lines.length} secrets from ${envFile} (env: ${environment}) to ${repoFullName}?`,
          initial: true,
        },
        {
          onCancel: () => {
            throw new Error('Push cancelled by user.');
          },
        }
      );

      if (!confirm) {
        console.log(pc.yellow('Push aborted.'));
        return;
      }
    }

    const accessToken = await ensureLogin({ allowPrompt: options.loginPrompt !== false });

    trackEvent(AnalyticsEvents.CLI_PUSH, {
      repoFullName,
      environment,
      variableCount: lines.length,
    });

    console.log('\nUploading secrets...');
    const response = await pushSecrets(repoFullName, environment, content, accessToken);

    console.log(pc.green('\n✓ ' + response.message));

    if (response.stats) {
      const { created, updated, deleted } = response.stats;
      const parts: string[] = [];
      if (created > 0) parts.push(pc.green(`+${created} created`));
      if (updated > 0) parts.push(pc.yellow(`~${updated} updated`));
      if (deleted > 0) parts.push(pc.red(`-${deleted} deleted`));
      if (parts.length > 0) {
        console.log(`Stats: ${parts.join(', ')}`);
      }
    }

    console.log(`\nYour secrets are now encrypted and stored securely.`);
    console.log(`To retrieve them, run: ${pc.cyan(`keyway pull --env ${environment}`)}`);

    await shutdownAnalytics();
  } catch (error) {
    let message: string;
    let hint: string | null = null;

    if (error instanceof APIError) {
      // Use the full message, fallback to error code if empty
      message = error.message || `HTTP ${error.statusCode} - ${error.error}`;

      // Detect environment not found error and provide helpful hint
      const envNotFoundMatch = message.match(/Environment '([^']+)' does not exist.*Available environments: ([^.]+)/);
      if (envNotFoundMatch) {
        const requestedEnv = envNotFoundMatch[1];
        const availableEnvs = envNotFoundMatch[2];
        message = `Environment '${requestedEnv}' does not exist in this vault.`;
        hint = `Available environments: ${availableEnvs}\n` +
               `Use ${pc.cyan(`keyway push --env <environment>`)} to specify one, ` +
               `or create '${requestedEnv}' via the dashboard.`;
      }

      // Detect plan limit error (403 with upgradeUrl)
      if (error.statusCode === 403 && error.upgradeUrl) {
        hint = `${pc.yellow('⚡')} Upgrade to Pro: ${pc.cyan(error.upgradeUrl)}`;
      } else if (error.statusCode === 403 && message.toLowerCase().includes('read-only')) {
        message = 'This vault is read-only on your current plan.';
        hint = `Upgrade to Pro to unlock editing: ${pc.cyan('https://keyway.sh/settings')}`;
      }
    } else if (error instanceof Error) {
      message = truncateMessage(error.message);
    } else {
      message = 'Unknown error';
    }

    trackEvent(AnalyticsEvents.CLI_ERROR, {
      command: 'push',
      error: message,
    });

    await shutdownAnalytics();

    console.error(pc.red(`\n✗ ${message}`));
    if (hint) {
      console.error(pc.gray(`\n${hint}`));
    }

    process.exit(1);
  }
}
