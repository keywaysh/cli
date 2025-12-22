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

var pullCmd = &cobra.Command{
	Use:   "pull",
	Short: "Download secrets from the vault to an env file",
	Long:  `Download secrets from the Keyway vault and save them to a local .env file.`,
	RunE:  runPull,
}

func init() {
	pullCmd.Flags().StringP("env", "e", "development", "Environment name")
	pullCmd.Flags().StringP("file", "f", ".env", "Env file to write to")
	pullCmd.Flags().BoolP("yes", "y", false, "Skip confirmation prompt")
	pullCmd.Flags().Bool("force", false, "Replace entire file instead of merging")
}

func runPull(cmd *cobra.Command, args []string) error {
	ui.Intro("pull")

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
	force, _ := cmd.Flags().GetBool("force")

	ui.Step(fmt.Sprintf("Environment: %s", ui.Value(env)))

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

	// Track pull event
	analytics.Track(analytics.EventPull, map[string]interface{}{
		"repoFullName": repo,
		"environment":  env,
	})

	var vaultContent string
	err = ui.Spin("Downloading secrets...", func() error {
		resp, err := client.PullSecrets(ctx, repo, env)
		if err != nil {
			return err
		}
		vaultContent = resp.Content
		return nil
	})

	if err != nil {
		analytics.Track(analytics.EventError, map[string]interface{}{
			"command": "pull",
			"error":   err.Error(),
		})
		if apiErr, ok := err.(*api.APIError); ok {
			ui.Error(apiErr.Error())
			if apiErr.UpgradeURL != "" {
				ui.Message(fmt.Sprintf("Upgrade: %s", ui.Link(apiErr.UpgradeURL)))
			}
		} else {
			ui.Error(err.Error())
		}
		return err
	}

	vaultSecrets := parseEnvContent(vaultContent)
	envFilePath := filepath.Join(".", file)

	// Read existing local file if it exists
	var localSecrets map[string]string
	localExists := false
	if data, err := os.ReadFile(envFilePath); err == nil {
		localExists = true
		localSecrets = parseEnvContent(string(data))
	} else {
		localSecrets = make(map[string]string)
	}

	// Calculate diff
	diff := calculateDiff(localSecrets, vaultSecrets)

	// Show diff if there are changes and file exists
	if localExists && diff.hasChanges() {
		// Show vault changes (added/changed)
		if len(diff.added) > 0 || len(diff.changed) > 0 {
			ui.Message("")
			ui.Message("Changes from vault:")
			for _, key := range diff.added {
				ui.DiffAdded(key)
			}
			for _, key := range diff.changed {
				ui.DiffChanged(key)
			}
		}

		// Show local-only variables
		if len(diff.localOnly) > 0 {
			ui.Message("")
			if !force {
				ui.Message("Not in vault (will be preserved):")
				for _, key := range diff.localOnly {
					ui.DiffKept(key)
				}
			} else {
				ui.Message("Not in vault (will be removed):")
				for _, key := range diff.localOnly {
					ui.DiffRemoved(key)
				}
			}
		}
		ui.Message("")
	}

	// Confirm if file exists
	if localExists {
		if !yes && ui.IsInteractive() {
			var promptMsg string
			if force {
				promptMsg = fmt.Sprintf("Replace %s with secrets from vault?", file)
			} else {
				promptMsg = fmt.Sprintf("Merge secrets from vault into %s?", file)
			}
			confirm, _ := ui.Confirm(promptMsg, true)
			if !confirm {
				ui.Warn("Pull aborted.")
				return nil
			}
		} else if !yes {
			return fmt.Errorf("file %s exists - use --yes to confirm", file)
		}
	}

	// Prepare final content
	var finalContent string
	if force || !localExists {
		// Replace mode: use vault content as-is
		finalContent = vaultContent
	} else {
		// Merge mode: start with vault secrets, add local-only secrets
		finalContent = mergeSecrets(vaultContent, localSecrets, vaultSecrets)
	}

	// Write file with restricted permissions
	if err := os.WriteFile(envFilePath, []byte(finalContent), 0600); err != nil {
		ui.Error(fmt.Sprintf("Failed to write file: %s", err.Error()))
		return err
	}

	lines := countEnvLines(finalContent)
	ui.Success(fmt.Sprintf("Secrets downloaded to %s", ui.File(file)))
	ui.Message(fmt.Sprintf("Variables: %s", ui.Value(lines)))

	if !force && len(diff.localOnly) > 0 {
		ui.Message(fmt.Sprintf("Kept %s local-only variables", ui.Value(len(diff.localOnly))))
	}

	ui.Outro("Secrets synced!")

	return nil
}

type secretsDiff struct {
	added     []string // in vault, not in local
	changed   []string // in both, different values
	localOnly []string // in local, not in vault
	unchanged []string // in both, same values
}

func (d *secretsDiff) hasChanges() bool {
	return len(d.added) > 0 || len(d.changed) > 0 || len(d.localOnly) > 0
}

func calculateDiff(local, vault map[string]string) *secretsDiff {
	diff := &secretsDiff{}

	// Check vault secrets against local
	for key, vaultVal := range vault {
		if localVal, exists := local[key]; exists {
			if localVal != vaultVal {
				diff.changed = append(diff.changed, key)
			} else {
				diff.unchanged = append(diff.unchanged, key)
			}
		} else {
			diff.added = append(diff.added, key)
		}
	}

	// Find local-only secrets
	for key := range local {
		if _, exists := vault[key]; !exists {
			diff.localOnly = append(diff.localOnly, key)
		}
	}

	return diff
}

func mergeSecrets(vaultContent string, local, vault map[string]string) string {
	// Start with vault content
	result := strings.TrimRight(vaultContent, "\n")

	// Find local-only secrets and append them
	var localOnlyLines []string
	for key, value := range local {
		if _, exists := vault[key]; !exists {
			// Preserve the original format
			localOnlyLines = append(localOnlyLines, fmt.Sprintf("%s=%s", key, value))
		}
	}

	if len(localOnlyLines) > 0 {
		result += "\n\n# Local variables (not in vault)\n"
		for _, line := range localOnlyLines {
			result += line + "\n"
		}
	} else {
		result += "\n"
	}

	return result
}

// countEnvLines counts non-empty, non-comment lines in env content
func countEnvLines(content string) int {
	count := 0
	for _, line := range strings.Split(content, "\n") {
		line = strings.TrimSpace(line)
		if line != "" && !strings.HasPrefix(line, "#") {
			count++
		}
	}
	return count
}
