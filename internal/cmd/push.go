package cmd

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/keywaysh/cli/internal/analytics"
	"github.com/keywaysh/cli/internal/api"
	"github.com/keywaysh/cli/internal/git"
	"github.com/keywaysh/cli/internal/ui"
	"github.com/spf13/cobra"
)

var pushCmd = &cobra.Command{
	Use:   "push",
	Short: "Upload secrets from an env file to the vault",
	Long:  `Upload secrets from a local .env file to the Keyway vault.`,
	RunE:  runPush,
}

func init() {
	pushCmd.Flags().StringP("env", "e", "", "Environment name")
	pushCmd.Flags().StringP("file", "f", "", "Env file to push")
	pushCmd.Flags().BoolP("yes", "y", false, "Skip confirmation prompt")
}

func runPush(cmd *cobra.Command, args []string) error {
	ui.Intro("push")

	// Check gitignore
	if !git.CheckEnvGitignore() {
		ui.Warn(".env files are not in .gitignore - secrets may be committed")
		if ui.IsInteractive() {
			add, _ := ui.Confirm("Add .env* to .gitignore?", true)
			if add {
				if err := git.AddEnvToGitignore(); err == nil {
					ui.Success("Added .env* to .gitignore")
				}
			}
		}
	}

	env, _ := cmd.Flags().GetString("env")
	file, _ := cmd.Flags().GetString("file")
	yes, _ := cmd.Flags().GetBool("yes")

	// Discover env files
	candidates := discoverEnvFiles()

	if len(candidates) == 0 && file == "" {
		if !ui.IsInteractive() {
			ui.Error("No .env file found")
			return fmt.Errorf("no .env file found")
		}
		create, _ := ui.Confirm("No .env file found. Create one?", true)
		if create {
			if err := os.WriteFile(".env", []byte("# Add your environment variables here\n# Example: API_KEY=your-api-key\n"), 0600); err != nil {
				return err
			}
			ui.Success("Created .env file")
			ui.Message(ui.Dim("Add your variables and run keyway push again"))
		}
		return nil
	}

	// Select file if not specified
	if file == "" && ui.IsInteractive() && len(candidates) > 1 {
		options := make([]string, len(candidates))
		for i, c := range candidates {
			options[i] = fmt.Sprintf("%s (env: %s)", c.file, c.env)
		}
		selected, err := ui.Select("Select an env file to push:", options)
		if err != nil {
			return err
		}
		for _, c := range candidates {
			if strings.HasPrefix(selected, c.file) {
				file = c.file
				if env == "" {
					env = c.env
				}
				break
			}
		}
	}

	// Defaults
	if file == "" {
		if len(candidates) > 0 {
			file = candidates[0].file
			if env == "" {
				env = candidates[0].env
			}
		} else {
			file = ".env"
		}
	}
	if env == "" {
		env = deriveEnvFromFile(file)
	}

	// Read file
	content, err := os.ReadFile(file)
	if err != nil {
		ui.Error(fmt.Sprintf("File not found: %s", file))
		return err
	}

	if len(strings.TrimSpace(string(content))) == 0 {
		ui.Error(fmt.Sprintf("File is empty: %s", file))
		return fmt.Errorf("file is empty")
	}

	secrets := parseEnvContent(string(content))
	if len(secrets) == 0 {
		ui.Error("No valid environment variables found in file")
		return fmt.Errorf("no variables found")
	}

	ui.Step(fmt.Sprintf("File: %s", ui.File(file)))
	ui.Step(fmt.Sprintf("Environment: %s", ui.Value(env)))
	ui.Step(fmt.Sprintf("Variables: %s", ui.Value(len(secrets))))

	repo, err := git.DetectRepo()
	if err != nil {
		ui.Error("Not in a git repository with GitHub remote")
		return err
	}
	ui.Step(fmt.Sprintf("Repository: %s", ui.Value(repo)))

	token, err := EnsureLogin()
	if err != nil {
		ui.Error(err.Error())
		return err
	}

	client := api.NewClient(token)
	ctx := context.Background()

	// Fetch current vault state to show preview
	var vaultSecrets map[string]string
	err = ui.Spin("Fetching current vault state...", func() error {
		resp, err := client.PullSecrets(ctx, repo, env)
		if err != nil {
			// Vault might not exist yet, that's ok
			if apiErr, ok := err.(*api.APIError); ok && apiErr.StatusCode == 404 {
				vaultSecrets = make(map[string]string)
				return nil
			}
			return err
		}
		vaultSecrets = parseEnvContent(resp.Content)
		return nil
	})

	if err != nil {
		if apiErr, ok := err.(*api.APIError); ok {
			ui.Error(apiErr.Error())
		} else {
			ui.Error(err.Error())
		}
		return err
	}

	// Calculate and show diff
	diff := calculatePushDiff(secrets, vaultSecrets)

	if diff.hasChanges() {
		ui.Message("")
		ui.Message("Changes:")
		for _, key := range diff.added {
			ui.DiffAdded(key)
		}
		for _, key := range diff.changed {
			ui.DiffChanged(key)
		}
		for _, key := range diff.removed {
			ui.DiffRemoved(key)
		}
		ui.Message("")
	} else {
		ui.Info("No changes detected")
	}

	// Confirm
	if !yes && ui.IsInteractive() {
		confirm, _ := ui.Confirm(fmt.Sprintf("Push %d secrets from %s to %s?", len(secrets), file, repo), true)
		if !confirm {
			ui.Warn("Push aborted.")
			return nil
		}
	} else if !yes {
		return fmt.Errorf("confirmation required - use --yes in non-interactive mode")
	}

	// Track push event
	analytics.Track(analytics.EventPush, map[string]interface{}{
		"repoFullName":  repo,
		"environment":   env,
		"variableCount": len(secrets),
	})

	var resp *api.PushSecretsResponse
	err = ui.Spin("Uploading secrets...", func() error {
		var err error
		resp, err = client.PushSecrets(ctx, repo, env, secrets)
		return err
	})

	if err != nil {
		analytics.Track(analytics.EventError, map[string]interface{}{
			"command": "push",
			"error":   err.Error(),
		})
		if apiErr, ok := err.(*api.APIError); ok {
			ui.Error(apiErr.Error())
			if apiErr.UpgradeURL != "" {
				analytics.Track(analytics.EventUpgradePrompt, map[string]interface{}{
					"reason":  "push_error",
					"command": "push",
				})
				ui.Message(fmt.Sprintf("Upgrade: %s", ui.Link(apiErr.UpgradeURL)))
			}
		} else {
			ui.Error(err.Error())
		}
		return err
	}

	ui.Success(resp.Message)
	if resp.Stats != nil {
		parts := []string{}
		if resp.Stats.Created > 0 {
			parts = append(parts, fmt.Sprintf("+%d created", resp.Stats.Created))
		}
		if resp.Stats.Updated > 0 {
			parts = append(parts, fmt.Sprintf("~%d updated", resp.Stats.Updated))
		}
		if resp.Stats.Deleted > 0 {
			parts = append(parts, fmt.Sprintf("-%d deleted", resp.Stats.Deleted))
		}
		if len(parts) > 0 {
			ui.Message(fmt.Sprintf("Stats: %s", strings.Join(parts, ", ")))
		}
	}

	dashboardURL := fmt.Sprintf("https://www.keyway.sh/dashboard/vaults/%s", repo)
	ui.Outro(fmt.Sprintf("Dashboard: %s", ui.Link(dashboardURL)))

	return nil
}

type envCandidate struct {
	file string
	env  string
}

func discoverEnvFiles() []envCandidate {
	entries, err := os.ReadDir(".")
	if err != nil {
		return nil
	}

	// Template files to exclude (not real secrets)
	excludeFiles := map[string]bool{
		".env.local":    true, // Local overrides
		".env.example":  true, // Template files
		".env.sample":   true,
		".env.template": true,
	}

	var candidates []envCandidate
	for _, entry := range entries {
		name := entry.Name()
		if strings.HasPrefix(name, ".env") && !excludeFiles[name] && !entry.IsDir() {
			candidates = append(candidates, envCandidate{
				file: name,
				env:  deriveEnvFromFile(name),
			})
		}
	}
	return candidates
}

func deriveEnvFromFile(file string) string {
	base := filepath.Base(file)
	if base == ".env" {
		return "development"
	}
	if strings.HasPrefix(base, ".env.") {
		return strings.TrimPrefix(base, ".env.")
	}
	return "development"
}

func parseEnvContent(content string) map[string]string {
	result := make(map[string]string)
	for _, line := range strings.Split(content, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		idx := strings.Index(line, "=")
		if idx == -1 {
			continue
		}
		key := strings.TrimSpace(line[:idx])
		value := line[idx+1:]

		// Remove surrounding quotes
		if len(value) >= 2 {
			if (value[0] == '"' && value[len(value)-1] == '"') ||
				(value[0] == '\'' && value[len(value)-1] == '\'') {
				value = value[1 : len(value)-1]
			}
		}

		if key != "" {
			result[key] = value
		}
	}
	return result
}

type pushDiff struct {
	added   []string // in local, not in vault (will be created)
	changed []string // in both, different values (will be updated)
	removed []string // in vault, not in local (will be deleted)
}

func (d *pushDiff) hasChanges() bool {
	return len(d.added) > 0 || len(d.changed) > 0 || len(d.removed) > 0
}

func calculatePushDiff(local, vault map[string]string) *pushDiff {
	diff := &pushDiff{}

	// Check local secrets against vault
	for key, localVal := range local {
		if vaultVal, exists := vault[key]; exists {
			if localVal != vaultVal {
				diff.changed = append(diff.changed, key)
			}
		} else {
			diff.added = append(diff.added, key)
		}
	}

	// Find vault-only secrets (will be removed)
	for key := range vault {
		if _, exists := local[key]; !exists {
			diff.removed = append(diff.removed, key)
		}
	}

	return diff
}
