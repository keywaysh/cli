# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

Keyway CLI (Go) is the command-line interface for Keyway, a GitHub-native secrets management platform. Written in Go, distributed as a single binary.

## Development Commands

```bash
make build          # Build for current platform → ./keyway-dev
make build-all      # Build for all platforms → ./dist/
make test           # Run tests
make test-coverage  # Run tests with coverage report
make lint           # Run golangci-lint
make install        # Install to ~/bin/keyway-dev
```

## Architecture

```
cmd/keyway/         # Entry point (main.go)
internal/
├── cmd/            # Cobra commands (login, init, push, pull, scan, etc.)
├── api/            # Keyway API client
├── auth/           # Token storage (keyring)
├── config/         # Configuration and environment
├── git/            # Git repository detection
├── analytics/      # PostHog telemetry
└── ui/             # Terminal UI helpers (huh, spinner, colors)
npm/                # npm package for distribution
```

## Key Patterns

### Commands
All commands use Cobra and follow this pattern:
```go
var exampleCmd = &cobra.Command{
    Use:   "example",
    Short: "Short description",
    RunE:  runExample,
}

func runExample(cmd *cobra.Command, args []string) error {
    ui.Intro("example")
    // ... implementation
    ui.Outro("Done!")
    return nil
}
```

### API Client
```go
client := api.NewClient(token)
secrets, err := client.PullSecrets(ctx, owner, repo, env)
```

### UI Helpers
```go
ui.Intro("command")      // Command banner
ui.Success("message")    // Green checkmark
ui.Error("message")      // Red X
ui.Spin("Loading...", func() error { ... })
```

## Testing

Tests use table-driven patterns and mocks:
```go
func TestExample(t *testing.T) {
    tests := []struct {
        name    string
        input   string
        want    string
        wantErr bool
    }{...}
    
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {...})
    }
}
```

## Release Process

1. Tag and push: `git tag v0.2.0 && git push origin v0.2.0`
2. GoReleaser builds binaries for all platforms
3. macOS binaries are signed and notarized
4. Binaries uploaded to GitHub Releases

## npm Distribution

The `npm/` directory contains the npm package (`@keywaysh/cli`) that downloads the Go binary at install time:
- `npm/package.json` - Package config
- `npm/scripts/install.js` - Downloads binary from GitHub Releases
- `npm/bin/keyway` - Node.js wrapper that calls the binary
