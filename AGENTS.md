## Agent skills

### Issue tracker

Issues for this repo live on GitHub Issues (`gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Default canonical labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout — one `CONTEXT.md` + `docs/adr/` at repo root. See `docs/agents/domain.md`.

## Pre-commit Checks

Before committing any code change, you **must** run the following CI validation and formatting commands locally and ensure they pass:

**Backend** (`backend/`):
```bash
uv run ruff check .   # Ruff linter
uv run ruff format .  # Ruff formatter (auto-fix)
```

**Frontend** (`frontend/`):
```bash
bun run lint          # oxlint static analysis
bun run build         # tsc type-check + vite build
bunx react-doctor     # React component diagnostics (run last)
```

## PR Workflow

Before creating a PR, follow this checklist. Adapt when the situation warrants — these are guidelines, not rigid requirements.

1. **Sync with main** — rebase to keep history linear:
   ```bash
   git fetch origin main
   git rebase origin/main
   # Resolve conflicts if any, then:
   git push --force-with-lease
   ```

2. **Run pre-commit checks** (see above) — backend Ruff + frontend lint/build/react-doctor. Everything must pass.

3. **Create the PR** — generate a descriptive title and body from the commits:
   ```bash
   gh pr create --title "<type>(<scope>): <summary>" --body "..."
   ```
   Follow the commit format in CLAUDE.md for the title. The body should summarize what changed, why, and any manual steps needed (migrations, config changes, etc.). No rigid template.

4. **Wait for CI** — all status checks (CI Pipeline, React Doctor) must pass. After CI is green, the PR is ready for review/merge. The `main` branch is protected — merging happens through the PR, not by pushing directly.
