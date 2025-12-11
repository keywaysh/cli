import { execSync } from 'child_process';
import { Octokit } from '@octokit/rest';
import pc from 'picocolors';
import prompts from 'prompts';
import { detectGitRepo } from '../utils/git.js';
import { openUrl } from '../utils/helpers.js';
import { ensureLogin } from './login.js';

interface CiSetupOptions {
  repo?: string;
}

/**
 * Check if gh CLI is available and authenticated
 */
function isGhAvailable(): boolean {
  try {
    execSync('gh auth status', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Add secret using gh CLI
 */
function addSecretWithGh(repo: string, secretName: string, secretValue: string): void {
  execSync(`gh secret set ${secretName} --repo ${repo}`, {
    input: secretValue,
    stdio: ['pipe', 'ignore', 'ignore'],
  });
}

export async function ciSetupCommand(options: CiSetupOptions): Promise<void> {
  // 1. Detect repo
  const repo = options.repo || detectGitRepo();
  if (!repo) {
    console.error(pc.red('Not in a git repository. Use --repo owner/repo'));
    process.exit(1);
  }

  console.log(pc.bold(`\n🔐 Setting up GitHub Actions for ${repo}\n`));

  // 2. Ensure user is logged into Keyway first
  console.log(pc.dim('Step 1: Keyway Authentication'));
  let keywayToken: string;
  try {
    keywayToken = await ensureLogin({ allowPrompt: true });
    console.log(pc.green('  ✓ Authenticated with Keyway\n'));
  } catch {
    console.error(pc.red('  ✗ Failed to authenticate with Keyway'));
    console.error(pc.dim('  Run `keyway login` first'));
    process.exit(1);
  }

  // 3. Check if gh CLI is available - if so, use it (no PAT needed)
  const useGh = isGhAvailable();

  if (useGh) {
    console.log(pc.dim('Step 2: Adding secret via GitHub CLI'));
    try {
      addSecretWithGh(repo, 'KEYWAY_TOKEN', keywayToken);
      console.log(pc.green(`  ✓ Secret KEYWAY_TOKEN added to ${repo}\n`));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(pc.red(`  ✗ Failed to add secret: ${message}`));
      console.error(pc.dim('  Try running: gh auth login'));
      process.exit(1);
    }
  } else {
    // Fallback: use PAT + Octokit
    console.log(pc.dim('Step 2: Temporary GitHub PAT'));
    console.log('  gh CLI not found. We need a one-time GitHub PAT.');
    console.log(pc.dim('  You can delete it immediately after setup.\n'));

    const patUrl =
      'https://github.com/settings/tokens/new?scopes=repo&description=Keyway%20CI%20Setup%20(temporary)';
    await openUrl(patUrl);

    const { githubToken } = await prompts({
      type: 'password',
      name: 'githubToken',
      message: 'Paste your GitHub PAT:',
    });

    if (!githubToken) {
      console.error(pc.red('\n  ✗ GitHub PAT is required'));
      process.exit(1);
    }

    // Validate the token
    const octokit = new Octokit({ auth: githubToken });
    try {
      await octokit.users.getAuthenticated();
      console.log(pc.green('  ✓ GitHub PAT validated\n'));
    } catch {
      console.error(pc.red('  ✗ Invalid GitHub PAT'));
      process.exit(1);
    }

    // Add secret to repo
    console.log(pc.dim('Step 3: Adding secret to repository'));
    const [owner, repoName] = repo.split('/');

    try {
      await addRepoSecret(octokit, owner, repoName, 'KEYWAY_TOKEN', keywayToken);
      console.log(pc.green(`  ✓ Secret KEYWAY_TOKEN added to ${repo}\n`));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('Not Found')) {
        console.error(pc.red(`  ✗ Repository not found or no access: ${repo}`));
        console.error(pc.dim('  Make sure the PAT has access to this repository'));
      } else {
        console.error(pc.red(`  ✗ Failed to add secret: ${message}`));
      }
      process.exit(1);
    }
  }

  // Print success and snippet
  console.log(pc.green(pc.bold('✓ Setup complete!\n')));
  console.log('Add this to your workflow (.github/workflows/*.yml):\n');
  console.log(
    pc.cyan(`    - uses: keywaysh/keyway-action@v1
      with:
        token: \${{ secrets.KEYWAY_TOKEN }}
        environment: production`)
  );
  console.log();
  if (!useGh) {
    console.log(`🗑️  Delete the temporary PAT: ${pc.underline('https://github.com/settings/tokens')}`);
  }
  console.log(pc.dim(`📖 Docs: ${pc.underline('https://docs.keyway.sh/ci')}\n`));
}

async function addRepoSecret(
  octokit: Octokit,
  owner: string,
  repo: string,
  secretName: string,
  secretValue: string
): Promise<void> {
  // Get repo public key for encryption
  const { data: publicKey } = await octokit.rest.actions.getRepoPublicKey({
    owner,
    repo,
  });

  // Encrypt secret using libsodium
  const encryptedValue = await encryptSecret(publicKey.key, secretValue);

  // Create or update secret
  await octokit.rest.actions.createOrUpdateRepoSecret({
    owner,
    repo,
    secret_name: secretName,
    encrypted_value: encryptedValue,
    key_id: publicKey.key_id,
  });
}

async function encryptSecret(publicKey: string, secret: string): Promise<string> {
  // GitHub uses libsodium sealed box encryption
  const sodiumModule = await import('libsodium-wrappers');
  const sodium = sodiumModule.default || sodiumModule;
  await sodium.ready;

  const binkey = sodium.from_base64(publicKey, sodium.base64_variants.ORIGINAL);
  const binsec = sodium.from_string(secret);
  const encBytes = sodium.crypto_box_seal(binsec, binkey);

  return sodium.to_base64(encBytes, sodium.base64_variants.ORIGINAL);
}
