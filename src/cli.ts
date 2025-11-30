#!/usr/bin/env node

import { Command } from 'commander';
import pc from 'picocolors';
import { initCommand } from './cmds/init.js';
import { pushCommand } from './cmds/push.js';
import { pullCommand } from './cmds/pull.js';
import { loginCommand, logoutCommand } from './cmds/login.js';
import { doctorCommand } from './cmds/doctor.js';
import { connectCommand, connectionsCommand, disconnectCommand } from './cmds/connect.js';
import { syncCommand } from './cmds/sync.js';
import packageJson from '../package.json' with { type: 'json' };

const program = new Command();

const showBanner = () => {
  const text = pc.bold(pc.cyan('Keyway CLI'));
  const subtitle = pc.gray('GitHub-native secrets manager for dev teams');
  console.log(`\n${text}\n${subtitle}\n`);
};

showBanner();

program
  .name('keyway')
  .description('GitHub-native secrets manager for dev teams')
  .version(packageJson.version);

program
  .command('init')
  .description('Initialize a vault for the current repository')
  .option('--no-login-prompt', 'Fail instead of prompting to login if unauthenticated')
  .action(async (options) => {
    await initCommand(options);
  });

program
  .command('push')
  .description('Upload secrets from an env file to the vault')
  .option('-e, --env <environment>', 'Environment name', 'development')
  .option('-f, --file <file>', 'Env file to push')
  .option('-y, --yes', 'Skip confirmation prompt')
  .option('--no-login-prompt', 'Fail instead of prompting to login if unauthenticated')
  .action(async (options) => {
    await pushCommand(options);
  });

program
  .command('pull')
  .description('Download secrets from the vault to an env file')
  .option('-e, --env <environment>', 'Environment name', 'development')
  .option('-f, --file <file>', 'Env file to write to')
  .option('-y, --yes', 'Overwrite target file without confirmation')
  .option('--no-login-prompt', 'Fail instead of prompting to login if unauthenticated')
  .action(async (options) => {
    await pullCommand(options);
  });

program
  .command('login')
  .description('Authenticate with GitHub via Keyway')
  .option('--token', 'Authenticate using a GitHub fine-grained PAT')
  .action(async (options) => {
    await loginCommand(options);
  });

program
  .command('logout')
  .description('Clear stored Keyway credentials')
  .action(async () => {
    await logoutCommand();
  });

program
  .command('doctor')
  .description('Run environment checks to ensure Keyway runs smoothly')
  .option('--json', 'Output results as JSON for machine processing', false)
  .option('--strict', 'Treat warnings as failures', false)
  .action(async (options) => {
    await doctorCommand(options);
  });

// Provider integrations
program
  .command('connect <provider>')
  .description('Connect to an external provider (e.g., vercel)')
  .option('--no-login-prompt', 'Fail instead of prompting to login if unauthenticated')
  .action(async (provider, options) => {
    await connectCommand(provider, options);
  });

program
  .command('connections')
  .description('List your provider connections')
  .option('--no-login-prompt', 'Fail instead of prompting to login if unauthenticated')
  .action(async (options) => {
    await connectionsCommand(options);
  });

program
  .command('disconnect <provider>')
  .description('Disconnect from a provider')
  .option('--no-login-prompt', 'Fail instead of prompting to login if unauthenticated')
  .action(async (provider, options) => {
    await disconnectCommand(provider, options);
  });

program
  .command('sync <provider>')
  .description('Sync secrets with a provider (e.g., vercel)')
  .option('--pull', 'Import secrets from provider to Keyway')
  .option('-e, --environment <env>', 'Keyway environment', 'production')
  .option('--provider-env <env>', 'Provider environment', 'production')
  .option('--project <project>', 'Provider project name or ID')
  .option('--allow-delete', 'Allow deleting secrets not in source')
  .option('-y, --yes', 'Skip confirmation prompt')
  .option('--no-login-prompt', 'Fail instead of prompting to login if unauthenticated')
  .action(async (provider, options) => {
    await syncCommand(provider, options);
  });

program.parseAsync().catch((error) => {
  console.error(pc.red('Error:'), error.message || error);
  process.exit(1);
});
