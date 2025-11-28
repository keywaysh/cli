<div align="center">
  <h1>Keyway CLI</h1>
  <strong>The simplest way to sync your project's environment variables.</strong><br/>
  Stop sending <code>.env</code> files on Slack. One command and you're in sync.
  <br/><br/>
  <a href="https://keyway.sh">keyway.sh</a> ·
  <a href="https://github.com/keywaysh/cli">GitHub</a> ·
  <a href="https://www.npmjs.com/package/@keywaysh/cli">NPM</a>
  <br/><br/>

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![npm version](https://img.shields.io/npm/v/@keywaysh/cli.svg)](https://www.npmjs.com/package/@keywaysh/cli)

</div>

## Why Keyway?

Most devs store secrets in... chaotic places:

- Slack
- Notion
- Discord
- Google Docs
- Lost `.env` files
- Messages you can't find anymore
- Machine of the dev who left the project

**Keyway fixes that.**

If you have GitHub access to a repo → you have access to its secrets.
No invites. No dashboards. No complex config.
Just one command that works.

## Install

```bash
npm install -g @keywaysh/cli
```

## Quick Start

Inside any project connected to GitHub:

```bash
keyway login
keyway init
```

What happens:

1. Keyway authenticates via GitHub OAuth
2. Detects your GitHub repo
3. Creates a vault for this repo
4. Asks if you want to sync your `.env`

Then any teammate can simply run:

```bash
keyway pull
```

And boom: your `.env` is recreated locally.

## Commands

### `keyway login`

Authenticate with GitHub through the Keyway OAuth/device flow.

```bash
keyway login
```

If you prefer using a fine-grained PAT:

```bash
keyway login --token
```

### `keyway init`

Initialize a vault for the current repository.

```bash
keyway init
```

Creates a vault, pushes your `.env`, and sets everything up.

### `keyway push`

Push your local `.env` to the vault.

```bash
# Push to development (default)
keyway push

# Push to a specific environment
keyway push --env production

# Push a different file
keyway push --file .env.staging --env staging
```

Useful when:
- you added a new variable
- you rotated a key
- you fixed a staging/production mismatch

### `keyway pull`

Pull secrets from the vault and write them to `.env`.

```bash
# Pull development environment (default)
keyway pull

# Pull from a specific environment
keyway pull --env production

# Pull to a different file
keyway pull --file .env.local
```

Perfect for:
- onboarding a new dev
- syncing your local environment
- switching between machines

### `keyway doctor`

Diagnostic command to check your setup.

```bash
keyway doctor

# Output as JSON (for CI/CD)
keyway doctor --json

# Strict mode (treat warnings as failures)
keyway doctor --strict
```

**Checks performed:**
- Node.js version (≥18.0.0 required)
- Git installation and repository status
- API connectivity
- File system write permissions
- `.gitignore` configuration
- System clock synchronization

### `keyway logout`

Clear stored Keyway credentials.

```bash
keyway logout
```

## Security

Keyway is designed to be **simple and secure** — a major upgrade from Slack or Notion, without the complexity of Hashicorp Vault or AWS Secrets Manager.

**What we do:**
- AES-256-GCM encryption server-side and client-side token storage
- TLS everywhere (HTTPS enforced)
- GitHub read-only permissions
- No access to your code
- Secrets stored encrypted at rest
- No analytics on secret values (only metadata)
- Encrypted token storage with file permissions

**What we don't do:**
- No zero-trust enterprise model
- No access to your cloud infrastructure
- No access to your production deployment keys

For detailed security information, see [SECURITY.md](./SECURITY.md) and [keyway.sh/security](https://keyway.sh/security)

## Who is this for?

Keyway is perfect for:
- Solo developers
- Small teams
- Side-projects
- Early SaaS
- Agencies managing many repos
- Rapid prototyping

**Not designed for:**
- Banks
- Governments
- Enterprise zero-trust teams
  *(you're looking for Vault, Doppler, or AWS Secrets Manager)*

## Example Workflow

```bash
git clone git@github.com:acme/backend.git
cd backend
keyway pull
# ✓ secrets pulled
npm run dev
```

Add a new secret:

```bash
echo "STRIPE_KEY=sk_live_xxx" >> .env
keyway push
# ✓ 1 secret updated
```

## Configuration

### GitHub Token (alternative to login)

If you cannot use the login flow, set a GitHub token manually:

```bash
# Environment variable
export GITHUB_TOKEN=your_github_personal_access_token

# Or via git config
git config --global github.token your_github_personal_access_token
```

### API URL

By default, Keyway uses the production API. To point to another API:

```bash
export KEYWAY_API_URL=http://localhost:3000
```

### Disable Telemetry

```bash
export KEYWAY_DISABLE_TELEMETRY=1
```

## Privacy & Analytics

**NEVER tracked:**
- Secret names or values
- Environment variable content
- Access tokens
- File contents

**Only tracked:**
- Command usage (init, push, pull)
- Repository names (public info)
- Error messages (sanitized)

## Troubleshooting

### "Not in a git repository"

```bash
git init
git remote add origin git@github.com:your-org/your-repo.git
```

### "GitHub token not found"

```bash
keyway login
# or
export GITHUB_TOKEN=your_token
```

### "Vault not found"

```bash
keyway init
```

### "You do not have access to this repository"

Make sure you're a collaborator or admin on the GitHub repository.

## TL;DR

```bash
npm i -g @keywaysh/cli
keyway login
keyway init
keyway pull
```

No more Slack. No more outdated `.env`.
Your team stays perfectly in sync.

## Support

- **Issues**: [github.com/keywaysh/cli/issues](https://github.com/keywaysh/cli/issues)
- **Email**: hello@keyway.sh
- **Website**: [keyway.sh](https://keyway.sh)

## License

MIT © Nicolas Ritouet
