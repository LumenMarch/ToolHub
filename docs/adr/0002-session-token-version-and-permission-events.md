# ADR-0002：会话 token_version 与权限/吊销实时事件

## 状态

Accepted（Phase-2）

## 决策

在 Phase-1 WebSocket 通知之上增加：

1. **`User.token_version`（整数，默认 0）** 作为会话世代。JWT（Cookie 与 Bearer）携带 `tv`；`get_current_user` 与 WS Cookie 鉴权均校验 `tv == user.token_version`，不匹配则 401 / 拒绝握手。
2. **事件**（仍为 notify-only，REST 为真相源）：
   - `permissions.updated` — 用户角色或角色权限变更后定向推送；客户端重新 `GET /users/me`，**不**强制登出。
   - `session.revoked` — `token_version` 递增后定向推送；客户端清本地用户态并停止 WS（可 best-effort 调 logout 清 cookie）。HTTP 401 仍是最终兜底。
3. **何时递增 `token_version`**：管理员停用用户、重置密码、删除用户前踢下线。普通 `/auth/logout` **只清 cookie**（单设备 UX），不递增。
4. **可选 Redis fan-out**：环境变量 `REDIS_URL`（pydantic-settings）有值且 `redis` 可选依赖可用、连接成功时，hub 经 Pub/Sub 跨进程广播；未配置 / 未安装 / 连接失败则**自动回落进程内 hub**，启动不失败。事件 JSON 契约不变。

## 背景

管理员改角色后，已打开的标签页权限守卫可能仍持有旧权限快照；停用或重置密码后，旧 JWT 在过期前仍可访问。需要轻量实时提示 + 服务端硬校验。

多 Worker 部署时，进程内 hub 无法把事件送到其它进程上的 WS；Redis 作为可选后端，避免单机开发硬依赖。

## 备选方案

| 方案 | 结论 |
|------|------|
| 权限变更也强制 revoke | 拒绝：体验差；权限刷新足够 |
| Logout 递增 token_version | 拒绝：会踢掉该用户全部设备 |
| Redis 硬依赖 | 拒绝：本地/单机无需 Redis |
| 短 TTL JWT 代替 version | 拒绝：停用后仍有窗口期 |

## 后果

- 既有 SQLite：启动时 `ensure_schema_compat()` `ALTER TABLE` 补 `token_version`（无 Alembic）。
- 可选依赖：`uv sync --extra redis` 或 `pip install 'backend[redis]'`。
- 多实例：所有实例共享同一 `REDIS_URL` 与 `SECRET_KEY`；envelope 带 `origin` 跳过本机回环。
- 前端 `AuthProvider` 订阅上述两事件；401 interceptor 仍保留。

## 与 ADR-0001 关系

补充 Phase-1「明确不做」中的 C2/C3，以及可选 Redis 多实例 fan-out。事件仍不推全量快照、不做 WS 命令通道。
