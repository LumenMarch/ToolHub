# 权限细化调研:每工具独立授权的必要性与方案评估

> 调研日期:2026-08-10
> 调研范围:现有 RBAC 现状、per-tool 细化改动面、GitHub 现成方案。
> 来源约束:仅读仓库代码 + gh CLI 实测 GitHub 仓库信息。

## 1. 结论摘要

**不需要重写权限系统,也不建议引入任何现成方案;在现有 RBAC 上增量细化即可。** 依据有两点:

1. 架构天然支持:权限 codename 是 `resource:action` 结构,可自然扩展为 `tool:<id>:use`;工具启用校验 `require_tool_enabled(tool_id)` 已按工具参数化;`role_permissions` 多对多表支持任意数量权限;Permission Push 通道与权限内容解耦,零改动复用。
2. 改动面以天计:后端约 13 个文件(含迁移与测试)、前端约 6 个文件,合计约 20 个文件、35 个带守卫端点、11 个新 codename + 1 个迁移脚本。

外部方案中唯一成熟可考虑的是 **Casbin**(官方 FastAPI 中间件 + SQLAlchemy/SQLite adapter,obj 用 tool_id 即可实现每工具授权),但需要学习 model.conf PERM DSL、policy 表与现有 Permission 表双轨或自写 adapter、`/users/me` 权限推送重接,迁移成本大于收益。其余方案(Oso/Polar、access-control、fastapi-permissions、OPAL/OPA、Keycloak/Casdoor、SpiceDB、OpenFGA、SQLAlchemy 生态、Django-guardian)均因停维护、技术栈不通或过度设计被排除。

## 2. 现状盘点

### 2.1 权限模型:9 条 codename

权限定义在 `backend/app/seed.py:15-23`,codename 为 `resource:action` 两级结构:

| codename | 描述 |
|---|---|
| `user:read` | 查看用户列表与详情 |
| `user:write` | 创建/修改/删除用户,分配角色 |
| `audit:read` | 查看审计日志 |
| `tool_meta:read` | 查看工具元数据 |
| `tool_meta:write` | 修改工具元数据(启用/禁用/排序) |
| `stats:read` | 查看统计面板 |
| `tool:use` | 使用工具 |
| `role:read` | 查看角色与权限定义 |
| `role:write` | 创建/编辑/删除角色,分配权限 |

关键机制:

- **权限创建唯一入口是 seed.py**:`run_seed` 仅在 permissions 表为空时执行(幂等,`backend/app/seed.py:65`),因此**存量库不会自动获得新增 codename**——这是迁移的最大坑。
- `crud_permission.py` 只有读取(`get_all_permissions` / `get_permission_by_codename` / `get_permissions_by_ids`),无动态创建 API。

### 2.2 角色模型:6 个角色

角色定义在 `backend/app/seed.py:27-44`:

| 角色 | 权限 codename |
|---|---|
| 超级管理员 | 全部 9 条 |
| 用户管理员 | `user:read`、`user:write`、`role:read` |
| 审计员 | `audit:read` |
| 工具管理员 | `tool_meta:read`、`tool_meta:write` |
| 统计查看者 | `stats:read` |
| 工具使用者 | `tool:use` |

### 2.3 工具清单:11 个工具

注册于 `frontend/src/config/tools.ts`:

| 工具 id | 名称 | 后端端点数 | 备注 |
|---|---|---|---|
| `pwd-generator` | 密钥生成器 | 0 | **纯前端工具**,无后端端点 |
| `string-analyzer` | 字符处理器 | 1 | |
| `color-picker` | 颜色工具 | 2 | |
| `qrcode` | 二维码生成 | 1 | |
| `asset-comparison` | 资产核对 | 12 | |
| `attendance-organizer` | 出勤资料整理 | 4 | |
| `atlas-merge` | AtlasLog Merge | 4 | |
| `health` | 健康指标 | 1 | |
| `calendar` | 日历 | 1 | |
| `sixty-seconds` | 60s 每日新闻 | 2 + 1 公开 | 另有公开端点 `GET /hitokoto` |
| `image-to-pdf` | 图片转 PDF | 0 | **纯前端工具**,无后端端点 |

合计 11 个工具、**28 个带守卫工具端点** + 1 个公开端点(`GET /hitokoto`,`backend/app/api/endpoints/sixty_seconds.py:79`,登录页可直接调用,无守卫)。

### 2.4 守卫不统一:5 个端点缺启用校验

鉴权核心在 `backend/app/core/auth.py`:

- `_PermissionChecker`(:101)+ `require_permission(codename)`(:124):校验 `get_user_permissions` 返回的权限 set(`backend/app/crud/crud_role.py:60-66`),与用户绑定。
- `_ToolEnabledChecker`(:138)+ `require_tool_enabled(tool_id)`(:157):查 ToolMeta 表全局启用开关,与用户无关。

所有工具端点统一 `require_permission("tool:use")` + `require_tool_enabled("<tool_id>")` 双守卫。**例外——以下 5 个端点只有 `require_permission("tool:use")`,缺少 `require_tool_enabled`:**

| 文件 | 端点 | 守卫行号 |
|---|---|---|
| `backend/app/api/endpoints/atlas_merge.py` | `GET /jobs/{job_id}` | :94,守卫 :97 |
| `backend/app/api/endpoints/atlas_merge.py` | `GET /results/{result_id}/download` | :106,守卫 :111 |
| `backend/app/api/endpoints/atlas_merge.py` | `DELETE /results/{result_id}` | :137,守卫 :140 |
| `backend/app/api/endpoints/attendance.py` | `GET /results/{result_id}/download` | :227,守卫 :230 |
| `backend/app/api/endpoints/attendance.py` | `DELETE /results/{result_id}` | :248,守卫 :251 |

基础设施说明:

- **upload.py**:6 个带守卫 tus 端点(仅 `tool:use`,无 `require_tool_enabled`):`POST /tus`(:100)、`HEAD /tus/{upload_id}`(:168)、`PATCH /tus/{upload_id}`(:193)、`DELETE /tus/{upload_id}`(:260)、`POST /cache/resolve`(:279)、`GET /{upload_id}/info`(:308);另有 `OPTIONS /tus`(:83)为 CORS 预检,公开无守卫。
- **`GET /tools-meta`**(`tools_meta.py:13`,守卫 :16):仅 `tool:use`,所有工具共用,主控台靠它拉取工具元数据覆盖层。

### 2.5 权限变更传播机制

角色、权限变更后由 `admin_roles.py`(通知点 :172、:214、:292)与 `admin_users.py`(:214)调用 `services/realtime/sessions.py` 的 `notify_permissions_updated`(:67)/ `notify_role_permissions_updated`(:78),推送 `permissions.updated` 事件;前端 `AuthProvider.tsx`(:45-51)收到后重拉 `GET /users/me`(见 ADR-0002)。

审计 `services/audit.py` 的 `log_action` 的 `action` 是自由字符串,与权限 codename 解耦,**无需改动**。

## 3. 现成方案对比

| 方案 | GitHub 仓库 | stars 概数 | 维护状态 | FastAPI 集成 | 额外依赖 | 迁移成本 | 本场景结论 |
|---|---|---|---|---|---|---|---|
| Casbin | apache/casbin-pycasbin | ~1.8k | 活跃(v2.8.0,2026-02) | 官方中间件 + SQLAlchemy/SQLite adapter | pycasbin + adapter | 中 | **唯一成熟可选**;需学 model.conf PERM DSL、policy 表双轨或写 adapter、权限推送重接,成本大于收益 |
| Oso / Polar | osohq/oso | — | 已停维护(README 首行 Deprecated,最后 release 2023-12-18;Polar 仓库 404) | 无 | oso | — | 排除 |
| access-control | 仓库已删除 | — | 2021 停更 | 无 | — | — | 排除 |
| fastapi-permissions | holgi/fastapi-permissions | ~650 | 2023-10 停更 | 原生 FastAPI | fastapi-permissions | 低 | 不引入;principal 字符串思路可借鉴 |
| OPAL + OPA/Cedar | permitio/opal | — | 活跃 | 中间件 | OPAL 服务 + OPA/Cedar | 高 | 为单机 10 个工具引入分布式策略分发,过度设计 |
| Keycloak | keycloak/keycloak | ~36k | 活跃 | 完整 IdP | Keycloak 服务 | 高 | 换掉整个认证体系,杀鸡用牛刀 |
| Casdoor | casdoor/casdoor | ~14k | 活跃 | 完整 IdP | Casdoor 服务 | 高 | 同上 |
| SpiceDB | authzed/spicedb | ~6.9k | 活跃 | gRPC client | Postgres/MySQL(无 SQLite) | 高 | 与项目 SQLite 直接冲突 |
| OpenFGA | openfga/openfga | ~5.6k | 活跃 | HTTP/gRPC | 独立服务(SQLite 仅 beta) | 中 | 独立服务 + Zanzibar 建模,10 个工具不值得 |
| SQLAlchemy 生态 | pypermission 等 | ~48 | 无 release、LGPL | 无 | — | — | 无成熟 RBAC 库 |
| Django-guardian | django-guardian/django-guardian | — | 活跃 | 绑定 Django ORM | Django | — | 技术栈不通 |

## 4. 为什么不需要重写

现有架构为 per-tool 细化预留了 4 条机制:

1. **codename 三级自然扩展**:`resource:action` 两级结构可平滑扩展为 `tool:<id>:use` 三级,不引入新范式;`tool:use` 本身就是这个体系里的占位符。
2. **启用校验已按工具参数化**:`require_tool_enabled(tool_id)`(`auth.py:157`)已按工具 id 区分,per-tool 授权只需把"权限校验 + 启用校验"组合成一个新依赖,不需要改中间件架构。
3. **`role_permissions` 支持任意数量权限**:User↔Role↔Permission 多对多,新增 11 个 codename 不改任何表结构。
4. **Permission Push 通道零改动**:推送事件内容与 codename 解耦,per-tool 化后前端照旧重拉 `/users/me`(ADR-0002)。

## 5. 增量细化改动面

### 5.1 目标形态

- 权限 codename 从 `tool:use` 细化为 `tool:<id>:use`,共 **11 个新 codename**(9 个有后端工具 + 2 个纯前端工具)。
- 后端守卫从 `require_permission("tool:use")` 机械替换为新增的 `require_tool_permission(tool_id)`(组合权限校验 + 启用校验),顺带补齐 5 个缺 `require_tool_enabled` 的端点。
- 前端按 per-tool 权限过滤工具列表与守卫。

### 5.2 改动文件清单

| 文件 | 改什么 | 量 |
|---|---|---|
| `backend/app/seed.py` | 新增 11 条 `tool:<id>:use`;超级管理员、工具使用者角色补全权限 | 小 |
| 存量库迁移脚本(沿用 `ensure_schema_compat` 机制,`backend/app/db/session.py:33`,无 Alembic) | 为存量库插入新 codename、按角色语义映射 | 小 |
| `backend/app/core/auth.py` | 新增 `require_tool_permission(tool_id)` 依赖 | 小 |
| 9 个工具端点文件 | 28 个端点守卫机械替换,顺带补 5 个缺 `require_tool_enabled` 的端点 | 中 |
| `backend/app/api/endpoints/upload.py`、`tools_meta.py` | 基础设施守卫改为"拥有任一工具权限即放行"的专用守卫函数 | 小 |
| `frontend/src/hooks/useToolsMeta.ts` | `hasToolUse` 判断改为按 per-tool 权限过滤 `visibleTools` | 中 |
| `frontend/src/components/guards/ToolGuard.tsx`、`AdminRoute.tsx`、`frontend/src/components/Layout.tsx` | 修复管理入口判断与工具可见性 | 小 |
| `frontend/src/pages/admin/Roles.tsx` | 权限勾选 UI 按 `tool:` 前缀分组 | 中 |
| 测试夹具 | 权限守卫与迁移用例更新 | 中 |

### 5.3 工作量估算

后端约 **13 个文件**(含迁移与测试)、前端约 **6 个文件**,合计约 **20 个文件**;**35 个带守卫端点**(28 工具端点 + 6 上传端点 + 1 个 tools-meta)需替换守卫;**11 个新 codename + 1 个迁移脚本**;整体工作量以天计。

## 6. 关键决策点(按风险排序)

1. **存量库迁移(风险最高)**:`run_seed` 仅在 permissions 表为空时执行(`seed.py:65`),存量库不会自动获得新 codename;必须写显式迁移脚本,沿用 `ensure_schema_compat` 先例(`db/session.py:33`)。新增 codename 后,存量角色"工具使用者"必须映射到全部工具权限,否则现用户将失去工具访问。
2. **前端管理入口隐性 bug**:`AdminRoute.tsx:23-25` 与 `Layout.tsx:117` 用 `user.permissions.some((p) => p !== 'tool:use')` 判断管理入口;per-tool 化后该判断会把"拥有任一工具权限"误判为"可进控制台",必须同步修复。
3. **5 个端点守卫补齐**:atlas_merge.py 3 个、attendance.py 2 个缺 `require_tool_enabled`,顺带修复。
4. **upload/tools-meta 基础设施权限语义**:定义为"拥有任一工具权限即放行",保留专用守卫函数,避免与业务工具耦合。
5. **纯前端工具授权局限**:`pwd-generator`、`image-to-pdf` 无后端端点,授权只能靠前端过滤,无后端强制,接受该局限。
6. **Roles.tsx 权限勾选分组**:per-tool 化后权限列表将超过 20 条,当前为扁平列表(`Roles.tsx:428-442` 平铺 `perm.codename`),需按 `tool:` 前缀分组展示。

## 7. 建议与落地顺序

1. **先写迁移脚本**:新增 11 个 codename + 存量角色语义映射(工具使用者 → 全部工具权限),确保存量库平滑升级。
2. **auth.py 新增 `require_tool_permission(tool_id)`** 依赖(组合权限校验 + 启用校验)。
3. **28 个工具端点守卫替换**(顺带补 5 个缺 `require_tool_enabled` 的端点),upload/tools-meta 换基础设施专用守卫。
4. **前端同步**:`useToolsMeta`、`ToolGuard`、`AdminRoute`、`Layout`、`Roles.tsx` 按 per-tool 权限过滤与分组。
5. **测试夹具更新**:权限守卫、迁移、前端可见性用例。
6. **若上级明确要求行业通用方案**,再评估 Casbin;当前结论为不引入。
