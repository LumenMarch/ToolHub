# ADR-0005:每工具独立授权(per-tool permission)采用增量细化而非重写或引入外部方案

## 1. 状态

Accepted

## 2. 日期

2026-08-10

## 3. 背景

ToolHub 是内网工具平台,当前全部工具仅由一个粗粒度权限 `tool:use` 控制(seed.py:21)。所有工具端点统一 `require_permission("tool:use")` + `require_tool_enabled("<tool_id>")` 双守卫:前者只区分"能否使用工具",后者只区分"工具是否全局启用",两者都与"哪个用户/角色能用哪个工具"无关。

随着接入部门增多,业务上出现"只给某些部门某些工具"的授权需求(例如财务部门可用资产核对、不能用密码生成)。为此评估三条路:

1. 重写一套全新权限系统;
2. 引入 GitHub 现成权限方案(Casbin / Oso / OpenFGA 等);
3. 在现有 RBAC 上增量细化(`tool:use` → `tool:<id>:use`)。

本 ADR 论证并采用第 3 条路。详细调研见《[权限细化调研报告](../research/permission-granularity.md)》。

## 4. 决策

### 4.1 保持自研 RBAC,不重写、不引入外部权限引擎

现有 User↔Role↔Permission 多对多、`resource:action` codename、Permission Push 通道(ADR-0002)已为 per-tool 细化预留机制;重写无收益。外部方案中唯一成熟可选的 Casbin 需要 model.conf PERM DSL 学习、policy 表与现有 Permission 表双轨(或自写 adapter)、`/users/me` 权限推送重接,成本大于收益;其余方案因停维护或过度设计被排除。

### 4.2 权限 codename 从 `tool:use` 细化为 `tool:<id>:use`

- 每个工具注册一条 codename,共 **11 条新 codename**(对应 tools.ts 的 11 个工具,含 2 个纯前端工具);
- 新工具默认按工具 id 注册权限(`tool:<new-tool-id>:use`),不依赖人工维护;
- 原 `tool:use` 已按"严格模式"移除(落地结果见 7.1):PERMISSIONS 中不再注册该 codename;存量库迁移时,持有 `tool:use` 的角色(含自定义角色)替换为全部工具权限,并清理无引用残留。4.6/4.7 已为纯前端工具与基础设施分别提供不依赖 `tool:use` 的独立方案。

### 4.3 后端新增 `require_tool_permission(tool_id)` 依赖

在 `backend/app/core/auth.py` 新增依赖工厂 `require_tool_permission(tool_id)`,组合既有两层校验:

- 权限校验:复用 `_PermissionChecker` 语义,校验 `tool:<id>:use`;
- 启用校验:复用 `_ToolEnabledChecker` 语义,校验 ToolMeta 启用开关。

工具端点守卫从 `require_permission("tool:use") + require_tool_enabled("<tool_id>")` 机械替换为 `require_tool_permission("<tool_id>")`,顺带补齐 5 个缺 `require_tool_enabled` 的端点(atlas_merge.py 3 个、attendance.py 2 个)。

### 4.4 存量库一次性迁移(新增 codename + 按角色语义映射)

`run_seed` 仅在 permissions 表为空时执行(幂等,`backend/app/seed.py:84`),存量库不会自动获得新 codename。因此:

- 新增显式迁移脚本,沿用 `ensure_schema_compat` 先例(`backend/app/db/session.py:33`,项目无 Alembic):为存量库插入 11 条 `tool:<id>:use` codename;
- 按角色语义映射:存量"工具使用者"角色补全全部工具权限,超级管理员同理,避免现用户失去工具访问;
- 迁移脚本幂等,重复执行无副作用。

### 4.5 前端同步修复管理入口判断与工具列表过滤

- **修复隐性 bug**:`AdminRoute.tsx:23-25` 与 `Layout.tsx:117` 的 `user.permissions.some((p) => p !== 'tool:use')` 在 per-tool 化后会把"拥有任一工具权限"误判为"可进控制台",改为按管理类权限(如 `user:read`、`role:read` 等)判断;
- **`useVisibleTools` 按 per-tool 权限过滤**:`useToolsMeta.ts:67` 的 `hasToolUse = permissions.includes('tool:use')` 改为按各工具 `tool:<id>:use` 过滤 `visibleTools`,工具列表按权限可见;
- **ToolGuard 保持只查启用开关**,权限过滤交由上游 `visibleTools` 完成。

### 4.6 纯前端工具仅前端过滤、无后端强制,接受该局限

`pwd-generator`、`image-to-pdf` 无后端端点,授权只能靠前端过滤(工具列表可见性),后端无法强制;接受该局限,并在前端明确提示"纯前端工具不受后端强制保护"。

### 4.7 upload/tools-meta 等基础设施定义为"拥有任一工具权限即放行"

上传(tus)与 `GET /tools-meta` 是所有工具共用的基础设施,不应绑定单一工具:

- 新增专用守卫函数(如 `require_any_tool_permission`),语义为"用户持有至少一条 `tool:<id>:use` 即放行";
- 替换 upload.py 6 个带守卫端点(`POST /tus` :100、`HEAD /tus/{upload_id}` :168、`PATCH /tus/{upload_id}` :193、`DELETE /tus/{upload_id}` :260、`POST /cache/resolve` :279、`GET /{upload_id}/info` :308)与 `GET /tools-meta`(`tools_meta.py:13`,守卫 :16)的 `require_permission("tool:use")`;
- `OPTIONS /tus`(:83,CORS 预检)与 `GET /hitokoto`(`sixty_seconds.py:79`)保持公开。

## 5. 备选方案

| 方案 | 说明 | 结论 |
|------|------|------|
| **重写全新权限系统** | 推翻自研 RBAC,另起炉灶 | **拒绝**:现有架构(三级 codename 可扩展、`require_tool_enabled` 已按工具参数化、`role_permissions` 支持任意数量权限、Permission Push 通道零改动)已支持目标,重写无收益。 |
| **Casbin** | 引入 pycasbin + SQLAlchemy/SQLite adapter,obj 用 tool_id 实现每工具授权 | **唯一可选但拒绝**:DSL 学习 + policy 表与 Permission 表双轨 + 权限推送重接,成本大于收益;仅当上级要求行业通用方案时再评估。 |
| **Keycloak / Casdoor** | 引入完整 IdP 管理认证与授权 | **拒绝**:完整 IdP 换掉整个认证体系,杀鸡用牛刀。 |
| **OPAL + OPA** | 引入策略分发服务 + 策略引擎 | **拒绝**:分布式策略体系不适合单机 10 个工具,过度设计。 |
| **SpiceDB** | Zanzibar 系,关系型授权 | **拒绝**:必须 Postgres/MySQL,无 SQLite,与项目直接冲突。 |
| **OpenFGA** | Zanzibar 系,开源 FGA | **拒绝**:SQLite 仅 beta,引入独立服务 + 新范式,10 个工具不值得。 |
| **维持粗粒度 `tool:use`** | 不做任何改动 | **拒绝**:无法满足部门级工具授权需求。 |

## 6. 后果与影响

### 6.1 改动面

- 后端约 13 个文件(含迁移与测试)、前端约 6 个文件,合计约 20 个文件;
- 35 个带守卫端点(28 工具端点 + 6 上传端点 + 1 个 tools-meta)替换守卫;
- 11 条新 codename + 1 个迁移脚本;
- 整体工作量以天计。

### 6.2 风险

- **seed 幂等迁移**:`run_seed` 只在空 permissions 表时执行,存量库必须走显式迁移脚本,漏写将导致新 codename 不存在、授权失效;
- **前端管理入口判断**:`AdminRoute`/`Layout` 的 `p !== 'tool:use'` 隐性依赖 per-tool 化后的权限集合,不同步修复会把工具用户误放进控制台;
- **纯前端工具无法后端强制**:`pwd-generator`、`image-to-pdf` 的授权仅前端过滤,存在被绕过浏览的可能,属可接受局限。

### 6.3 兼容性

- 存量角色"工具使用者"需映射到全部工具权限,否则现用户失去工具访问;
- 超级管理员同理补全 11 条工具权限;
- 迁移脚本幂等,可重复执行。

### 6.4 无需改动的部分

- 审计:`services/audit.py` 的 `log_action` 的 `action` 是自由字符串,与权限 codename 解耦;
- `permissions.updated` 推送通道:`sessions.py:67/:78` 与前端 `AuthProvider.tsx:45-51` 的重拉逻辑零改动复用;
- `role_permissions` 表结构:多对多天然支持新增 codename。

## 7. 落地结果(2026-08-10)

### 7.1 权限模型与角色(严格模式)

- **移除 `tool:use` 通配**:`backend/app/seed.py:33-43` 的 PERMISSIONS 现为 8 条管理权限 + `*TOOL_PERMISSIONS`(:42);`TOOL_PERMISSIONS` 定义于 :17-31,共 11 条 `tool:<id>:use`,与 `frontend/src/config/tools.ts` 的工具 id 一一对应;
- **ROLES**(`seed.py:46-63`):"超级管理员" = 8 条管理权限 + 11 条工具权限(`*TOOL_PERMISSION_CODENAMES`),"工具使用者" = 全部 11 条工具权限(`TOOL_PERMISSION_CODENAMES`)。

### 7.2 存量库迁移

- `seed.py:95` 新增 `migrate_per_tool_permissions()`(幂等,可重复执行):补齐缺失的 11 条 codename(:111-116);任何持有 `tool:use` 的角色(含自定义角色)替换为全部工具权限(:122-127);清理无引用残留的 `tool:use` 记录(:130-137);
- 启动链 `backend/app/main.py:22-29`:`create_all → ensure_schema_compat → run_seed → migrate_per_tool_permissions()` 自动执行,无需手工步骤;
- 测试覆盖:空库 no-op / 存量库升级 / 重复执行幂等。

### 7.3 守卫

- `backend/app/core/auth.py:203` 新增 `require_tool_permission(tool_id)`(权限 + 启用组合校验,403 文案区分两种失败原因);
- `auth.py:237` 新增 `require_any_tool_permission()`(持有至少一条 `tool:<id>:use` 即放行,供基础设施使用);
- `require_tool_enabled`(:157)保留但端点不再直接使用。

### 7.4 端点切换

- 35 个带守卫端点全部切换(28 工具端点 + upload 6 + tools-meta 1);
- 顺带补齐 5 个原本缺启用校验的端点:atlas_merge.py 3 个、attendance.py 2 个;
- 公开端点 `GET /hitokoto` 与 `OPTIONS /tus` 未改动。

### 7.5 前端

- `frontend/src/config/tools.ts` 11 个工具均新增 `permission` 字段(如 :48 `tool:pwd-generator:use`);
- `useToolsMeta` 按 per-tool 权限过滤可见工具,持有任一工具权限才请求 `/tools-meta`;
- `ADMIN_PERMISSIONS` 白名单(8 条管理权限,`frontend/src/hooks/use-permission.ts:8` 导出)替换 `AdminRoute.tsx:24-25` 与 `Layout.tsx:119` 原有的 `p !== 'tool:use'` 判断;
- `Roles.tsx` 权限勾选按 `tool:` 前缀分组展示。

### 7.6 验证结果

- 后端:`uv run ruff check/format` + `pytest` 130 passed;
- 前端:`bun run lint` + `bun run build` 通过;
- backend 全库无 `require_permission("tool:use")` 残留(复核确认)。

### 7.7 已知局限

纯前端工具(`pwd-generator`、`image-to-pdf`)仅注册 codename + 前端过滤,无后端强制(与 4.6 预期一致)。

## 8. 相关链接

- 领域术语说明:[CONTEXT.md](../../CONTEXT.md)(引用 *Permission Push*、*Session Revocation*、*Tools Meta*)
- [ADR-0002:会话 token_version 与权限/吊销实时事件](./0002-session-token-version-and-permission-events.md)(permissions.updated 推送通道)
- [ADR-0004:用户注册管理员审批机制](./0004-registration-approval.md)("不新增专用权限、避开 seed 幂等坑"的权衡与本 ADR 的迁移策略直接相关)
- [权限细化调研报告](../research/permission-granularity.md)
