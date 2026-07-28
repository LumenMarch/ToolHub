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
npm run lint          # oxlint static analysis
npm run build         # tsc type-check + vite build
npx react-doctor      # React component diagnostics (run last)
```
