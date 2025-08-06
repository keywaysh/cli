import { Command } from 'commander';
import chalk from 'chalk';
import { execSync } from 'child_process';

const program = new Command();

const COMING_SOON_MESSAGE = chalk.cyan(`
🚧 Keyway is coming soon!

We're building the simplest way to manage your team's secrets.
One link in your README = instant access to all secrets.

${chalk.white('Get early access:')} ${chalk.underline('https://keyway.sh')}
${chalk.white('Contact:')} ${chalk.underline('unlock@keyway.sh')}
`);

program
  .name('keyway')
  .description('One link to all your secrets (Coming Soon)')
  .version('0.0.1');

// Command: init (preview)
program
  .command('init')
  .description('Initialize Keyway in your project')
  .action(async () => {
    console.log(chalk.cyan('\n🔑 Keyway Init (Preview)\n'));
    
    // Detect repo
    try {
      const gitRemote = execSync('git remote get-url origin', { encoding: 'utf-8' }).trim();
      let repoPath: string | undefined;
      
      if (gitRemote.includes('github.com')) {
        const match = gitRemote.match(/github\.com[:/](.+?)(\.git)?$/);
        if (match) {
          repoPath = match[1].replace('.git', '');
        }
      }
      
      if (repoPath) {
        console.log(chalk.green('✓') + ' GitHub repository detected:');
        console.log(`  ${chalk.gray('Repository:')} ${repoPath}`);
        console.log(`  ${chalk.gray('Future vault URL:')} ${chalk.white(`https://keyway.sh/${repoPath}`)}`);
        console.log();
        console.log(chalk.yellow('When launched, you\'ll be able to:'));
        console.log('  • Store all your secrets securely');
        console.log('  • Share with your team instantly');
        console.log('  • Pull secrets with one command');
        console.log();
        console.log(chalk.gray('Want early access? Visit https://keyway.sh'));
      }
    } catch {
      console.log(chalk.yellow('No git repository detected'));
      console.log(chalk.gray('Keyway will work with any GitHub repository'));
    }
  });

// Command: demo
program
  .command('demo')
  .description('See how Keyway will work')
  .action(() => {
    console.log(chalk.cyan('\n🎬 Keyway Demo\n'));
    
    console.log('How it will work:\n');
    
    // Step 1
    console.log(chalk.white('1. Initialize your project:'));
    console.log(chalk.gray('   $ ') + chalk.green('keyway init'));
    console.log(chalk.gray('   ✓ Vault created at https://keyway.sh/your/repo\n'));
    
    // Step 2
    console.log(chalk.white('2. Add the link to your README:'));
    console.log(chalk.gray('   ## 🔑 Secrets'));
    console.log(chalk.gray('   Access vault: https://keyway.sh/your/repo\n'));
    
    // Step 3
    console.log(chalk.white('3. Team members pull secrets:'));
    console.log(chalk.gray('   $ ') + chalk.green('keyway pull'));
    console.log(chalk.gray('   ✓ Authenticated via GitHub'));
    console.log(chalk.gray('   ✓ Pulled 23 secrets in 12ms\n'));
    
    // Step 4
    console.log(chalk.white('4. That\'s it! No more:'));
    console.log(chalk.gray('   ❌ "Can you send me the .env file?"'));
    console.log(chalk.gray('   ❌ API keys in Slack'));
    console.log(chalk.gray('   ❌ Outdated credentials'));
    console.log(chalk.gray('   ❌ Onboarding delays\n'));
    
    console.log(chalk.cyan('Ready to simplify your secret management?'));
    console.log(chalk.white('Get early access: ') + chalk.underline('https://keyway.sh'));
  });

// Command: waitlist
program
  .command('waitlist')
  .description('Join the early access waitlist')
  .action(() => {
    console.log(chalk.cyan('\n🚀 Join the Keyway Waitlist\n'));
    console.log('Get early access at: ' + chalk.underline('https://keyway.sh'));
    console.log();
    console.log('Or email us directly: ' + chalk.underline('unlock@keyway.sh'));
    console.log();
    console.log(chalk.gray('We\'ll notify you as soon as Keyway is ready!'));
  });

// Command: why
program
  .command('why')
  .description('Why we\'re building Keyway')
  .action(() => {
    console.log(chalk.cyan('\n💡 Why Keyway?\n'));
    
    console.log(chalk.white('The Problem:'));
    console.log('  • Secrets scattered across Slack, email, and docs');
    console.log('  • New developer onboarding takes hours');
    console.log('  • No single source of truth for env variables');
    console.log('  • Complex solutions like HashiCorp Vault are overkill\n');
    
    console.log(chalk.white('Our Solution:'));
    console.log('  • One link in your README');
    console.log('  • GitHub access = vault access');
    console.log('  • Zero-trust architecture');
    console.log('  • 12ms to pull all secrets\n');
    
    console.log(chalk.white('Built for:'));
    console.log('  • Small to medium dev teams');
    console.log('  • Projects with multiple environments');
    console.log('  • Teams tired of complexity\n');
    
    console.log(chalk.gray('Learn more at https://keyway.sh'));
  });

// Command: feedback
program
  .command('feedback [message...]')
  .description('Send us feedback')
  .action((message) => {
    if (message && message.length > 0) {
      console.log(chalk.cyan('\n📬 Thank you for your feedback!\n'));
      console.log('Your message: ' + chalk.italic(message.join(' ')));
      console.log();
      console.log('Please email it to: ' + chalk.underline('unlock@keyway.sh'));
      console.log(chalk.gray('We read every message!'));
    } else {
      console.log(chalk.cyan('\n📬 We\'d love your feedback!\n'));
      console.log('Email us at: ' + chalk.underline('unlock@keyway.sh'));
      console.log();
      console.log('Or use: ' + chalk.gray('keyway feedback "your message here"'));
    }
  });

// Hidden command for testing speed
program
  .command('speed')
  .description('Test CLI speed')
  .action(() => {
    const start = Date.now();
    console.log(chalk.green(`⚡ Executed in ${Date.now() - start}ms`));
  });

// Parse arguments
program.parse();

// Show coming soon message if no command
if (!process.argv.slice(2).length) {
  console.log(COMING_SOON_MESSAGE);
  console.log(chalk.gray('Try: keyway demo'));
}