# ADR-0001：实时通知采用 WebSocket（REST 为真相源）

## 状态

Accepted（Phase-1）

## 决策

ToolHub Phase-1 使用 **WebSocket** 作为登录后的实时通知通道；**REST 仍是唯一真相源**。WS 帧只携带事件类型与标识（如 `job_id` / `status`），客户端收到通知后通过既有 GET 接口拉取最新状态。服务端使用 **进程内 hub + `publish(event)`** 抽象，暂不引入 Redis。

认证与 HTTP 一致：同一会话 Cookie `toolhub_session`。每个登录用户一条（可多标签页多连接）WS，服务端按用户可见性过滤推送。

## 背景

资产核对任务需要状态/阶段刷新；管理端变更 Tools Meta 后，其它已登录标签页应尽快反映。既有方案依赖 1s 轮询，连接健康时应优先推送以降低延迟与请求量，断开时回退轮询。

## 备选方案

| 方案 | 说明 | 结论 |
|------|------|------|
| **SSE** | 单向服务推送，实现简单 | 可行，但后续可能需要双向扩展；与现有同源代理/生产反代对 WS 支持相当，选 WS 统一通道 |
| **WebSocket** | 双向长连接 | **采用**：单一 `/api/v1/realtime/ws`，可选客户端 ping |
| **WS 推全量快照** | 帧内携带完整 job JSON | 拒绝：与 REST 真相源重复，版本冲突难处理 |
| **Redis Pub/Sub** | 多进程/多实例 fan-out | Phase-1 不做；单进程 in-process hub 足够 |

## 后果

- 前端登录后建立一条 WS；登出断开；断线指数退避重连。
- 资产核对：WS 健康时暂停 1s 轮询，仅在 `job.updated` / `job.terminal` 时按 id 再 GET；WS 断开恢复轮询。
- Tools Meta：`tools_meta.updated` 触发 `tools-meta` 查询失效。
- 开发：Vite 代理 `/api/v1` 需 `ws: true`。
- 生产：与 API 同主机（后端托管或反代）；若使用 Cloudflare，需开启 WebSocket。
- 多 Worker / 多实例部署前必须替换进程内 hub（例如 Redis），否则跨进程收不到事件。

## Phase-1 范围

事件：

- `job.updated` — 资产核对任务状态/阶段变更（仅任务 owner）
- `job.terminal` — 终态（complete / failed / cancelled / expired）
- `tools_meta.updated` — 管理员变更工具元数据（广播已连接用户）
- 可选 `ping` / `pong` 心跳

明确不做：

- C2 权限变更推送、C3 会话吊销 / `token_version`
- tus 上传进度、WS 帧内全量快照、客户端经 WS 发业务命令
- Redis 或其它外部 broker

## Phase-2

- C2 / C3 与可选 Redis：见 [ADR-0002](./0002-session-token-version-and-permission-events.md)
