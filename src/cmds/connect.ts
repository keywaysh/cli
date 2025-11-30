import pc from 'picocolors';
import open from 'open';
import prompts from 'prompts';
import { getProviders, getConnections, deleteConnection, getProviderAuthUrl, truncateMessage } from '../utils/api.js';
import { ensureLogin } from './login.js';
import { trackEvent, AnalyticsEvents } from '../utils/analytics.js';

interface ConnectOptions {
  loginPrompt?: boolean;
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

    // Open browser for OAuth
    const authUrl = getProviderAuthUrl(provider.toLowerCase());
    const startTime = new Date();

    console.log(pc.gray('Opening browser for authorization...'));
    console.log(pc.gray(`If the browser doesn't open, visit: ${authUrl}`));

    await open(authUrl).catch(() => {
      // Silent fail, user has the URL
    });

    // Poll for connection confirmation
    console.log(pc.gray('Waiting for authorization...'));

    const maxAttempts = 60; // 5 minutes max (5s * 60)
    let attempts = 0;
    let connected = false;

    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      attempts++;

      try {
        const { connections } = await getConnections(accessToken);
        const newConn = connections.find(c =>
          c.provider === provider.toLowerCase() &&
          new Date(c.createdAt) > startTime
        );

        if (newConn) {
          connected = true;
          console.log(pc.green(`\n✓ Connected to ${providerInfo.displayName}!`));
          break;
        }
      } catch {
        // Ignore polling errors, keep trying
      }
    }

    if (!connected) {
      console.log(pc.red('\n✗ Authorization timeout.'));
      console.log(pc.gray('Run `keyway connections` to check if the connection was established.'));
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
      console.log(pc.gray('Available providers: vercel'));
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
