import pc from 'picocolors';
import prompts from 'prompts';
import {
  getConnections,
  getConnectionProjects,
  getSyncStatus,
  getSyncPreview,
  executeSync,
  truncateMessage,
  getVaultEnvironments,
} from '../utils/api.js';

/**
 * Map Keyway environment to Vercel environment
 */
export function mapToVercelEnvironment(keywayEnv: string): string {
  const mapping: Record<string, string> = {
    production: 'production',
    staging: 'preview',
    dev: 'development',
    development: 'development',
  };
  return mapping[keywayEnv.toLowerCase()] || 'production';
}
import { ensureLogin } from './login.js';
import { detectGitRepo } from '../utils/git.js';
import { trackEvent, AnalyticsEvents } from '../utils/analytics.js';

interface SyncOptions {
  push?: boolean;
  pull?: boolean;
  environment?: string;
  providerEnv?: string;
  project?: string;
  allowDelete?: boolean;
  yes?: boolean;
  loginPrompt?: boolean;
}

export interface ProjectWithLinkedRepo {
  id: string;
  name: string;
  linkedRepo?: string;
}

export interface ProjectMatch {
  project: ProjectWithLinkedRepo;
  matchType: 'linked_repo' | 'exact_name' | 'partial_name';
}

/**
 * Find matching provider project based on Git repo
 * Priority: 1) linkedRepo exact match, 2) exact name match, 3) partial name match
 */
export function findMatchingProject(
  projects: ProjectWithLinkedRepo[],
  repoFullName: string
): ProjectMatch | undefined {
  const repoFullNameLower = repoFullName.toLowerCase();
  const repoName = repoFullName.split('/')[1]?.toLowerCase();
  if (!repoName) return undefined;

  // Priority 1: Exact linkedRepo match (most reliable - the project is linked to this repo)
  const linkedMatch = projects.find(p =>
    p.linkedRepo?.toLowerCase() === repoFullNameLower
  );
  if (linkedMatch) {
    return { project: linkedMatch, matchType: 'linked_repo' };
  }

  // Priority 2: Exact name match
  const exactNameMatch = projects.find(p => p.name.toLowerCase() === repoName);
  if (exactNameMatch) {
    return { project: exactNameMatch, matchType: 'exact_name' };
  }

  // Priority 3: Partial match - only if UNIQUE result to avoid false positives
  const partialMatches = projects.filter(p =>
    p.name.toLowerCase().includes(repoName) ||
    repoName.includes(p.name.toLowerCase())
  );

  if (partialMatches.length === 1) {
    return { project: partialMatches[0], matchType: 'partial_name' };
  }

  return undefined;
}

/**
 * Check if a project matches the current repo
 */
export function projectMatchesRepo(
  project: ProjectWithLinkedRepo,
  repoFullName: string
): boolean {
  const repoFullNameLower = repoFullName.toLowerCase();
  const repoName = repoFullName.split('/')[1]?.toLowerCase();

  // linkedRepo match
  if (project.linkedRepo?.toLowerCase() === repoFullNameLower) {
    return true;
  }

  // Exact name match
  if (repoName && project.name.toLowerCase() === repoName) {
    return true;
  }

  return false;
}

/**
 * Prompt user to select a project from list
 */
async function promptProjectSelection(
  projects: ProjectWithLinkedRepo[],
  repoFullName: string
): Promise<ProjectWithLinkedRepo> {
  const repoName = repoFullName.split('/')[1]?.toLowerCase() || '';

  // Build choices with helpful labels
  const choices = projects.map(p => {
    let title = p.name;
    const badges: string[] = [];

    // Add badges for matching projects
    if (p.linkedRepo?.toLowerCase() === repoFullName.toLowerCase()) {
      badges.push(pc.green('← linked'));
    } else if (p.name.toLowerCase() === repoName) {
      badges.push(pc.green('← same name'));
    } else if (p.linkedRepo) {
      badges.push(pc.gray(`→ ${p.linkedRepo}`));
    }

    if (badges.length > 0) {
      title = `${p.name} ${badges.join(' ')}`;
    }

    return { title, value: p.id };
  });

  const { projectChoice } = await prompts({
    type: 'select',
    name: 'projectChoice',
    message: 'Select a project:',
    choices,
  });

  if (!projectChoice) {
    console.log(pc.gray('Cancelled.'));
    process.exit(0);
  }

  return projects.find(p => p.id === projectChoice)!;
}

/**
 * Sync secrets with a provider (Vercel, etc.)
 */
export async function syncCommand(provider: string, options: SyncOptions = {}) {
  try {
    // Validate incompatible options
    if (options.pull && options.allowDelete) {
      console.error(pc.red('Error: --allow-delete cannot be used with --pull'));
      console.log(pc.gray('The --allow-delete flag is only for push operations.'));
      process.exit(1);
    }

    const accessToken = await ensureLogin({ allowPrompt: options.loginPrompt !== false });

    // Detect current repo
    const repoFullName = detectGitRepo();
    if (!repoFullName) {
      console.error(pc.red('Could not detect Git repository.'));
      console.log(pc.gray('Run this command from a Git repository directory.'));
      process.exit(1);
    }

    console.log(pc.gray(`Repository: ${repoFullName}`));

    // Get provider connection
    const { connections } = await getConnections(accessToken);
    const connection = connections.find(c => c.provider === provider.toLowerCase());

    if (!connection) {
      console.error(pc.red(`Not connected to ${provider}.`));
      console.log(pc.gray(`Run: keyway connect ${provider}`));
      process.exit(1);
    }

    // Get provider projects
    const { projects } = await getConnectionProjects(accessToken, connection.id);

    if (projects.length === 0) {
      console.error(pc.red(`No projects found in your ${provider} account.`));
      process.exit(1);
    }

    // Select project
    let selectedProject: ProjectWithLinkedRepo;

    if (options.project) {
      // Use specified project
      const found = projects.find(p =>
        p.id === options.project || p.name.toLowerCase() === options.project?.toLowerCase()
      );
      if (!found) {
        console.error(pc.red(`Project not found: ${options.project}`));
        console.log(pc.gray('Available projects:'));
        projects.forEach(p => console.log(pc.gray(`  - ${p.name}`)));
        process.exit(1);
      }
      selectedProject = found;

      // Warn if manually specified project doesn't match repo
      if (!projectMatchesRepo(selectedProject, repoFullName)) {
        console.log('');
        console.log(pc.yellow('┌─────────────────────────────────────────────────────────────┐'));
        console.log(pc.yellow('│  ⚠️  WARNING: Project does not match current repository     │'));
        console.log(pc.yellow('└─────────────────────────────────────────────────────────────┘'));
        console.log(pc.yellow(`  Current repo:      ${repoFullName}`));
        console.log(pc.yellow(`  Selected project:  ${selectedProject.name}`));
        if (selectedProject.linkedRepo) {
          console.log(pc.yellow(`  Project linked to: ${selectedProject.linkedRepo}`));
        }
        console.log('');
      }
    } else {
      // Auto-detect or prompt
      const autoMatch = findMatchingProject(projects, repoFullName);

      if (autoMatch && (autoMatch.matchType === 'linked_repo' || autoMatch.matchType === 'exact_name')) {
        // Auto-select for strong matches (linked repo or exact name)
        selectedProject = autoMatch.project;
        const matchReason = autoMatch.matchType === 'linked_repo'
          ? `linked to ${repoFullName}`
          : 'exact name match';
        console.log(pc.green(`✓ Auto-selected project: ${selectedProject.name} (${matchReason})`));
      } else if (autoMatch && autoMatch.matchType === 'partial_name') {
        // Partial match - ask for confirmation
        console.log(pc.yellow(`Detected project: ${autoMatch.project.name} (partial match)`));
        const { useDetected } = await prompts({
          type: 'confirm',
          name: 'useDetected',
          message: `Use ${autoMatch.project.name}?`,
          initial: true,
        });

        if (useDetected) {
          selectedProject = autoMatch.project;
        } else {
          selectedProject = await promptProjectSelection(projects, repoFullName);
        }
      } else if (projects.length === 1) {
        // Only one project - use it but warn if it doesn't match
        selectedProject = projects[0];
        if (!projectMatchesRepo(selectedProject, repoFullName)) {
          console.log('');
          console.log(pc.yellow('┌─────────────────────────────────────────────────────────────┐'));
          console.log(pc.yellow('│  ⚠️  WARNING: Project does not match current repository     │'));
          console.log(pc.yellow('└─────────────────────────────────────────────────────────────┘'));
          console.log(pc.yellow(`  Current repo:      ${repoFullName}`));
          console.log(pc.yellow(`  Only project:      ${selectedProject.name}`));
          if (selectedProject.linkedRepo) {
            console.log(pc.yellow(`  Project linked to: ${selectedProject.linkedRepo}`));
          }
          console.log('');

          const { continueAnyway } = await prompts({
            type: 'confirm',
            name: 'continueAnyway',
            message: 'Continue anyway?',
            initial: false,
          });

          if (!continueAnyway) {
            console.log(pc.gray('Cancelled.'));
            process.exit(0);
          }
        }
      } else {
        // No match found - show list with warning
        console.log(pc.yellow(`\n⚠️  No matching project found for ${repoFullName}`));
        console.log(pc.gray('Select a project manually:\n'));
        selectedProject = await promptProjectSelection(projects, repoFullName);
      }
    }

    // Final warning if selected project doesn't match repo (from manual selection)
    if (!options.project && !projectMatchesRepo(selectedProject, repoFullName)) {
      const autoMatch = findMatchingProject(projects, repoFullName);
      // Only show warning if we didn't already show one (i.e., user manually selected from list)
      if (autoMatch && autoMatch.project.id !== selectedProject.id) {
        console.log('');
        console.log(pc.yellow('┌─────────────────────────────────────────────────────────────┐'));
        console.log(pc.yellow('│  ⚠️  WARNING: You selected a different project              │'));
        console.log(pc.yellow('└─────────────────────────────────────────────────────────────┘'));
        console.log(pc.yellow(`  Current repo:      ${repoFullName}`));
        console.log(pc.yellow(`  Selected project:  ${selectedProject.name}`));
        if (selectedProject.linkedRepo) {
          console.log(pc.yellow(`  Project linked to: ${selectedProject.linkedRepo}`));
        }
        console.log('');

        const { continueAnyway } = await prompts({
          type: 'confirm',
          name: 'continueAnyway',
          message: 'Are you sure you want to sync with this project?',
          initial: false,
        });

        if (!continueAnyway) {
          console.log(pc.gray('Cancelled.'));
          process.exit(0);
        }
      }
    }

    const providerName = provider.charAt(0).toUpperCase() + provider.slice(1);

    // Determine values from options or prompt
    let keywayEnv = options.environment;
    let providerEnv = options.providerEnv;
    let direction: 'push' | 'pull' | undefined = options.push ? 'push' : options.pull ? 'pull' : undefined;

    const needsEnvPrompt = !options.environment;
    const needsDirectionPrompt = !direction;

    if (needsEnvPrompt || needsDirectionPrompt) {
      // Prompt for environment if not specified
      if (needsEnvPrompt) {
        const vaultEnvs = await getVaultEnvironments(accessToken, repoFullName);

        const { selectedEnv } = await prompts({
          type: 'select',
          name: 'selectedEnv',
          message: 'Keyway environment:',
          choices: vaultEnvs.map(e => ({ title: e, value: e })),
          initial: Math.max(0, vaultEnvs.indexOf('production')),
        });

        if (!selectedEnv) {
          console.log(pc.gray('Cancelled.'));
          process.exit(0);
        }

        keywayEnv = selectedEnv;

        // Auto-map to provider environment
        if (!options.providerEnv) {
          providerEnv = mapToVercelEnvironment(keywayEnv);
        }
      }

      // Prompt for direction if not specified
      if (needsDirectionPrompt) {
        const { selectedDirection } = await prompts({
          type: 'select',
          name: 'selectedDirection',
          message: 'Sync direction:',
          choices: [
            { title: `Keyway → ${providerName}`, value: 'push' },
            { title: `${providerName} → Keyway`, value: 'pull' },
          ],
        });

        if (!selectedDirection) {
          console.log(pc.gray('Cancelled.'));
          process.exit(0);
        }

        direction = selectedDirection;
      }
    }

    // Apply defaults
    keywayEnv = keywayEnv || 'production';
    providerEnv = providerEnv || 'production';
    direction = direction || 'push';

    // First-time detection
    const status = await getSyncStatus(
      accessToken,
      repoFullName,
      connection.id,
      selectedProject.id,
      keywayEnv
    );

    if (status.isFirstSync && direction === 'push' && status.vaultIsEmpty && status.providerHasSecrets) {
      console.log(pc.yellow(`\n⚠️  Your Keyway vault is empty for "${keywayEnv}", but ${providerName} has ${status.providerSecretCount} secrets.`));
      console.log(pc.gray(`   (Use --environment to sync a different environment)`));

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
    console.error(pc.red(`\n✗ ${message}`));
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
    console.log(pc.green('\n✓ Already in sync. No changes needed.'));
    return;
  }

  // Show preview
  console.log(pc.blue('\n📋 Sync Preview\n'));

  if (preview.toCreate.length > 0) {
    console.log(pc.green(`  + ${preview.toCreate.length} to create`));
    preview.toCreate.slice(0, 5).forEach(key => console.log(pc.gray(`    ${key}`)));
    if (preview.toCreate.length > 5) {
      console.log(pc.gray(`    ... and ${preview.toCreate.length - 5} more`));
    }
  }

  if (preview.toUpdate.length > 0) {
    console.log(pc.yellow(`  ~ ${preview.toUpdate.length} to update`));
    preview.toUpdate.slice(0, 5).forEach(key => console.log(pc.gray(`    ${key}`)));
    if (preview.toUpdate.length > 5) {
      console.log(pc.gray(`    ... and ${preview.toUpdate.length - 5} more`));
    }
  }

  if (preview.toDelete.length > 0) {
    console.log(pc.red(`  - ${preview.toDelete.length} to delete`));
    preview.toDelete.slice(0, 5).forEach(key => console.log(pc.gray(`    ${key}`)));
    if (preview.toDelete.length > 5) {
      console.log(pc.gray(`    ... and ${preview.toDelete.length - 5} more`));
    }
  }

  if (preview.toSkip.length > 0) {
    console.log(pc.gray(`  ○ ${preview.toSkip.length} unchanged`));
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
      console.log(pc.gray('Cancelled.'));
      return;
    }
  }

  // Execute
  console.log(pc.blue('\n⏳ Syncing...\n'));

  const result = await executeSync(accessToken, repoFullName, {
    connectionId,
    projectId: project.id,
    keywayEnvironment: keywayEnv,
    providerEnvironment: providerEnv,
    direction,
    allowDelete,
  });

  if (result.success) {
    console.log(pc.green('✓ Sync complete'));
    console.log(pc.gray(`  Created: ${result.stats.created}`));
    console.log(pc.gray(`  Updated: ${result.stats.updated}`));
    if (result.stats.deleted > 0) {
      console.log(pc.gray(`  Deleted: ${result.stats.deleted}`));
    }

    trackEvent(AnalyticsEvents.CLI_SYNC, {
      provider,
      direction,
      created: result.stats.created,
      updated: result.stats.updated,
      deleted: result.stats.deleted,
    });
  } else {
    console.error(pc.red(`\n✗ ${result.error}`));
    process.exit(1);
  }
}
