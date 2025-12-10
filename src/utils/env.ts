import fs from 'fs';
import path from 'path';
import pc from 'picocolors';
import prompts from 'prompts';

/**
 * Prompt user to create a .env file if none exists.
 * Returns true if file was created, false if user declined.
 * Throws if user cancels (Ctrl+C).
 */
export async function promptCreateEnvFile(): Promise<boolean> {
  const { createEnv } = await prompts({
    type: 'confirm',
    name: 'createEnv',
    message: 'No .env file found. Create one?',
    initial: true,
  }, {
    onCancel: () => {
      throw new Error('Cancelled by user.');
    },
  });

  if (!createEnv) {
    return false;
  }

  const envFilePath = path.join(process.cwd(), '.env');
  fs.writeFileSync(envFilePath, '# Add your environment variables here\n# Example: API_KEY=your-api-key\n');
  console.log(pc.green('✓ Created .env file'));
  return true;
}
