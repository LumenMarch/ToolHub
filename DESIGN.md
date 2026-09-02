# ToolHub 设计与架构文档

本文档详细描述了 ToolHub 平台的技术架构、视觉设计语言以及扩展工作流。ToolHub 是一个专为高级用户设计的现代化、极简、高可扩展的工具聚合平台。

## 1. 核心技术栈

### 1.1. 前端架构 (Frontend)
- **框架**: React + TypeScript + Vite
- **路由**: React Router v7 (基于配置的动态路由与按需加载)
- **样式**: Tailwind CSS v4 + shadcn/ui `radix-nova`
- **图标**: `lucide-react`
- **请求处理**: Axios (配置全局拦截器处理 JWT)

### 1.2. 后端架构 (Backend)
- **框架**: FastAPI
- **运行时**: Uvicorn
- **数据库**: SQLite + SQLAlchemy 2.0 (ORM)
- **认证体系**: JWT (JSON Web Tokens) + OAuth2 Password Bearer
- **密码哈希**: 原生 `bcrypt`

---

## 2. 架构设计模式

平台采用高度解耦的模块化设计，以支持未来无限制的工具扩展。

### 2.1. 动态加载引擎 (Frontend)
前端摒弃了传统的硬编码路由，采用“配置驱动”模式：
- **中心化配置**: `src/config/tools.ts` 是唯一的数据源。
- **懒加载**: 所有工具组件使用 `React.lazy()` 导入。Vite 会为每个工具进行 Code Splitting，确保平台在拥有成百上千个工具时，首屏加载依然极速。
- **自动注册**: 侧边栏索引、主控台网格、底层路由皆由配置数组在运行时动态生成。

### 2.2. API 聚合网关 (Backend)
后端遵循“网关-端点”的路由注册模式：
- **`main.py` 瘦身**: 核心入口文件仅负责挂载 CORS 和单一的路由网关。
- **`api_router.py`**: 作为统一的 API 聚合器（Gateway），所有的工具子路由（如 `string_tools.py`）仅需在此文件内通过 `include_router` 注册，实现业务逻辑与核心基础设施的物理隔离。

### 2.3. 敏感结果缓存 (Sensitive Result Cache)
- 出勤整理等包含员工资料的工具，其分析结果存放于统一任务产物存储（`TASK_ARTIFACT_ROOT`，磁盘），仅作为短时承接分析与下载的辅助缓存，不写入数据库；REST 仍是唯一真相源。
- 缓存键绑定当前认证用户并附带不可预测标识，下载与删除均校验归属。
- 设置明确有效期（TTL 600 秒）；`max_entries` / `max_bytes` 为进程内索引上限，磁盘总量由 TTL 过期与启动/周期清理兜底，重启或跨 Worker 时可能瞬时超出。
- 过期或淘汰的条目必须同步从磁盘删除（懒清理、进程内淘汰与启动/周期清理均执行磁盘删除）。
- 单进程假设：`TaskArtifactStore` 锁为进程内锁（`threading.RLock`），`publish_blob()` 检查-执行与容量淘汰的 `protected_paths` 不跨进程安全；多 Worker 共享同一 `TASK_ARTIFACT_ROOT` 卷前须补文件级锁与原子发布/淘汰。
- Windows 上 `os.chmod(0o700/0o600)` 仅切换只读属性、不改变继承 ACL；自定义 `TASK_ARTIFACT_ROOT` 须配置用户/管理员专属 ACL，否则按父目录 ACL 暴露。

---

## 3. 设计语言与审美规范 (Design Language)

可见界面采用 shadcn/ui `radix-nova` 默认视觉，决策见 `docs/adr/0006-shadcn-nova-visual-language.md`。不再使用 Kinetic Brutalism。

### 3.1. 排版与字标
- **字体**: Geist Variable 用于界面；Geist Mono 用于代码与等宽数据。标题与正文同一无衬线家族。
- **字标**: 主字「工具」（`font-semibold`），旁注「Tool」（`text-muted-foreground`）。`document.title` 用「工具」或「{页面} · 工具」。
- **层级**: 常规标题（如 Page Header 的 `text-2xl font-semibold`），不用展示级超大标题。

### 3.2. 色彩与主题
- 使用 nova 语义 token：`background`、`foreground`、`primary`、`muted`、`border`、`sidebar`。
- `primary` 为中性黑/白，不使用酸性黄绿或独立品牌色覆盖层。
- 主题为 `light | dark | system` 三态，根节点 class 驱动。
- 成功 / 危险 / 警告继续使用 `status-*` 语义 token，并伴随文字说明。

### 3.3. 动效
- 只保留组件自带过渡、toast、dialog 与 focus 反馈。
- 不为页面入场编排 GSAP 或标题切片。

### 3.4. 表单与控件
- 表单使用 shadcn `Field` / `FieldGroup` 与标准 `Input` / `Textarea` / `Select`。
- 主操作使用 `Button`；空状态使用 `Empty`；提示使用 `Alert`；加载使用 `Spinner` 或 `Skeleton`。
- 图标库为 Lucide；按钮内图标用 `data-icon`，不另加尺寸 class。

### 3.5. 页面结构
- **登录 / 待审批**: 居中 `Card`，无分屏叙事区。
- **用户区**: 顶栏启动器（字标、当前工具名、主题、通知、用户、退出）；无全站 Sidebar。
- **主控台**: 工具 `Card` 网格。
- **工具页**: Layout 根据 `toolsConfig` 渲染 Page Header，内容区 `p-6`；工具自行管理表单、表格与图表。
- **Admin**: 官方 `Sidebar` + `SidebarInset`。

### 3.6. 设计令牌与样式入口 (Design Tokens)
- `frontend/src/styles/tokens.css` 是全局样式、字体声明和原始设计值的唯一来源。
- Tailwind CSS 的 `@theme inline` 将 CSS 变量映射为语义化令牌。
- 组件使用 `bg-background`、`text-foreground`、`text-primary`、`border-border` 等语义类名。
- 调整视觉基础值时先改 `tokens.css`，不要在页面覆盖组件颜色或字号。

### 3.7. 响应式与无障碍 (Responsive & Accessibility)
- **目标视口**: 至少验证 `320px`、`375px`、`414px` 和 `768px` 宽度，确保内容不产生意外的横向滚动。
- **文本安全**: 标题与容器使用 `min-width: 0` 与必要的截断/换行，避免长文本撑破布局。
- **动效降级**: 过渡与动画响应 `prefers-reduced-motion`。
- **键盘焦点**: 可交互元素必须提供清晰的 `focus-visible` 状态。
- **表单状态**: 错误与异步状态通过 ARIA 关联；视觉提示不能是唯一信息载体。
- **Admin 移动端**: 使用 shadcn Sidebar 自带 Sheet，不为每个工具单独做移动重排。

### 3.8. 状态工作台与结果数据 (Stateful Workbench)
- 文件处理工具在同一工作区内依次呈现输入、处理中和结果状态，不让上传控件、等待反馈与结果内容同时竞争注意力。
- 无法获得真实进度时只显示持续处理状态，不模拟百分比或伪造阶段进度。
- 摘要与导出操作必须分区；导出失败不得清除已经完成的分析结果。
- 十列以上的数据在桌面端使用容器内滚动表格，在移动端重排为字段卡片，禁止让页面本身产生横向滚动。
- 状态颜色使用成功、危险、警告语义令牌，并同时提供文字说明，避免只依赖颜色传达结果。

---

## 4. 开发者指南：如何添加新工具

由于优秀的底层架构，添加新工具只需 3 步操作：

### 4.1. 前端：编写工具组件
在 `frontend/src/pages/tools/` 目录下创建组件。页面标题与描述由 Layout 从 `toolsConfig` 渲染，工具内不要再做超大 hero。控件使用 `frontend/src/components/ui` 中的 shadcn 组件。

### 4.2. 前端：注册工具配置
打开 `frontend/src/config/tools.ts`，在 `toolsConfig` 数组中添加一项：
```typescript
const MyTool = React.lazy(() => import('../pages/tools/MyTool'));

export const toolsConfig: ToolDefinition[] = [
  // ... 之前的工具
  {
    id: 'my-new-tool',
    name: '我的新工具',
    icon: Wrench, // 从 lucide-react 导入
    path: '/tools/my-new-tool',
    description: '一句简短的关于此工具的介绍。',
    component: MyTool
  }
];
```
*(注：保存后，导航菜单、主控台网格、和路由将被自动装载。)*

### 4.3. 后端：注册 API (如需)
1. 在 `backend/app/api/endpoints/` 目录下新建接口文件（如 `my_tool.py`），编写 FastAPI 路由。
2. 打开 `backend/app/api/api_router.py`，注册你的新路由：
```python
from app.api.endpoints import my_tool

# ...
api_router.include_router(my_tool.router, prefix="/tools/my_tool", tags=["my_tool"])
```
