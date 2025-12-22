# @keywaysh/cli

GitHub-native secrets management. If you have repo access, you get secret access.

## Installation

```bash
npm install -g @keywaysh/cli
```

Or with npx:

```bash
npx @keywaysh/cli pull
```

## Quick Start

```bash
# Sign in with GitHub
keyway login

# Initialize vault for current repo
keyway init

# Push secrets from .env
keyway push

# Pull secrets to .env
keyway pull
```

## Alternative Installation

Using the install script:

```bash
curl -fsSL https://keyway.sh/install.sh | sh
```

## Documentation

Visit [docs.keyway.sh](https://docs.keyway.sh) for full documentation.

## License

MIT
