import chalk from 'chalk';
import prompts from 'prompts';
import {
  getConnections,
  getConnectionProjects,
  getSyncStatus,
  getSyncPreview,
  executeSync,
  truncateMessage,
} from '../utils/api.js';
import { ensureLogin } from './login.js';
import { detectGitRepo } from '../utils/git.js';
import { trackEvent, AnalyticsEvents } from '../utils/analytics.js';

interface SyncOptions {
  pull?: boolean;
  environment?: string;
  providerEnv?: string;
  project?: string;
  allowDelete?: boolean;
  yes?: boolean;
  loginPrompt?: boolean;
}

/**
 * Find matching Vercel project based on Git repo name
 * Uses strict matching to prevent syncing to wrong project
 */
function findMatchingProject(
  projects: Array<{ id: string; name: string }>,
  repoFullName: string
): { id: string; name: string } | undefined {
  const repoName = repoFullName.split('/')[1]?.toLowerCase();
  if (!repoName) return undefined;

  // Exact match first (most reliable)
  const exact = projects.find(p => p.name.toLowerCase() === repoName);
  if (exact) return exact;

  // Partial match: only if UNIQUE result to avoid false positives
  const partial = projects.filter(p =>
    p.name.toLowerCase().includes(repoName) ||
    repoName.includes(p.name.toLowerCase())
  );

  // Only return if exactly one match to avoid syncing to wrong project
  return partial.length === 1 ? partial[0] : undefined;
}

/**
 * Sync secrets with a provider (Vercel, etc.)
 */
export async function syncCommand(provider: string, options: SyncOptions = {}) {
  try {
    // Validate incompatible options
    if (options.pull && options.allowDelete) {
      console.error(chalk.red('Error: --allow-delete cannot be used with --pull'));
      console.log(chalk.gray('The --allow-delete flag is only for push operations.'));
      process.exit(1);
    }

    const accessToken = await ensureLogin({ allowPrompt: options.loginPrompt !== false });

    // Detect current repo
    const repoFullName = detectGitRepo();
    if (!repoFullName) {
      console.error(chalk.red('Could not detect Git repository.'));
      console.log(chalk.gray('Run this command from a Git repository directory.'));
      process.exit(1);
    }

    console.log(chalk.gray(`Repository: ${repoFullName}`));

    // Get provider connection
    const { connections } = await getConnections(accessToken);
    const connection = connections.find(c => c.provider === provider.toLowerCase());

    if (!connection) {
      console.error(chalk.red(`Not connected to ${provider}.`));
      console.log(chalk.gray(`Run: keyway connect ${provider}`));
      process.exit(1);
    }

    // Get provider projects
    const { projects } = await getConnectionProjects(accessToken, connection.id);

    if (projects.length === 0) {
      console.error(chalk.red(`No projects found in your ${provider} account.`));
      process.exit(1);
    }

    // Select project
    let selectedProject: { id: string; name: string };

    if (options.project) {
      // Use specified project
      const found = projects.find(p =>
        p.id === options.project || p.name.toLowerCase() === options.project?.toLowerCase()
      );
      if (!found) {
        console.error(chalk.red(`Project not found: ${options.project}`));
        console.log(chalk.gray('Available projects:'));
        projects.forEach(p => console.log(chalk.gray(`  - ${p.name}`)));
        process.exit(1);
      }
      selectedProject = found;
    } else {
      // Auto-detect or prompt
      const autoMatch = findMatchingProject(projects, repoFullName);

      if (autoMatch && projects.length > 1) {
        console.log(chalk.gray(`Detected project: ${autoMatch.name}`));
        const { useDetected } = await prompts({
          type: 'confirm',
          name: 'useDetected',
          message: `Use ${autoMatch.name}?`,
          initial: true,
        });

        if (useDetected) {
          selectedProject = autoMatch;
        } else {
          const { projectChoice } = await prompts({
            type: 'select',
            name: 'projectChoice',
            message: 'Select a project:',
            choices: projects.map(p => ({ title: p.name, value: p.id })),
          });
          selectedProject = projects.find(p => p.id === projectChoice)!;
        }
      } else if (autoMatch) {
        selectedProject = autoMatch;
      } else if (projects.length === 1) {
        selectedProject = projects[0];
      } else {
        const { projectChoice } = await prompts({
          type: 'select',
          name: 'projectChoice',
          message: 'Select a project:',
          choices: projects.map(p => ({ title: p.name, value: p.id })),
        });

        if (!projectChoice) {
          console.log(chalk.gray('Cancelled.'));
          process.exit(0);
        }

        selectedProject = projects.find(p => p.id === projectChoice)!;
      }
    }

    const keywayEnv = options.environment || 'production';
    const providerEnv = options.providerEnv || 'production';
    const direction = options.pull ? 'pull' : 'push';
    const providerName = provider.charAt(0).toUpperCase() + provider.slice(1);

    console.log(chalk.gray(`Project: ${selectedProject.name}`));
    console.log(chalk.gray(`Direction: ${direction === 'push' ? 'Keyway → ' + providerName : providerName + ' → Keyway'}`));

    // First-time detection
    const status = await getSyncStatus(
      accessToken,
      repoFullName,
      connection.id,
      selectedProject.id,
      keywayEnv
    );

    if (status.isFirstSync && !options.pull && status.vaultIsEmpty && status.providerHasSecrets) {
      console.log(chalk.yellow(`\n⚠️  Your Keyway vault is empty, but ${providerName} has ${status.providerSecretCount} secrets.`));

      const { importFirst } = await prompts({
        type: 'confirm',
        name: 'importFirst',
        message: `Import secrets from ${providerName} first?`,
        initial: true,
      });

      if (importFirst) {
        // Switch to pull mode
        await executeSyncOperation(
          accessToken,
          repoFullName,
          connection.id,
          selectedProject,
          keywayEnv,
          providerEnv,
          'pull',
          false, // Never delete on import
          options.yes || false,
          provider
        );
        return;
      }
    }

    // Execute sync
    await executeSyncOperation(
      accessToken,
      repoFullName,
      connection.id,
      selectedProject,
      keywayEnv,
      providerEnv,
      direction,
      options.allowDelete || false,
      options.yes || false,
      provider
    );

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Sync failed';
    trackEvent(AnalyticsEvents.CLI_ERROR, {
      command: 'sync',
      error: truncateMessage(message),
    });
    console.error(chalk.red(`\n✗ ${message}`));
    process.exit(1);
  }
}

async function executeSyncOperation(
  accessToken: string,
  repoFullName: string,
  connectionId: string,
  project: { id: string; name: string },
  keywayEnv: string,
  providerEnv: string,
  direction: 'push' | 'pull',
  allowDelete: boolean,
  skipConfirm: boolean,
  provider: string
) {
  const providerName = provider.charAt(0).toUpperCase() + provider.slice(1);

  // Get preview
  const preview = await getSyncPreview(accessToken, repoFullName, {
    connectionId,
    projectId: project.id,
    keywayEnvironment: keywayEnv,
    providerEnvironment: providerEnv,
    direction,
    allowDelete,
  });

  const totalChanges = preview.toCreate.length + preview.toUpdate.length + preview.toDelete.length;

  if (totalChanges === 0) {
    console.log(chalk.green('\n✓ Already in sync. No changes needed.'));
    return;
  }

  // Show preview
  console.log(chalk.blue('\n📋 Sync Preview\n'));

  if (preview.toCreate.length > 0) {
    console.log(chalk.green(`  + ${preview.toCreate.length} to create`));
    preview.toCreate.slice(0, 5).forEach(key => console.log(chalk.gray(`    ${key}`)));
    if (preview.toCreate.length > 5) {
      console.log(chalk.gray(`    ... and ${preview.toCreate.length - 5} more`));
    }
  }

  if (preview.toUpdate.length > 0) {
    console.log(chalk.yellow(`  ~ ${preview.toUpdate.length} to update`));
    preview.toUpdate.slice(0, 5).forEach(key => console.log(chalk.gray(`    ${key}`)));
    if (preview.toUpdate.length > 5) {
      console.log(chalk.gray(`    ... and ${preview.toUpdate.length - 5} more`));
    }
  }

  if (preview.toDelete.length > 0) {
    console.log(chalk.red(`  - ${preview.toDelete.length} to delete`));
    preview.toDelete.slice(0, 5).forEach(key => console.log(chalk.gray(`    ${key}`)));
    if (preview.toDelete.length > 5) {
      console.log(chalk.gray(`    ... and ${preview.toDelete.length - 5} more`));
    }
  }

  if (preview.toSkip.length > 0) {
    console.log(chalk.gray(`  ○ ${preview.toSkip.length} unchanged`));
  }

  console.log('');

  // Confirm
  if (!skipConfirm) {
    const target = direction === 'push' ? providerName : 'Keyway';
    const { confirm } = await prompts({
      type: 'confirm',
      name: 'confirm',
      message: `Apply ${totalChanges} changes to ${target}?`,
      initial: true,
    });

    if (!confirm) {
      console.log(chalk.gray('Cancelled.'));
      return;
    }
  }

  // Execute
  console.log(chalk.blue('\n⏳ Syncing...\n'));

  const result = await executeSync(accessToken, repoFullName, {
    connectionId,
    projectId: project.id,
    keywayEnvironment: keywayEnv,
    providerEnvironment: providerEnv,
    direction,
    allowDelete,
  });

  if (result.success) {
    console.log(chalk.green('✓ Sync complete'));
    console.log(chalk.gray(`  Created: ${result.stats.created}`));
    console.log(chalk.gray(`  Updated: ${result.stats.updated}`));
    if (result.stats.deleted > 0) {
      console.log(chalk.gray(`  Deleted: ${result.stats.deleted}`));
    }

    trackEvent(AnalyticsEvents.CLI_SYNC, {
      provider,
      direction,
      created: result.stats.created,
      updated: result.stats.updated,
      deleted: result.stats.deleted,
    });
  } else {
    console.error(chalk.red(`\n✗ ${result.error}`));
    process.exit(1);
  }
}
