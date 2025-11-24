#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { initCommand } from './cmds/init.js';
import { pushCommand } from './cmds/push.js';
import { pullCommand } from './cmds/pull.js';
import { loginCommand, logoutCommand } from './cmds/login.js';
import { doctorCommand } from './cmds/doctor.js';
import { addBadgeToReadme } from './cmds/readme.js';
import packageJson from '../package.json' with { type: 'json' };

const program = new Command();

const shouldShowBanner = (): boolean => {
  if (process.env.KEYWAY_NO_BANNER === '1') return false;
  const argv = process.argv.slice(2);
  return !argv.includes('--no-banner') && argv.length > 0;
};

const showBanner = () => {
  const text = chalk.cyan.bold('Keyway CLI');
  const subtitle = chalk.gray('GitHub-native secrets manager for dev teams');
  console.log(`\n${text}\n${subtitle}\n`);
};

if (shouldShowBanner()) {
  showBanner();
}

program
  .name('keyway')
  .description('GitHub-native secrets manager for dev teams')
  .version(packageJson.version)
  .option('--no-banner', 'Disable the startup banner');

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

program
  .command('readme')
  .description('README utilities')
  .command('add-badge')
  .description('Insert the Keyway badge into README')
  .action(async () => {
    await addBadgeToReadme();
  });

program.parseAsync().catch((error) => {
  console.error(chalk.red('Error:'), error.message || error);
  process.exit(1);
});
