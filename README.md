# 1. ToolHub

ToolHub 是一个面向公司内部使用的工具平台。当前版本包含基础登录保护、工具中心，以及 CSV 数据对比工具。

## 2. 技术栈

- 前端：React、TypeScript、Vite、Tailwind CSS、shadcn/ui 风格组件
- 后端：FastAPI
- Python 依赖管理：uv
- JavaScript 依赖管理：pnpm

## 3. 项目结构

```text
ToolHub/
├── backend/        # FastAPI 接口、认证与工具服务
├── frontend/       # React 工具中心
└── README.md
```

## 4. 本地运行

### 4.1. 启动后端

```bash
cd backend
cp .env.example .env
uv sync
uv run uvicorn app.main:app --reload --port 8000
```

### 4.2. 启动前端

```bash
cd frontend
pnpm install
pnpm dev
```

访问 `http://localhost:5173`，使用 `backend/.env` 中配置的账号登录。

## 5. 环境变量

| 变量 | 用途 |
|---|---|
| `TOOLHUB_USERNAME` | 内部平台登录用户名 |
| `TOOLHUB_PASSWORD` | 内部平台登录密码 |
| `TOOLHUB_SECRET_KEY` | Cookie 签名密钥，生产环境必须替换 |
| `TOOLHUB_SESSION_MAX_AGE` | 登录有效期，单位为秒 |
| `TOOLHUB_COOKIE_SECURE` | HTTPS 环境设置为 `true` |
| `TOOLHUB_ALLOWED_ORIGINS` | 允许携带 Cookie 请求 API 的前端来源 |

## 6. 生产构建

前端构建完成后，FastAPI 会自动托管 `frontend/dist`：

```bash
cd frontend
pnpm build

cd ../backend
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
```
