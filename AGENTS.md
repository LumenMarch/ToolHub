## Agent skills

### Issue tracker

Issues for this repo live on GitHub Issues (`gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Default canonical labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout — one `CONTEXT.md` + `docs/adr/` at repo root. See `docs/agents/domain.md`.

## 提交前检查

提交任何代码变更前，**必须**本地执行 CI 对应的验证与格式化命令，确保通过后再提交:

**前端** (`frontend/`):
```bash
npm run lint          # oxlint 静态检查
npm run build         # tsc 类型检查 + vite 构建
```

**后端** (`backend/`):
```bash
uv run ruff check .   # Ruff Linter
uv run ruff format .  # Ruff Formatter（自动修复格式）
```

**React Doctor**（最后跑）:
```bash
npx react-doctor       # React 组件诊断（前端目录下执行）
```
