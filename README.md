Melange Updater
=========================

Node.js 24 implementation of the deprecated Go `wolfictl update`. It scans melange YAML packages, discovers newer versions from Release Monitor and GitHub (releases/tags, with git tag fallback), applies version transforms/filters, and opens one PR per package update. Manual-flagged packages are reported but not auto-applied.

What it does
- Finds melange package YAMLs (`package` + `update` blocks)
- Queries Release Monitor, GitHub releases/tags, and git tags (in that order) with optional prefixes/contains filters
- Applies strip/transform/ignore rules; compares versions (semver-aware when possible)
- For auto packages: updates YAML in-place (preserves formatting) and opens one branch/PR per package
- For manual packages: skips file changes, logs them; errors per package create GitHub issues
- Supports preview/no-commit (apply locally only) and dry-run (report only)
- Optional commit signing via `gitsign`; when `use-gitsign: true`, commits/tags are signed so GitHub shows them as Verified

Inputs (composite action `./.github/action/wolfictl-update`)
- `repository` (required): target repo `owner/repo`
- `token` (required): GitHub token with repo push/PR rights
- `release_monitor_token` (optional): token for Release Monitor
- `git_author_name` / `git_author_email` (required): author info for commits
- `use-gitsign` (optional): `true` to sign commits/tags with gitsign (Verified on GitHub)
- `github-labels` (optional): comma-separated labels for created PRs

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
			- uses: glimmer-labs/wolfi/.github/action/wolfictl-update@main
				with:
					repository: your-org/your-repo
					token: ${{ secrets.GITHUB_TOKEN }}
					release_monitor_token: ${{ secrets.RELEASE_MONITOR_TOKEN }} # optional
					git_author_name: CI Bot
					git_author_email: ci@example.com
					use-gitsign: 'false' # set to 'true' to sign commits/tags (Verified)
					github-labels: 'request-version-update,automated pr'
```

Usage: local testing
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
- One PR per package keeps changes isolated; branches are named `wolfictl-update-<pkg>-<timestamp>`.
- `use-gitsign: true` signs commits/tags with gitsign so GitHub marks them Verified.
