# ToolHub 设计与架构文档

本文档详细描述了 ToolHub 平台的技术架构、视觉设计语言以及扩展工作流。ToolHub 是一个专为高级用户设计的现代化、极简、高可扩展的工具聚合平台。

## 1. 核心技术栈

### 1.1. 前端架构 (Frontend)
- **框架**: React + TypeScript + Vite
- **路由**: React Router v7 (基于配置的动态路由与按需加载)
- **样式**: Tailwind CSS v4
- **动画**: 当前使用 GSAP (GreenSock Animation Platform) 编排动效；保留 `@gsap/react`，供后续 React 生命周期动画集成使用
- **图标**: `@phosphor-icons/react`
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

---

## 3. 设计语言与审美规范 (Design Language)

平台全面落实了 "Kinetic Brutalism"（动态粗野主义）风格，拒绝千篇一律的仪表盘（Anti-Dashboard）设计，具有极高视觉方差和干练的交互反馈。

### 3.1. 排版优先 (Massive Typography)
- **核心字体**: 自托管 `Noto Serif SC 700` 用于标题，`Geist Sans` 用于正文，`Geist Mono` 用于数据与系统标签。
- **视觉层级**: 采用夸张的超大标题（如 `text-[10vw]`、`text-7xl`），配合紧凑的字距 (`tracking-tighter`) 和缩减的行高 (`leading-[0.85]`)，使文字本身成为界面的核心视觉元素。
- **标签与微文案**: 大量使用全大写字母、宽字距的等宽字体（Mono）作为类别、状态的标识（如 `[ ID: USERNAME ]`、`OUTPUT STREAM`），营造系统层级的黑客/极客感。

### 3.2. 色彩与双模式 (Dual Theme)
平台支持明暗模式的无缝自动切换（或手动覆写）：
- **暗黑模式 (Dark)**:
  - 纯黑背景 (`#050505`) + 灰白文字 (`#f4f4f5`)。
  - 强调色：极具穿透力的 **酸性黄绿 / 荧光莱姆 (`#d4ff00`)**。
  - 噪点遮罩：全局覆盖 `4%` 透明度的胶片噪点 (Film Grain) 以增强物理质感。
- **明亮模式 (Light)**:
  - 纯白背景 (`#ffffff`) + 深墨色文字 (`#09090b`)。
  - 强调色：现代蓝 (`#3b82f6`)。
  - 噪点遮罩：降低至 `2%` 透明度，保持界面干净且不失细节。

### 3.3. 动态编排 (GSAP Choreography)
拒绝软绵绵的默认淡入，强调物理感、干脆和克制：
- **曲线设定**: 按动效职责选择缓动函数：标题切片使用 `power4.out`，内容与注册反馈使用 `expo.out`，次级淡入使用 `power3.out`，登录离场使用 `power3.inOut`，认证错误抖动使用 `elastic.out(1, 0.3)`。
- **文本切片 (Clip-Text)**: 大标题采用带有 `overflow: hidden` 遮罩的交错上浮 (`stagger`) 动画，呈现文字从地平线拉起的磅礴感。
- **触觉反馈**: 按控件权重采用克制的下沉反馈：主要操作使用 `active:scale-95`，图标按钮使用 `active:scale-90`，范围滑块拇指使用 `scale-75`；悬停反馈以颜色和位移变化为主。

### 3.4. 无框化表单 (Unboxed Forms)
- 废弃传统的输入框背景与全包围边框。
- 采用仅保留底部细线的无框设计 (`border-bottom`)。
- 输入框处于焦点时，底线高亮，并且上方占位符 (Label) 利用 CSS 实现流畅的上浮动画。

### 3.5. 页面结构体系 (Macrostructure Family)
- **登录页**: 采用 Awwwards Split Canvas，以品牌叙事区与认证操作区形成左右分屏。
- **主控台**: 采用纵向 Catalogue / Index 结构，以编号、名称、描述和状态构成可快速扫描的工具目录。
- **工具页**: 采用 Workbench 双栏控制台结构，将参数输入与结果输出明确分区。
- **工具页上下文**: 当前工具名称统一显示在全局页头的品牌标识右侧，工作区不重复展示大型页面标题；移动端允许工具名在品牌下方自然换行。
- **统一原则**: 各页面不强制复用同一种宏观布局，但必须共享动态粗野主义的排版、色彩、边界、间距与动效语言。

### 3.6. 设计令牌与样式入口 (Design Tokens)
- `frontend/src/styles/tokens.css` 是全局样式、字体声明和原始设计值的唯一来源。
- Tailwind CSS 的 `@theme inline` 负责将 CSS 变量映射为语义化令牌。
- 组件优先使用 `bg-background`、`text-foreground`、`text-primary`、`border-border` 等语义化类名，不直接重复声明原始颜色或字体族。
- 新增主题或调整视觉基础值时，应先修改 `tokens.css`，再由语义化令牌传递到组件。

### 3.7. 响应式与无障碍 (Responsive & Accessibility)
- **目标视口**: 至少验证 `320px`、`375px`、`414px` 和 `768px` 宽度，确保内容不产生意外的横向滚动。
- **文本安全**: 超大标题及其容器应使用 `min-width: 0` 与 `overflow-wrap: anywhere` 等约束，避免长文本撑破布局。
- **动效降级**: CSS 与 GSAP 动效必须响应 `prefers-reduced-motion`，在用户请求减少动态效果时关闭或简化位移、缩放与交错动画。
- **键盘焦点**: 可交互元素必须提供清晰的 `focus-visible` 状态，不以移除 outline 作为默认处理。
- **表单状态**: 错误信息与异步状态应通过恰当的 ARIA 属性关联和播报；视觉提示不能是唯一的信息载体。
- **页面边界**: `html` 与 `body` 保持横向溢出裁切，组件内部仍需从根源约束尺寸与换行。

---

## 4. 开发者指南：如何添加新工具

由于优秀的底层架构，添加新工具只需 3 步操作：

### 4.1. 前端：编写工具组件
在 `frontend/src/pages/tools/` 目录下创建你的组件文件（例如 `MyTool.tsx`）。请参考 `PwdGenerator.tsx` 保持设计风格的统一（如使用 `gsap-reveal` 类进行入场动画）。

### 4.2. 前端：注册工具配置
打开 `frontend/src/config/tools.ts`，在 `toolsConfig` 数组中添加一项：
```typescript
const MyTool = React.lazy(() => import('../pages/tools/MyTool'));

export const toolsConfig: ToolDefinition[] = [
  // ... 之前的工具
  {
    id: 'my-new-tool',
    name: '我的新工具',
    icon: Wrench, // 从 @phosphor-icons/react 导入合适的图标
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
