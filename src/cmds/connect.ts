import pc from 'picocolors';
import prompts from 'prompts';
import { getProviders, getConnections, deleteConnection, getProviderAuthUrl, connectWithToken, truncateMessage } from '../utils/api.js';
import { ensureLogin } from './login.js';
import { trackEvent, AnalyticsEvents } from '../utils/analytics.js';
import { openUrl } from '../utils/helpers.js';

// Providers that use direct token auth instead of OAuth
const TOKEN_AUTH_PROVIDERS = ['railway'];

interface ConnectOptions {
  loginPrompt?: boolean;
}

/**
 * Get the token creation URL for a provider
 */
function getTokenCreationUrl(provider: string): string {
  switch (provider) {
    case 'railway':
      return 'https://railway.com/account/tokens';
    default:
      return '';
  }
}

/**
 * Connect using token-based auth (Railway)
 */
async function connectWithTokenFlow(
  accessToken: string,
  provider: string,
  displayName: string
): Promise<boolean> {
  const tokenUrl = getTokenCreationUrl(provider);

  if (provider === 'railway') {
    console.log(pc.yellow('\nTip: Select the workspace containing your projects.'));
    console.log(pc.yellow('     Do NOT use "No workspace" - it won\'t have access to your projects.'));
  }

  await openUrl(tokenUrl);

  const { token } = await prompts({
    type: 'password',
    name: 'token',
    message: `${displayName} API Token:`,
  });

  if (!token) {
    console.log(pc.gray('Cancelled.'));
    return false;
  }

  console.log(pc.gray('\nValidating token...'));

  try {
    const result = await connectWithToken(accessToken, provider, token);

    if (result.success) {
      console.log(pc.green(`\n✓ Connected to ${displayName}!`));
      console.log(pc.gray(`  Account: ${result.user.username}`));
      if (result.user.teamName) {
        console.log(pc.gray(`  Team: ${result.user.teamName}`));
      }
      return true;
    } else {
      console.log(pc.red('\n✗ Connection failed.'));
      return false;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Token validation failed';
    console.log(pc.red(`\n✗ ${message}`));
    return false;
  }
}

/**
 * Connect using OAuth flow (Vercel, etc.)
 */
async function connectWithOAuthFlow(
  accessToken: string,
  provider: string,
  displayName: string
): Promise<boolean> {
  const authUrl = getProviderAuthUrl(provider, accessToken);
  const startTime = new Date();

  await openUrl(authUrl);
  console.log(pc.gray('Waiting for authorization...'));

  const maxAttempts = 60; // 5 minutes max (5s * 60)
  let attempts = 0;

  while (attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 5000));
    attempts++;

    try {
      const { connections } = await getConnections(accessToken);
      const newConn = connections.find(c =>
        c.provider === provider &&
        new Date(c.createdAt) > startTime
      );

      if (newConn) {
        console.log(pc.green(`\n✓ Connected to ${displayName}!`));
        return true;
      }
    } catch {
      // Ignore polling errors, keep trying
    }
  }

  console.log(pc.red('\n✗ Authorization timeout.'));
  console.log(pc.gray('Run `keyway connections` to check if the connection was established.'));
  return false;
}

/**
 * Connect to a provider (e.g., Vercel)
 */
export async function connectCommand(provider: string, options: ConnectOptions = {}) {
  try {
    const accessToken = await ensureLogin({ allowPrompt: options.loginPrompt !== false });

    // Validate provider exists
    const { providers } = await getProviders();
    const providerInfo = providers.find(p => p.name === provider.toLowerCase());

    if (!providerInfo) {
      const available = providers.map(p => p.name).join(', ');
      console.error(pc.red(`Unknown provider: ${provider}`));
      console.log(pc.gray(`Available providers: ${available || 'none'}`));
      process.exit(1);
    }

    if (!providerInfo.configured) {
      console.error(pc.red(`Provider ${providerInfo.displayName} is not configured on the server.`));
      console.log(pc.gray('Contact your administrator to enable this integration.'));
      process.exit(1);
    }

    // Check if already connected
    const { connections } = await getConnections(accessToken);
    const existingConnection = connections.find(c => c.provider === provider.toLowerCase());

    if (existingConnection) {
      const { reconnect } = await prompts({
        type: 'confirm',
        name: 'reconnect',
        message: `You're already connected to ${providerInfo.displayName}. Reconnect?`,
        initial: false,
      });

      if (!reconnect) {
        console.log(pc.gray('Keeping existing connection.'));
        return;
      }
    }

    console.log(pc.blue(`\nConnecting to ${providerInfo.displayName}...\n`));

    let connected = false;

    // Check if this provider uses token auth instead of OAuth
    if (TOKEN_AUTH_PROVIDERS.includes(provider.toLowerCase())) {
      // Token-based auth flow (Railway)
      connected = await connectWithTokenFlow(accessToken, provider.toLowerCase(), providerInfo.displayName);
    } else {
      // OAuth flow (Vercel, etc.)
      connected = await connectWithOAuthFlow(accessToken, provider.toLowerCase(), providerInfo.displayName);
    }

    trackEvent(AnalyticsEvents.CLI_CONNECT, {
      provider: provider.toLowerCase(),
      success: connected,
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Connection failed';
    trackEvent(AnalyticsEvents.CLI_ERROR, {
      command: 'connect',
      error: truncateMessage(message),
    });
    console.error(pc.red(`\n✗ ${message}`));
    process.exit(1);
  }
}

/**
 * List provider connections
 */
export async function connectionsCommand(options: ConnectOptions = {}) {
  try {
    const accessToken = await ensureLogin({ allowPrompt: options.loginPrompt !== false });

    const { connections } = await getConnections(accessToken);

    if (connections.length === 0) {
      console.log(pc.gray('No provider connections found.'));
      console.log(pc.gray('\nConnect to a provider with: keyway connect <provider>'));
      console.log(pc.gray('Available providers: vercel, railway'));
      return;
    }

    console.log(pc.blue('\n📡 Provider Connections\n'));

    for (const conn of connections) {
      const providerName = conn.provider.charAt(0).toUpperCase() + conn.provider.slice(1);
      const teamInfo = conn.providerTeamId ? pc.gray(` (Team: ${conn.providerTeamId})`) : '';
      const date = new Date(conn.createdAt).toLocaleDateString();

      console.log(`  ${pc.green('●')} ${pc.bold(providerName)}${teamInfo}`);
      console.log(pc.gray(`    Connected: ${date}`));
      console.log(pc.gray(`    ID: ${conn.id}`));
      console.log('');
    }

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list connections';
    console.error(pc.red(`\n✗ ${message}`));
    process.exit(1);
  }
}

/**
 * Disconnect from a provider
 */
export async function disconnectCommand(provider: string, options: ConnectOptions = {}) {
  try {
    const accessToken = await ensureLogin({ allowPrompt: options.loginPrompt !== false });

    const { connections } = await getConnections(accessToken);
    const connection = connections.find(c => c.provider === provider.toLowerCase());

    if (!connection) {
      console.log(pc.gray(`No connection found for provider: ${provider}`));
      return;
    }

    const providerName = provider.charAt(0).toUpperCase() + provider.slice(1);

    const { confirm } = await prompts({
      type: 'confirm',
      name: 'confirm',
      message: `Disconnect from ${providerName}?`,
      initial: false,
    });

    if (!confirm) {
      console.log(pc.gray('Cancelled.'));
      return;
    }

    await deleteConnection(accessToken, connection.id);

    console.log(pc.green(`\n✓ Disconnected from ${providerName}`));

    trackEvent(AnalyticsEvents.CLI_DISCONNECT, {
      provider: provider.toLowerCase(),
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Disconnect failed';
    trackEvent(AnalyticsEvents.CLI_ERROR, {
      command: 'disconnect',
      error: truncateMessage(message),
    });
    console.error(pc.red(`\n✗ ${message}`));
    process.exit(1);
  }
}
