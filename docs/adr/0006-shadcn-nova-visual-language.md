# ADR-0006：废止 Kinetic Brutalism，采用 stock radix-nova

用户区与管理区的可见界面统一为 shadcn `radix-nova` 默认视觉（中性 `primary`、Geist、默认圆角、Lucide），不再维护 Kinetic Brutalism 作为产品设计语言。

粗野主义（超大衬线标题、酸性黄绿、胶片噪点、无框底线表单、页面级 GSAP、Phosphor）与已接入的 shadcn 组件纪律冲突：token 把 `--radius` 压成 0、暗色 `primary` 覆盖 nova、登录/工具页不走 `components/ui`，造成两套脸。辨识度收益低于长期维护成本。

## 考虑过的方案

- **只复位 CSS 变量**：不够。壳层与排版才是违和来源。
- **全站单一 Sidebar**：会改用户区信息架构（主控台启动器变成常驻导航），本次不做。
- **换 Base UI 或其它 named preset**：与现有 `radix-nova` 组件面无关，纯增迁移。

## 后果

- 用户区保持顶栏启动器；Admin 使用官方 `Sidebar`。路由、工具注册、上传与任务流程不变。
- 字标为「工具」+ muted「Tool」。图表与密表只换铬件。
- `DESIGN.md` §3 以本 ADR 为准。
