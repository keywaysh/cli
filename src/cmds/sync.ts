import pc from 'picocolors';
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
import {
  buildSyncPlan,
  printSyncPlan,
  confirmSync,
  handleFirstSync,
  printSyncResult,
  printAlreadyInSync,
  resolveEnvironmentMapping,
  type SyncDirection,
} from '../utils/sync-helpers.js';

interface SyncOptions {
  pull?: boolean;
  env?: string;         // Changed from 'environment'
  environment?: string; // Keep for backwards compatibility
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
 * Select project with auto-detection and warnings
 */
async function selectProject(
  projects: ProjectWithLinkedRepo[],
  repoFullName: string,
  specifiedProject?: string
): Promise<ProjectWithLinkedRepo> {
  if (specifiedProject) {
    // Use specified project
    const found = projects.find(p =>
      p.id === specifiedProject || p.name.toLowerCase() === specifiedProject.toLowerCase()
    );
    if (!found) {
      console.error(pc.red(`Project not found: ${specifiedProject}`));
      console.log(pc.gray('Available projects:'));
      projects.forEach(p => console.log(pc.gray(`  - ${p.name}`)));
      process.exit(1);
    }

    // Warn if manually specified project doesn't match repo
    if (!projectMatchesRepo(found, repoFullName)) {
      console.log('');
      console.log(pc.yellow('┌─────────────────────────────────────────────────────────────┐'));
      console.log(pc.yellow('│  ⚠️  WARNING: Project does not match current repository     │'));
      console.log(pc.yellow('└─────────────────────────────────────────────────────────────┘'));
      console.log(pc.yellow(`  Current repo:      ${repoFullName}`));
      console.log(pc.yellow(`  Selected project:  ${found.name}`));
      if (found.linkedRepo) {
        console.log(pc.yellow(`  Project linked to: ${found.linkedRepo}`));
      }
      console.log('');
    }

    return found;
  }

  // Auto-detect or prompt
  const autoMatch = findMatchingProject(projects, repoFullName);

  if (autoMatch && (autoMatch.matchType === 'linked_repo' || autoMatch.matchType === 'exact_name')) {
    // Auto-select for strong matches (linked repo or exact name)
    const matchReason = autoMatch.matchType === 'linked_repo'
      ? `linked to ${repoFullName}`
      : 'exact name match';
    console.log(pc.green(`✓ Auto-selected project: ${autoMatch.project.name} (${matchReason})`));
    return autoMatch.project;
  }

  if (autoMatch && autoMatch.matchType === 'partial_name') {
    // Partial match - ask for confirmation
    console.log(pc.yellow(`Detected project: ${autoMatch.project.name} (partial match)`));
    const { useDetected } = await prompts({
      type: 'confirm',
      name: 'useDetected',
      message: `Use ${autoMatch.project.name}?`,
      initial: true,
    });

    if (useDetected) {
      return autoMatch.project;
    }
    return promptProjectSelection(projects, repoFullName);
  }

  if (projects.length === 1) {
    // Only one project - use it but warn if it doesn't match
    const project = projects[0];
    if (!projectMatchesRepo(project, repoFullName)) {
      console.log('');
      console.log(pc.yellow('┌─────────────────────────────────────────────────────────────┐'));
      console.log(pc.yellow('│  ⚠️  WARNING: Project does not match current repository     │'));
      console.log(pc.yellow('└─────────────────────────────────────────────────────────────┘'));
      console.log(pc.yellow(`  Current repo:      ${repoFullName}`));
      console.log(pc.yellow(`  Only project:      ${project.name}`));
      if (project.linkedRepo) {
        console.log(pc.yellow(`  Project linked to: ${project.linkedRepo}`));
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
    return project;
  }

  // No match found - show list with warning
  console.log(pc.yellow(`\n⚠️  No matching project found for ${repoFullName}`));
  console.log(pc.gray('Select a project manually:\n'));
  return promptProjectSelection(projects, repoFullName);
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

    // 1. Auth + repo detection
    const accessToken = await ensureLogin({ allowPrompt: options.loginPrompt !== false });

    const repoFullName = detectGitRepo();
    if (!repoFullName) {
      console.error(pc.red('Could not detect Git repository.'));
      console.log(pc.gray('Run this command from a Git repository directory.'));
      process.exit(1);
    }

    console.log(pc.gray(`Repository: ${repoFullName}`));

    // 2. Provider connection
    const { connections } = await getConnections(accessToken);
    const connection = connections.find(c => c.provider === provider.toLowerCase());

    if (!connection) {
      console.error(pc.red(`Not connected to ${provider}.`));
      console.log(pc.gray(`Run: keyway connect ${provider}`));
      process.exit(1);
    }

    // 3. Get projects and select one
    const { projects } = await getConnectionProjects(accessToken, connection.id);

    if (projects.length === 0) {
      console.error(pc.red(`No projects found in your ${provider} account.`));
      process.exit(1);
    }

    const selectedProject = await selectProject(projects, repoFullName, options.project);

    // 4. Environment mapping
    const keywayEnv = options.env || options.environment || 'production';
    const providerEnv = await resolveEnvironmentMapping(keywayEnv, provider, options.yes);

    if (!providerEnv) {
      console.log(pc.gray('Cancelled.'));
      process.exit(0);
    }

    // 5. Get sync status for first-time detection
    const status = await getSyncStatus(
      accessToken,
      repoFullName,
      connection.id,
      selectedProject.id,
      keywayEnv
    );

    // 6. Determine direction (handle first-time sync)
    let direction: SyncDirection = options.pull ? 'pull' : 'push';

    if (status.isFirstSync && !options.pull && status.vaultIsEmpty && status.providerHasSecrets) {
      const choice = await handleFirstSync(status.providerSecretCount, provider);
      if (choice.cancelled) {
        console.log(pc.gray('Cancelled.'));
        process.exit(0);
      }
      direction = choice.direction;
    }

    // 7. Get preview
    const preview = await getSyncPreview(accessToken, repoFullName, {
      connectionId: connection.id,
      projectId: selectedProject.id,
      keywayEnvironment: keywayEnv,
      providerEnvironment: providerEnv,
      direction,
      allowDelete: options.allowDelete || false,
    });

    const totalChanges = preview.toCreate.length + preview.toUpdate.length + preview.toDelete.length;

    if (totalChanges === 0) {
      printAlreadyInSync();
      return;
    }

    // 8. Build and print sync plan
    const vaultSecretCount = direction === 'push'
      ? preview.toCreate.length + preview.toUpdate.length + preview.toSkip.length
      : status.providerSecretCount - preview.toCreate.length;

    const plan = buildSyncPlan({
      repoFullName,
      projectName: selectedProject.name,
      provider,
      direction,
      keywayEnv,
      providerEnv,
      vaultSecretCount: direction === 'push' ? vaultSecretCount : (status.vaultIsEmpty ? 0 : vaultSecretCount),
      providerSecretCount: status.providerSecretCount,
      changes: preview,
      isFirstSync: status.isFirstSync,
    });

    printSyncPlan(plan);

    // 9. Confirm
    if (!await confirmSync(plan, options.yes || false)) {
      console.log(pc.gray('Cancelled.'));
      return;
    }

    // 10. Execute sync
    console.log(pc.cyan('⏳ Syncing...'));

    const result = await executeSync(accessToken, repoFullName, {
      connectionId: connection.id,
      projectId: selectedProject.id,
      keywayEnvironment: keywayEnv,
      providerEnvironment: providerEnv,
      direction,
      allowDelete: options.allowDelete || false,
    });

    if (result.success) {
      printSyncResult({
        success: true,
        created: result.stats.created,
        updated: result.stats.updated,
        deleted: result.stats.deleted,
      });

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
