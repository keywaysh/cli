# Keyway CLI

> GitHub-native secrets manager for dev teams

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![npm version](https://badge.fury.io/js/%40keywaysh%2Fcli.svg)](https://www.npmjs.com/package/@keywaysh/cli)

## Installation

```bash
pnpm add -g @keywaysh/cli
```

Or use without installing:

```bash
npx @keywaysh/cli init
```

## Quick Start

```bash
# 0. Authenticate once (browser/device flow)
keyway login

# 1. Initialize a vault for your repository
keyway init

# 2. Prepare your env file with secrets (e.g., .env or .env.staging)

# 3. Push secrets to the vault
keyway push --file .env

# 4. On another machine, pull secrets
keyway pull --file .env
```

## Commands

### `keyway login`

Authenticate with GitHub through the Keyway OAuth/device flow and cache a session locally.

```bash
keyway login
```

If you forget to log in, `init`, `push`, and `pull` will prompt you to authenticate (skip with `--no-login-prompt` in CI).

Fine-grained PAT alternative:

```bash
keyway login --token
```

This opens GitHub to create a repo-scoped fine-grained PAT (metadata: read-only, no account permissions). Paste the `github_pat_...` token when prompted; the CLI validates and stores it.

### `keyway init`

Initialize a vault for the current repository.

```bash
keyway init
```

**Requirements:**
- Must be in a git repository
- Repository must have a GitHub remote
- Authenticated via `keyway login` (or provide `GITHUB_TOKEN`)

### `keyway push`

Upload secrets from a local env file to the vault.

```bash
# Push env file to development environment (default)
keyway push --file .env

# Push to a specific environment
keyway push --env production

# Push a different file
keyway push --file .env.staging --env staging
```

**Options:**
- `-e, --env <environment>` - Environment name (default: "development")
- `-f, --file <file>` - File to push (default file used if not provided)

### `keyway pull`

Download secrets from the vault to a local env file.

```bash
# Pull development environment to your env file (default path if omitted)
keyway pull --file .env

# Pull from a specific environment
keyway pull --env production

# Pull to a different file
keyway pull --file .env.local --env development
```

**Options:**
- `-e, --env <environment>` - Environment name (default: "development")
- `-f, --file <file>` - File to write to (default file used if not provided)

### `keyway doctor`

Run comprehensive environment diagnostics.

```bash
# Run all checks
keyway doctor

# Output as JSON (for CI/CD)
keyway doctor --json

# Strict mode (treat warnings as failures)
keyway doctor --strict
```

**Checks performed:**
- ✅ Node.js version (≥18.0.0 required)
- ✅ Git installation and repository status
- ✅ Network connectivity to API
- ✅ File system write permissions
- ✅ .gitignore configuration for environment files

## Configuration

### GitHub Token

Keyway prefers the OAuth/device flow:

```bash
keyway login
```

This opens a browser (or gives you a code/URL) and stores a Keyway token in `~/.config/keyway/config.json`.

If you cannot use the login flow, set a GitHub token manually:

**Option 1: Environment Variable**

```bash
export GITHUB_TOKEN=your_github_personal_access_token
```

**Option 2: Git Config**

```bash
git config --global github.token your_github_personal_access_token
```

**Creating a GitHub Token:**

1. Go to GitHub Settings → Developer settings → Personal access tokens → Tokens (classic)
2. Click "Generate new token"
3. Select scopes: `repo` (Full control of private repositories)
4. Generate and copy the token

### API URL

By default, Keyway uses the production API at `https://keyway-backend-production.up.railway.app`. To point to another API:

```bash
export KEYWAY_API_URL=http://localhost:3000
```

### Analytics

Keyway uses PostHog for privacy-first analytics. To configure:

```bash
export KEYWAY_POSTHOG_KEY=your_posthog_key
export KEYWAY_POSTHOG_HOST=https://app.posthog.com
```

Disable telemetry:

```bash
export KEYWAY_DISABLE_TELEMETRY=1
```

The CLI ships with built-in analytics defaults; use the env vars above to override for development.

**Privacy:** No secret names or values are ever sent to analytics.

## How It Works

1. **Authentication**: Uses your GitHub token to verify identity
2. **Authorization**: Checks if you're a collaborator/admin on the repository
3. **Encryption**: All secrets are encrypted server-side with AES-256-GCM
4. **Storage**: Encrypted secrets stored in PostgreSQL
5. **Retrieval**: Secrets are decrypted and returned only to authorized users

## Development

```bash
# Install dependencies
npm install

# Run in dev mode
npm run dev

# Build
npm run build

# Watch mode
npm run build:watch

# Run tests
npm test

# Test locally
npm link
keyway --version
```

## Architecture

```
src/
├── cli.tsx          # Main CLI entry point with commander
├── types.ts         # TypeScript types and interfaces
├── ui/              # Ink React components
│   ├── Banner.tsx   # Startup banner with gradient
│   └── Spinner.tsx  # Loading spinner component
├── cmds/            # Command implementations
│   ├── init.ts      # Initialize vault
│   ├── push.ts      # Push secrets
│   ├── pull.ts      # Pull secrets
│   └── doctor.tsx   # Environment diagnostics
├── utils/           # Utility functions
│   ├── analytics.ts # PostHog integration
│   ├── api.ts       # API client
│   └── git.ts       # Git helpers
└── core/            # Core business logic
    └── doctor.ts    # Doctor checks implementations
```

## Privacy & Security

### Analytics Safety

**NEVER tracked:**
- Secret names (e.g., `API_KEY`, `DATABASE_URL`)
- Secret values
- Environment variable content
- Access tokens
- File contents

**Only tracked:**
- Command usage (init, push, pull)
- Repository names (public info)
- Environment names (e.g., "production")
- Number of variables (count only)
- Error messages (sanitized)
- Machine-specific anonymous ID

### Distinct ID

Each machine has a unique, anonymous identifier stored in `~/.config/keyway/id.json`. This ID is randomly generated and contains no personally identifiable information.

## Troubleshooting

### "Not in a git repository"

```bash
# Initialize git and add a remote
git init
git remote add origin git@github.com:your-org/your-repo.git
```

### "GitHub token not found"

```bash
# Set your GitHub token
export GITHUB_TOKEN=your_token
```

### "Vault not found"

```bash
# Initialize the vault first
keyway init
```

### "You do not have access to this repository"

Make sure you're a collaborator or admin on the GitHub repository.

### Disabling the Banner

```bash
# Via command line flag
keyway --no-banner doctor

# Via environment variable
export KEYWAY_NO_BANNER=1
keyway doctor
```

## Publishing to npm

```bash
# Update version
npm version patch  # or minor, or major

# Build
npm run build

# Publish
npm publish
```

## License

MIT © Nicolas Ritouet

## Support

- **Issues**: https://github.com/keywaysh/cli/issues
- **Email**: unlock@keyway.sh
- **Website**: https://keyway.sh
