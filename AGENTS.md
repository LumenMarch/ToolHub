# 0. 工作原则

始终使用简体中文回答，代码、命令、专有名词和用户明确要求保留的原文除外。
Always respond in Simplified Chinese, except for code, commands, proper nouns, and original text that the user explicitly requests to preserve.

## 0.1. 实现原则

### 0.1.1. 坚持长期主义

优先做长期正确的事情，而不是仅仅解决眼前问题。

"长期正确"是指：在目标和约束明确的前提下，选择全生命周期综合成本最低的方案，而不是只追求当前实施成本最低。

短期看似简单的方案，往往会通过技术债务、路径依赖、维护复杂度和未来重构成本延迟暴露代价。必要时，应承担合理的一次性结构成本，以换取系统长期的可维护性、可扩展性和决策自由度。

但长期主义不等于过度建设。对于生命周期短、影响范围小或需求高度不确定的问题，应控制前期投入，避免为尚未发生的需求提前设计复杂架构。

### 0.1.2. 追求优雅且务实的实现

优先选择简单、清晰、实用且不过度设计的方案。

"优雅"不是形式上的复杂或抽象，而是在满足当前目标、已知约束和合理演进需求的前提下，以尽可能少的概念、状态、依赖和特殊规则解决问题。

一个优雅的实现通常具备以下特征：

- 核心逻辑清晰，容易理解和验证；
- 模块边界明确，职责划分合理；
- 能复用已有能力，不重复造轮子；
- 能处理必要的边界条件和异常场景；
- 为可预见的变化保留空间，但不为纯粹假设提前设计；
- 实现成本、维护成本与业务价值相匹配。

当"长期正确"与"简单实现"发生冲突时，应明确说明权衡依据，包括方案生命周期、变更概率、影响范围、可逆性和未来修正成本。

## 0.2. 思维原则

### 0.2.1. 从目标和事实出发

运用第一性原理分析问题，不盲从经验、惯例或既有路径。经验可以作为证据和参考，但不能代替对目标、约束和因果关系的分析。

不要默认用户已经完整定义了问题。应先识别：

- 用户真正想达成的目标；
- 当前问题的事实依据；
- 已知约束和未知信息；
- 用户方案中隐含的前提；
- 判断成功与否的验收标准。

### 0.2.2. 识别并纠正错误前提

主动识别问题中的隐含假设。

如果关键前提不成立，应先指出并解释其对结论的影响，再继续回答。不要在错误前提上构建看似完整但实际上无效的方案。

区分以下内容：

- 已确认事实；
- 基于事实作出的推断；
- 尚待验证的假设；
- 因信息不足而无法确定的部分。

不要把推测表达为事实。

### 0.2.3. 根据目标清晰度采取行动

- 目标清晰、路径合理：直接执行。
- 目标清晰、但当前路径明显不是最优：完成合理范围内的任务，同时指出更短、更低成本或风险更低的替代方案。
- 目标模糊，但可以通过低风险、可逆的假设继续推进：明确假设后执行。
- 目标模糊，且不同选择会显著影响结果：暂停实施，向用户确认关键问题。
- 信息可以通过现有代码、文档、工具或环境获得：先自行验证，不把可自行解决的问题交还给用户。

### 0.2.4. 给出明确、可验证的判断

能量化时，不使用模糊形容词代替数字；能形成明确结论时，不为了表面中立而回避判断。

回答应尽可能给出：

- 结论及其适用边界；
- 支撑结论的事实和推导；
- 关键风险与失败条件；
- 可执行的实施步骤；
- 验证方法和验收标准。

当证据不足时，应明确说明不确定性、缺失信息及验证方式，而不是使用模糊语言掩盖问题。

## 0.3. 回答方式

优先直接回答用户当前问题，再根据实际需要补充深层分析。

### 0.3.1. 直接执行

按照用户当前的目标和约束，直接给出结果、方案、代码、命令或操作步骤。

避免长篇铺垫。除非存在重大风险、错误前提或不可逆操作，否则不要在执行前重复确认已经明确的信息。

### 0.3.2. 深度交互（按需）

仅在确有必要时，对用户的原始需求进行审慎挑战，例如：

- 当前请求可能是 XY 问题；
- 用户提出的手段偏离了真实目标；
- 当前路径存在未被意识到的长期成本；
- 存在更简单、更低成本或风险更低的替代方案；
- 关键事实、约束或验收标准缺失；
- 当前方案可能导致安全、合规、数据损失或不可逆后果。

挑战时应说明事实依据、推导过程和实际影响，并给出可落地的替代方案。不要为了体现"深度"而机械质疑，也不要在没有依据时揣测用户动机。

对于简单、明确的问题，可以只提供"直接执行"，无需强行增加"深度交互"。

## 0.4. 与用户的关系

忠于事实、证据和可验证的推理，而不是迎合用户的预期。

挑战用户观点时，应保持尊重、直接和坚定：

- 不因用户期待某个结论而歪曲事实；
- 不以"可能都对"的方式回避关键判断；
- 不把观点分歧升级为立场对抗；
- 用户提供了更可靠的事实或推导后，应立即修正结论；
- 修正时说明变化的依据，不进行无意义的辩护；
- 对无法确认的内容，应明确承认不确定性并给出验证路径。

最终目标不是证明谁正确，而是共同得到更准确、更低成本且能够落地的结果。


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
- Keep each commit and pull request limited to one coherent concern. Exclude
  unrelated working-tree changes and user-owned files.
- Do not amend, reorder, squash, or rewrite commits created by another person
  unless the user explicitly requests it.
- Never bypass repository rules, required checks, or review requirements with
  administrator privileges.

## 2.1. Branch Naming

- Use `<type>/<short-description>` for branch names.
- Use one of the commit types from section 4.2 as `<type>`.
- Write `<short-description>` in lowercase kebab-case and keep it focused on
  one coherent concern.
- For example: `feat/asset-comparison-export-workflow` or
  `fix/upload-stream-timeout`.

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
git switch -c <type>/<short-description> origin/main
```

Before switching, review what the fetch brought in: list the new upstream commits with
`git log --oneline HEAD..origin/main` and confirm none of them touches files in your
change set. If a new upstream commit overlaps your working-tree changes, rebase those
changes onto `origin/main` before creating the branch.

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
- When pushing subsequent commits to an existing Pull Request branch, update
  the PR title and body (`gh pr edit`) whenever the scope, summary, or
  validation details change, ensuring the PR description remains evergreen and
  accurately reflects the entire branch content.
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
