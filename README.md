Melange Updater
=========================

JavaScript GitHub Action (Node 24) that reimplements the deprecated Go `wolfictl update`. It updates melange YAML packages by discovering newer versions from Release Monitor, GitHub releases/tags (with git tag fallback), applying transforms/filters, and opening one PR per package. Manual-flagged packages are reported but not auto-applied.

Requirements
- Docker available on the runner (the action shells out to `cgr.dev/chainguard/melange:latest`).
- In the repository/org settings, enable “Allow GitHub Actions to create and approve pull requests.”
- Workflow permissions: `contents: write`, `pull-requests: write`, `issues: write`.
- Token: `GITHUB_TOKEN` with the above perms (or a PAT/STS token with `repo` scope if running from forks/restricted contexts).

What it does
- Finds melange package YAMLs (`package` + `update` blocks)
- Queries Release Monitor, GitHub releases/tags, and git tags (in that order) with optional prefixes/contains filters
- Applies strip/transform/ignore rules; compares versions (semver-aware when possible)
- For auto packages: uses the melange CLI (Docker) to bump version/epoch/expected-commit and opens one branch/PR per package
- For manual packages: skips file changes, logs them; errors per package create GitHub issues
- Supports preview/no-commit (apply locally only) and dry-run (report only)

Inputs (JavaScript action)
- `repository` (required): target repo `owner/repo`
- `token` (required): GitHub token with repo push/PR rights
- `release_monitor_token` (optional): token for Release Monitor
- `git_author_name` / `git_author_email` (required): author info for commits
- `github_labels` (optional): comma-separated labels for created PRs
- `repo_path` (optional): path to the checked-out repository; defaults to `GITHUB_WORKSPACE`

Behavior
- Single run may create multiple PRs (one per non-manual package needing update)
- Manual packages are not changed; they are logged as needing review
- If version discovery, push, or PR creation fails for a package, an issue is opened in the target repo (skipped in dry-run/preview)
- Requires a clean working tree before branching; validates `owner/repo` format

Usage: GitHub Actions workflow example
```yaml
jobs:
	update:
		runs-on: ubuntu-latest
		permissions:
			contents: write      # create branches/commits
			pull-requests: write # open PRs
			issues: write        # open issues on failures
		steps:
			- uses: glimmer-labs/melange-updater@main
				with:
					repository: your-org/your-repo
					token: ${{ secrets.GITHUB_TOKEN }}
					release_monitor_token: ${{ secrets.RELEASE_MONITOR_TOKEN }} # optional
					git_author_name: CI Bot
					git_author_email: ci@example.com
					github_labels: 'request-version-update,automated pr'
					preview: 'true'        # optional: apply locally only (no branch/commit/push/PR)
#					dry_run: 'true'        # optional: report only; no file changes
```

Usage: local testing (direct CLI)
```bash
cd .github/action/wolfictl-update
npm ci
node src/index.js \
	--target-repo your-org/your-repo \
	--token $GITHUB_TOKEN \
	--repo-path /path/to/checked/out/repo \
	--git-author-name "CI Bot" \
	--git-author-email "ci@example.com" \
	--preview            # optional: apply locally only
# add --dry-run to only report planned updates
```

Notes
- Preview mode applies changes locally without branch/commit/push/PR; dry-run prints planned updates only.
- One PR per package keeps changes isolated; branches are named `melange-update-<pkg>`.
- If PR creation is blocked, ensure repo/org setting “Allow GitHub Actions to create and approve pull requests” is enabled and the token has `pull-requests: write`.
- The action fails fast if Docker is unavailable on the runner.
