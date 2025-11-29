import chalk from 'chalk';
import open from 'open';
import prompts from 'prompts';
import { getProviders, getConnections, deleteConnection, getProviderAuthUrl } from '../utils/api.js';
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
      console.error(chalk.red(`Unknown provider: ${provider}`));
      console.log(chalk.gray(`Available providers: ${available || 'none'}`));
      process.exit(1);
    }

    if (!providerInfo.configured) {
      console.error(chalk.red(`Provider ${providerInfo.displayName} is not configured on the server.`));
      console.log(chalk.gray('Contact your administrator to enable this integration.'));
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
        console.log(chalk.gray('Keeping existing connection.'));
        return;
      }
    }

    console.log(chalk.blue(`\n🔗 Connecting to ${providerInfo.displayName}...\n`));

    // Open browser for OAuth
    const authUrl = getProviderAuthUrl(provider.toLowerCase());
    console.log(chalk.gray('Opening browser for authorization...'));
    console.log(chalk.gray(`If the browser doesn't open, visit: ${authUrl}`));

    await open(authUrl).catch(() => {
      // Silent fail, user has the URL
    });

    console.log(chalk.yellow('\n⏳ Complete the authorization in your browser.'));
    console.log(chalk.gray('The browser window will confirm when connected.\n'));

    trackEvent(AnalyticsEvents.CLI_CONNECT, {
      provider: provider.toLowerCase(),
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Connection failed';
    trackEvent(AnalyticsEvents.CLI_ERROR, {
      command: 'connect',
      error: message.slice(0, 200),
    });
    console.error(chalk.red(`\n✗ ${message}`));
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
      console.log(chalk.gray('No provider connections found.'));
      console.log(chalk.gray('\nConnect to a provider with: keyway connect <provider>'));
      console.log(chalk.gray('Available providers: vercel'));
      return;
    }

    console.log(chalk.blue('\n📡 Provider Connections\n'));

    for (const conn of connections) {
      const providerName = conn.provider.charAt(0).toUpperCase() + conn.provider.slice(1);
      const teamInfo = conn.providerTeamId ? chalk.gray(` (Team: ${conn.providerTeamId})`) : '';
      const date = new Date(conn.createdAt).toLocaleDateString();

      console.log(`  ${chalk.green('●')} ${chalk.bold(providerName)}${teamInfo}`);
      console.log(chalk.gray(`    Connected: ${date}`));
      console.log(chalk.gray(`    ID: ${conn.id}`));
      console.log('');
    }

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list connections';
    console.error(chalk.red(`\n✗ ${message}`));
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
      console.log(chalk.gray(`No connection found for provider: ${provider}`));
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
      console.log(chalk.gray('Cancelled.'));
      return;
    }

    await deleteConnection(accessToken, connection.id);

    console.log(chalk.green(`\n✓ Disconnected from ${providerName}`));

    trackEvent(AnalyticsEvents.CLI_DISCONNECT, {
      provider: provider.toLowerCase(),
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Disconnect failed';
    trackEvent(AnalyticsEvents.CLI_ERROR, {
      command: 'disconnect',
      error: message.slice(0, 200),
    });
    console.error(chalk.red(`\n✗ ${message}`));
    process.exit(1);
  }
}
