# 1. Agent Skills

## 1.1. Issue Tracker

Issues for this repository live in GitHub Issues and must be managed with the
`gh` CLI. See `docs/agents/issue-tracker.md`.

## 1.2. Triage Labels

Use the canonical labels `needs-triage`, `needs-info`, `ready-for-agent`,
`ready-for-human`, and `wontfix`. See `docs/agents/triage-labels.md`.

## 1.3. Domain Documentation

The repository uses a single-context layout with one root `CONTEXT.md` and
architecture decisions under `docs/adr/`. See `docs/agents/domain.md`.

# 2. Authorization and Change Scope

- Do not commit, push, create a pull request, mark a pull request ready, merge,
  or change repository settings unless the user explicitly requests that
  action.
- Never commit directly to `main`. Create a focused branch from `origin/main`.
  Agents should use the `codex/<short-description>` prefix unless the user
  requests a different branch name.
- Keep each commit and pull request limited to one coherent concern. Exclude
  unrelated working-tree changes and user-owned files.
- Do not amend, reorder, squash, or rewrite commits created by another person
  unless the user explicitly requests it.
- Never bypass repository rules, required checks, or review requirements with
  administrator privileges.

# 3. Language Requirements

- Commit subjects and bodies must be written in English.
- Pull request titles and bodies must be written in English.
- Keep identifiers, command names, file paths, API names, and error messages in
  their original form.

# 4. Commit Rules

## 4.1. Signature and Structure

- Create signed commits with `git commit -S`.
- Use this subject format:

  ```text
  <type>(<scope>): <summary>
  ```

- The scope is optional. Use it only when it identifies a stable project area,
  such as `frontend`, `backend`, `upload`, `attendance`, or
  `asset-comparison`.
- Write the summary in the imperative mood, keep it concise, do not capitalize
  it unnecessarily, and do not end it with a period.

## 4.2. Allowed Types

Use one of the following types:

- `feat`: a substantial new user-facing capability
- `fix`: a correction for a real defect
- `docs`: documentation-only changes
- `update`: translation or content updates
- `upgrade`: dependency, runtime, or toolchain upgrades
- `change`: behavior changes that are neither a feature nor a defect fix
- `misc`: minor changes that do not fit another type
- `style`: formatting, naming, typo, or code-style-only changes
- `refactor`: internal restructuring without behavior changes
- `chore`: build, automation, repository, or maintenance work
- `perf`: measurable runtime or resource-usage improvements

## 4.3. Commit Body

- Add a body when the reason, risk, migration, or follow-up work is not obvious
  from the subject.
- Explain why the change is needed and what operators or developers must do
  after it lands. Do not repeat a line-by-line list of the diff.
- Use Markdown for structured details.
- Mention breaking changes, configuration changes, migrations, and manual
  deployment steps explicitly.
- Keep commits atomic and independently understandable.

# 5. Local Validation

Run `git diff --check` for every change before committing.

For backend code changes, run these commands from `backend/`:

```bash
uv run ruff check .
uv run ruff format .
```

For frontend code changes, run these commands from `frontend/`:

```bash
bun run lint
bun run build
bunx react-doctor
```

Run React Doctor last. Fix any regression introduced by the changed lines.

Run all backend and frontend checks when a change crosses both areas or affects
shared behavior. Documentation-only changes may skip code checks when they
cannot affect generated files, build configuration, or runtime behavior.

# 6. Pull Request Rules

## 6.1. Repository Enforcement

The `main` branch is governed by the active `Main Branch Protection` ruleset:

- changes must enter through a pull request;
- only squash merge is allowed;
- linear history is required;
- branch deletion and non-fast-forward updates are blocked on `main`;
- all review threads must be resolved;
- the pull request branch must be current with `main`;
- `Backend Ruff Check`, `Frontend Lint & Build`, and `react-doctor` are required
  status checks.

## 6.2. Branch Preparation

Create a branch from the latest remote default branch:

```bash
git fetch origin main
git switch -c codex/<short-description> origin/main
```

Before marking a pull request ready or merging it, synchronize it with `main`:

```bash
git fetch origin main
git rebase origin/main
```

Do not rebase or force-push as an automatic first step. If a published branch
must be updated after a rebase, use `git push --force-with-lease` only for a
branch owned by the current author and only after confirming that no
collaborator commits would be overwritten.

## 6.3. Pull Request Creation

- Run the applicable local validation before requesting review.
- Push the branch with `git push -u origin HEAD`.
- Open a draft pull request when work or validation remains. Open a ready pull
  request only when the implementation and local validation are complete.
- Use the same format for the pull request title as for a commit subject:

  ```text
  <type>(<scope>): <summary>
  ```

- Use a numbered Markdown body with these sections:

  ```markdown
  ## 1. Summary

  ## 2. Why

  ## 3. Validation

  ## 4. Risks and Rollback

  ## 5. Manual Steps
  ```

- Write `None` for an applicable section that has no content rather than
  silently omitting risks or manual steps.
- Link the originating issue with `Closes #<number>` when the pull request
  fully resolves it. Use `Refs #<number>` when it does not.
- Do not include secrets, credentials, private URLs, temporary debug output, or
  unrelated logs in the pull request body.

## 6.4. Review and Merge

- Before requesting final review, inspect the complete diff against
  `origin/main` and confirm that the pull request contains no unrelated files.
- Keep the pull request title and body polished and evergreen. The repository
  uses the pull request title and body as the final squash commit title and
  message.
- Wait for `Backend Ruff Check`, `Frontend Lint & Build`, and React Doctor to
  complete successfully.
- Resolve every actionable review comment and every review thread before
  merge.
- Obtain at least one approving maintainer review for non-trivial or
  collaborator-authored changes unless the repository owner explicitly
  authorizes a low-risk self-merge.
- Re-run affected local checks after resolving conflicts or making substantive
  review changes.
- Merge through GitHub with squash merge only. Do not push directly to `main`
  and do not create merge commits.
- Let GitHub delete the source branch automatically after merge.
