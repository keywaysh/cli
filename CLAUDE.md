# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Keyway CLI is the command-line interface for Keyway, a GitHub-native secrets management platform. It allows developers to sync secrets between local `.env` files and Keyway vaults using GitHub authentication.

## Development Commands

```bash
pnpm install          # Install dependencies
pnpm run dev          # Run via tsx (development)
pnpm run build        # Bundle with tsup
pnpm run test         # Run tests with Vitest
pnpm run test:watch   # Watch mode for tests
pnpm link --global    # Link for local testing
```

## Architecture

### Directory Structure
```
src/
├── cli.ts           # Commander.js entry point, command registration
├── cmds/            # Command implementations
│   ├── login.ts     # login/logout commands
│   ├── init.ts      # Initialize vault for repo
│   ├── push.ts      # Upload secrets to vault
│   ├── pull.ts      # Download secrets from vault
│   ├── doctor.ts    # Environment diagnostics
│   ├── connect.ts   # Provider connections (Vercel, etc.)
│   ├── sync.ts      # Sync secrets with providers
│   └── readme.ts    # Generate README badge
├── config/          # Configuration constants
├── core/            # Core business logic
├── utils/           # Utilities
│   ├── api.ts       # Keyway API client
│   ├── auth.ts      # Token storage (uses 'conf' package)
│   ├── git.ts       # Git repo detection
│   └── env.ts       # .env file parsing
└── types.ts         # TypeScript types
```

### Commands

| Command | Description |
|---------|-------------|
| `keyway login` | Authenticate via GitHub device flow or PAT |
| `keyway logout` | Clear stored credentials |
| `keyway init` | Initialize vault for current repository |
| `keyway push` | Upload secrets from .env file to vault |
| `keyway pull` | Download secrets from vault to .env file |
| `keyway doctor` | Run environment diagnostics |
| `keyway connect <provider>` | Connect to provider (vercel, netlify) |
| `keyway connections` | List provider connections |
| `keyway disconnect <id>` | Remove provider connection |
| `keyway sync` | Sync secrets with connected providers |

### Key Patterns

- **Authentication**: Device code flow (user approves in browser) or fine-grained PAT (`--token` flag)
- **Token Storage**: Uses `conf` package (see locations below)
- **Git Detection**: Auto-detects GitHub remote from `.git/config`
- **Environment Detection**: Looks for `.env`, `.env.local`, `.env.development`
- **Error Handling**: RFC 7807 errors from API, includes `upgradeUrl` for plan limits

### Token Storage Locations

The CLI stores credentials in two locations:

**Config file** (via `conf` package with `projectName: 'keyway'`):
- macOS: `~/Library/Preferences/keyway-nodejs/config.json`
- Linux: `~/.config/keyway-nodejs/config.json`
- Windows: `%APPDATA%/keyway-nodejs/Config/config.json`

**Encryption key** (for encrypting the stored token):
- All platforms: `~/.keyway/.key`

`keyway logout` clears the `auth` key from the config file but preserves the encryption key.
For a complete cleanup: `rm -rf ~/.keyway ~/Library/Preferences/keyway-nodejs` (macOS)

### API Client (`src/utils/api.ts`)

```typescript
// All API calls go through this client
const api = new KeywayAPI(token);
await api.push(owner, repo, secrets, environment);
await api.pull(owner, repo, environment);
await api.validateToken();
```

### Dependencies

- **commander**: CLI framework
- **picocolors**: Terminal colors (lighter than chalk)
- **conf**: Config/token storage
- **dotenv**: .env file parsing
- **ora**: Spinners for async operations

## Testing

Tests use Vitest. Run with `pnpm test`.

```bash
pnpm test              # Run all tests
pnpm test:watch        # Watch mode
pnpm test -- login     # Run specific test file
```

## Environment Variables

- `KEYWAY_API_URL`: Override API URL (default: https://api.keyway.sh)
- `KEYWAY_DISABLE_TELEMETRY=1`: Disable anonymous usage analytics

## Error Handling

The CLI handles plan limit errors specially:
```
⚠ Free plan allows 1 private repo.
⚡ Upgrade: https://app.keyway.sh/upgrade
```

For RFC 7807 errors, display `detail` field to user.
