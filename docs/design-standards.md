# 1. 通用设计规范

本文是一套可直接用于 Web、桌面与移动端产品的设计规范。默认值来自紧凑型桌面产品的实践，按 4px 网格组织；采用时只需要替换品牌色与字体，其余规则可以原样使用。

## 1.1 适用范围

适用于：

- 中后台、开发者工具、桌面客户端、管理面板；
- 需要同时支持亮色/暗色、键盘操作和多语言的界面；
- 有设计系统但缺少成文规范的团队。

不适用于强品牌营销页、内容阅读站或游戏界面；这些场景可以在第 3 章替换 token 后复用组件与可访问性规则。

## 1.2 规范等级

| 关键词 | 含义 |
| --- | --- |
| 必须 | 违反即视为缺陷，评审不通过 |
| 应该 | 默认做法；偏离时需要在 PR 或设计说明中写明理由 |
| 可以 | 可选做法，不影响一致性 |

## 1.3 如何采用

1. 复制 3.3 的 token 模板为 `tokens.css`，替换品牌色、字体和圆角。
2. 选择密度：`compact`（桌面工具）、`comfortable`（内容型 Web）或 `touch`（触控）。见 4.3。
3. 按第 5 章建立组件清单；每个组件只实现规范列出的状态。
4. 把第 7 章的可访问性要求和第 11 章的评审清单接入代码评审。
5. 在 CI 中加入视觉回归、键盘走查和多语言截图；见 10.5。

## 1.4 调整原则

- 品牌层只覆盖 token，不覆盖组件内部样式。
- 默认字号偏桌面紧凑；内容型 Web 把 `--text-base` 调到 14–16px，并同步调整行高。
- 默认色板是中性灰加靛蓝主色；替换主色时保留明暗两套对比度。
- 间距、圆角、动效时长可以整体缩放，但不要为单个页面发明新刻度。

# 2. 设计原则

1. **界面安静，信息优先。** 大面积使用中性色；颜色留给主操作、状态和数据。
2. **一个主操作。** 每个视图只有一个视觉上最强的主要动作，其余动作降级为次级或幽灵按钮。
3. **状态必须可读。** 颜色、文字、形状至少两种信号；不能只靠色相传达状态。
4. **控件像控件。** 可点击元素有明确的悬停、按下、焦点和禁用状态；不可点击元素不要伪装成按钮。
5. **动效解释变化。** 动效用于表达层级、方向和因果关系，不用于装饰；时长短、距离小、可关闭。
6. **默认可逆。** 破坏性操作先确认；未保存内容受保护；失败时保留上一次成功状态。
7. **平台原生优先。** 尊重系统标题栏、字体、滚动条、触控习惯和减少动效设置。
8. **可访问性是功能。** 键盘、屏幕阅读器、缩放、色盲和高对比度模式都是一等用户。

# 3. Design tokens

## 3.1 命名与分层

采用三层 token，组件只消费第二层：

| 层级 | 示例 | 说明 |
| --- | --- | --- |
| Primitive | `--blue-500`、`--gray-100` | 原始色值，只用于定义语义 token |
| Semantic | `--color-accent`、`--color-danger` | 表达用途，随主题切换 |
| Component | `--button-height`、`--field-radius` | 组件局部变量，可由语义 token 派生 |

命名格式：`--<类别>-<语义>-<变体>`。例如 `--color-text-muted`、`--space-4`、`--radius-lg`、`--duration-fast`。

必须：

- 组件样式只使用语义 token 或组件 token。
- 不在组件里写裸十六进制色值、魔法间距或一次性阴影。
- 需要透明度时用 `color-mix(in srgb, var(--color-accent) 12%, transparent)`。

## 3.2 颜色规则

- 表面分三级：`--color-bg`（页面底）、`--color-surface`（卡片/输入框）、`--color-surface-2`（次级表面/悬停底）。
- 文字分四级：`--color-text`（主）、`--color-text-2`（次）、`--color-text-muted`（说明）、`--color-text-faint`（占位/最弱）。
- 主色用于主操作、选中、焦点和链接；不要用主色做大面积背景。
- 语义色成对使用：强色用于文字/图标，`-soft` 用于底色。
- 暗色主题不是简单反相：主色要提亮，`--color-on-accent` 改为深色，阴影更重，边框更弱。
- 正文对比度至少 4.5:1；大号文字至少 3:1；控件边界和焦点环至少 3:1。
- 图表使用独立的 7 色序列；色盲模式切换到 Okabe–Ito 调色板。
- 状态不能只靠颜色：同时使用图标、文字、线型或形状。

## 3.3 Token 模板

以下文件可直接复制。品牌色、字体和圆角按项目替换；其余默认值可原样使用。

```css
:root {
  color-scheme: light dark;

  /* ---------- color: light / dark ---------- */
  --color-bg: light-dark(#f5f6f8, #141518);
  --color-surface: light-dark(#ffffff, #1d1f24);
  --color-surface-2: light-dark(#f0f2f5, #24272d);
  --color-surface-3: light-dark(#e8ebf0, #2c3038);

  --color-border: light-dark(#dfe3e9, #333841);
  --color-border-subtle: light-dark(#eceff3, #2a2e35);

  --color-text: light-dark(#17191d, #f0f2f5);
  --color-text-2: light-dark(#4b515a, #c3c8d0);
  --color-text-muted: light-dark(#6f7680, #949aa4);
  --color-text-faint: light-dark(#9aa1ab, #6b717b);

  --color-accent: light-dark(#4f46e5, #a5b4fc);
  --color-accent-hover: light-dark(#4338ca, #c7d2fe);
  --color-accent-soft: light-dark(#eef0ff, #2a2d48);
  --color-on-accent: light-dark(#ffffff, #14162a);
  --color-selection: light-dark(#e8eaff, #343956);

  --color-success: light-dark(#16803c, #6ee7a8);
  --color-success-soft: light-dark(#e6f5ec, #173326);
  --color-warning: light-dark(#a15c07, #f5c26b);
  --color-warning-soft: light-dark(#fdf2df, #3a2d17);
  --color-danger: light-dark(#c53030, #ff9b93);
  --color-danger-soft: light-dark(#fdecec, #3d2020);
  --color-info: light-dark(#1d4ed8, #93c5fd);
  --color-info-soft: light-dark(#e8efff, #1b2b45);

  --color-focus: var(--color-accent);

  /* ---------- chart series ---------- */
  --chart-1: light-dark(#4f46e5, #a5b4fc);
  --chart-2: light-dark(#0ea5e9, #7dd3fc);
  --chart-3: light-dark(#10b981, #6ee7b7);
  --chart-4: light-dark(#f59e0b, #fcd34d);
  --chart-5: light-dark(#ec4899, #f9a8d4);
  --chart-6: light-dark(#8b5cf6, #c4b5fd);
  --chart-7: light-dark(#64748b, #94a3b8);

  /* ---------- typography ---------- */
  --font-sans: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue",
    Arial, "Noto Sans", "PingFang SC", "Microsoft YaHei UI", sans-serif;
  --font-mono: ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono",
    monospace;

  --text-2xs: 10px;
  --text-xs: 11px;
  --text-sm: 12px;
  --text-base: 13px;
  --text-md: 15px;
  --text-lg: 18px;
  --text-xl: 22px;
  --text-2xl: 28px;
  --text-3xl: 36px;

  --leading-tight: 1.2;
  --leading-base: 1.45;
  --leading-relaxed: 1.6;

  --weight-regular: 400;
  --weight-medium: 500;
  --weight-semibold: 600;
  --weight-bold: 650;

  /* ---------- spacing ---------- */
  --space-0: 0;
  --space-px: 1px;
  --space-0-5: 2px;
  --space-1: 4px;
  --space-1-5: 6px;
  --space-2: 8px;
  --space-2-5: 10px;
  --space-3: 12px;
  --space-3-5: 14px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-10: 40px;
  --space-12: 48px;
  --space-16: 64px;

  /* ---------- radius ---------- */
  --radius-xs: 3px;
  --radius-sm: 5px;
  --radius-md: 7px;
  --radius-lg: 10px;
  --radius-xl: 14px;
  --radius-2xl: 18px;
  --radius-full: 999px;

  /* ---------- elevation ---------- */
  --shadow-sm: 0 1px 2px light-dark(rgb(0 0 0 / .06), rgb(0 0 0 / .4)),
    0 0 0 1px light-dark(rgb(0 0 0 / .04), rgb(255 255 255 / .05));
  --shadow-md: 0 8px 24px light-dark(rgb(20 22 30 / .12), rgb(0 0 0 / .5)),
    0 2px 8px light-dark(rgb(20 22 30 / .06), rgb(0 0 0 / .3)),
    0 0 0 1px light-dark(rgb(20 22 30 / .08), rgb(255 255 255 / .08));
  --shadow-lg: 0 24px 60px light-dark(rgb(0 0 0 / .28), rgb(0 0 0 / .65)),
    0 0 0 1px light-dark(rgb(0 0 0 / .1), rgb(255 255 255 / .1));
  --shadow-focus: 0 0 0 3px color-mix(in srgb, var(--color-focus) 24%, transparent);

  /* ---------- motion ---------- */
  --duration-fast: 120ms;
  --duration-base: 180ms;
  --duration-slow: 240ms;
  --duration-overlay: 320ms;
  --ease-standard: cubic-bezier(.2, .8, .2, 1);
  --ease-enter: cubic-bezier(.16, 1, .3, 1);
  --ease-exit: cubic-bezier(.4, 0, .7, .2);

  /* ---------- layout ---------- */
  --control-sm: 24px;
  --control-md: 28px;
  --control-lg: 32px;
  --row-compact: 40px;
  --row-comfortable: 48px;
  --row-height: var(--row-compact);
  --control-height: var(--control-md);
  --page-gutter: var(--space-4);
  --touch-target: 44px;
  --content-max: 1200px;
  --sidebar-breakpoint: 1024px;

  /* ---------- z-index ---------- */
  --z-sticky: 10;
  --z-dropdown: 30;
  --z-overlay: 40;
  --z-modal: 50;
  --z-toast: 60;
  --z-tooltip: 70;
}

/* 显式主题：light-dark() 会跟随 color-scheme，因此只切换它即可。
   system 不带 data-theme，按系统偏好。 */
:root[data-theme="dark"] { color-scheme: dark; }
:root[data-theme="light"] { color-scheme: light; }

/* 色盲友好的顺序色（Okabe–Ito） */
:root[data-colorblind="1"] {
  --chart-1: light-dark(#0072b2, #56b4e9);
  --chart-2: light-dark(#e69f00, #fbbf24);
  --chart-3: light-dark(#009e73, #2dd4bf);
  --chart-4: light-dark(#d55e00, #fb7185);
  --chart-5: light-dark(#cc79a7, #e879f9);
  --chart-6: light-dark(#56b4e9, #f0e442);
  --chart-7: light-dark(#64748b, #94a3b8);
}
```

实现提示：

- `light-dark()` 需要 Safari 17.5+、Chrome 123+、Firefox 120+。更旧的运行时用 `@supports not (color: light-dark(#000, #fff))` 回退：在媒体查询与 `[data-theme="dark"]` 中各重复一份暗色值，或用构建脚本生成。
- 新增 token 时，亮色值、暗色值、色盲覆盖三处一起检查。
- 组件不要覆盖 `--color-*`；需要局部差异时新增组件 token。
- 暗色下若某个图表色对比不足，提亮 10–15% 或加深色描边；不要只调整图例。

## 3.4 排版规则

| 场景 | 字号 | 行高 | 字重 |
| --- | --- | --- | --- |
| 正文 | `--text-base` | `--leading-base` | 400 |
| 次级说明 | `--text-sm` | 1.45 | 400 |
| 行主名称 | `--text-base` | 1.35 | 500 |
| 控件/按钮 | `--text-sm` | 1.2 | 400–500 |
| 字段标签 | `--text-xs` | 1.2 | 400 |
| 徽章 | `--text-2xs` | 1.2 | 600，全大写，`letter-spacing: .04em` |
| 页面标题 | `--text-lg` | `--leading-tight` | 600 |
| 强调标题 | `--text-md` | 1.3 | 650 |
| KPI 数字 | `--text-xl`–`--text-2xl` | 1.15 | 600 |
| 大号统计 | `--text-xl` | 1.2 | 600 |
| 巨型百分比 | `--text-3xl` | 1.1 | 600 |

- 数字使用 `font-variant-numeric: tabular-nums`；金额、百分比、时间、坐标必须等宽。
- 标题使用负字距 `-0.01em` 到 `-0.035em`；正文和控件保持正常字距。
- 不要用字重 700 做常规强调；500/600 足够。
- 内容型 Web 把正文提升到 14–16px；后台工具保持 13px 左右。
- 任何文本容器都要允许换行；禁止用固定高度裁切多语言文案。

## 3.5 间距与密度

- 以 4px 为主网格，2px 用于微观对齐。
- 组件内部：4–8px；组件之间：8–16px；区块之间：24–32px；页面边缘：16–24px。
- 同一视图内保持一种密度；不要在列表行之间混用 32px 和 48px。
- 规则：间距只能取 token；14px、18px 这类值仅用于光学修正，并在组件内定义为局部变量。

| 密度 | 行高 | 控件高 | 页面间距 | 适用 |
| --- | --- | --- | --- | --- |
| `compact` | 40px | 24–28px | 12–16px | 桌面工具、托盘面板、数据表 |
| `comfortable` | 48px | 32–36px | 16–24px | 内容型 Web、后台 |
| `touch` | 48–56px | 44px+ | 16px | 手机、平板 |

## 3.6 圆角、边框与阴影

| 元素 | 圆角 |
| --- | --- |
| 标签、徽章 | `--radius-xs`–`sm` |
| 按钮、输入框 | `--radius-sm`–`md` |
| 卡片、列表 | `--radius-lg` |
| 弹层、菜单 | `--radius-md`–`lg` |
| 对话框 | `--radius-xl`–`2xl` |
| 胶囊、开关 | `--radius-full` |

- 边框统一 1px；分隔线用 `--color-border-subtle`，外框用 `--color-border`。
- 卡片默认不投影，只用边框；浮层使用 `--shadow-md`；对话框使用 `--shadow-lg`。
- 焦点环使用 `--shadow-focus` 或 `outline: 2px solid var(--color-focus)`，并留 1–2px offset。
- 暗色主题的阴影更重、边框更弱，避免"糊成一片"。

## 3.7 动效

| 场景 | 时长 | 缓动 |
| --- | --- | --- |
| 悬停、颜色、透明度 | `--duration-fast` | `--ease-standard` |
| 按下、选中、滑块 | `--duration-base` | `--ease-standard` |
| 页面/视图进入 | `--duration-slow` | `--ease-standard` |
| 弹层、对话框进入 | `--duration-overlay` | `--ease-enter` |
| 弹层、对话框退出 | 180–220ms | `--ease-exit` |

- 距离保持小：视图进入 4–8px，弹层 6–10px。
- 按下反馈用 `scale(.96–.98)`；纯图标可用 `.9`。
- 不弹跳、不回弹、不无限循环，除非是明确的加载指示。
- `prefers-reduced-motion: reduce` 下只保留淡入，去掉位移、旋转、缩放和循环动画。
- 动画必须在页面不可见时暂停；不要用动画掩盖加载失败。

## 3.8 层级

| 层 | z-index | 说明 |
| --- | --- | --- |
| 页面内容 | 0 | 常规流 |
| 吸顶/粘性 | `--z-sticky` | 表头、工具栏 |
| 下拉/菜单 | `--z-dropdown` | 触发器附近 |
| 遮罩 | `--z-overlay` | 模态背景 |
| 模态 | `--z-modal` | 对话框、抽屉 |
| 通知 | `--z-toast` | 全局提示 |
| 工具提示 | `--z-tooltip` | 最上层 |

规则：

- 浮层在触发它的 stacking context 内渲染；需要跨模态时使用 portal，并把 z-index 提到模态之上。
- 不要用 `z-index: 9999` 解决问题；先检查是否创建了新的 stacking context。
- 模态打开时背景必须 `inert` 或 `aria-hidden`，不能只靠遮罩挡住点击。

# 4. 布局与响应式

## 4.1 断点

| 断点 | 典型布局 |
| --- | --- |
| `< 480px` | 单列；底部操作栏；全屏对话框 |
| `480–767px` | 单列；可折叠筛选；抽屉式导航 |
| `768–1023px` | 两列；顶部导航；紧凑侧栏 |
| `1024–1279px` | 固定侧栏；三列内容 |
| `≥ 1280px` | 侧栏 + 主内容 + 可选辅助栏 |

- 断点按内容需要设置，不按设备型号。
- 至少测试 360、480、768、1024、1280、1440 六个宽度。
- 侧栏在 1024px 以下折叠为顶部导航或抽屉；不要在窄屏保留固定侧栏。

## 4.2 内容宽度

- 主内容最大宽度 `--content-max`（默认 1200px），居中。
- 长文本段落限制在 60–75 个字符宽。
- 数据表允许横向滚动，但页面本身不能横向滚动。
- 居中容器使用 `margin-inline: auto` 加 `padding-inline: clamp(16px, 4vw, 32px)`。

## 4.3 密度切换

```css
:root[data-density="compact"] {
  --row-height: var(--row-compact);
  --control-height: var(--control-md);
  --page-gutter: var(--space-4);
}

:root[data-density="comfortable"] {
  --row-height: var(--row-comfortable);
  --control-height: var(--control-lg);
  --page-gutter: var(--space-6);
}

:root[data-density="touch"] {
  --row-height: 56px;
  --control-height: var(--touch-target);
  --page-gutter: var(--space-4);
}
```

- 桌面工具默认 `compact`；内容型 Web 默认 `comfortable`。
- 密度切换不能改变文字大小，只改变间距和控件高度。
- 触控设备始终使用 44px 点击目标，即使视觉高度更小。

## 4.4 指针与触控

- 触控目标最小 44×44px（推荐）；WCAG 2.2 的底线是 24×24px。
- 视觉控件可以只有 24px 高，但用伪元素或 padding 扩大命中区域。
- `(hover: hover)` 下可以隐藏次要操作，悬停或键盘焦点时显示；`(hover: none)` 下必须常显。
- 拖拽、滑动必须提供按钮或键盘替代。
- 不要依赖右键菜单作为唯一入口。

## 4.5 平台适配

| 平台 | 适配点 |
| --- | --- |
| macOS | 尊重系统标题栏和红绿灯；滚动条可用 overlay；字体走 SF |
| Windows | 使用 Segoe UI；标题栏已有品牌时页面内不重复；WebView2 上避免全窗口模糊 |
| Linux | GTK/WebKit 下自绘滚动条和标题栏；半透明窗口可能重绘异常，必要时改为不透明 |
| 移动 Web | 输入框字号 ≥16px 防止自动缩放；使用 `env(safe-area-inset-*)`；standalone 模式单独处理主题色 |
| 高对比度 | 尊重 `prefers-contrast`；边框和焦点环不能消失 |

# 5. 组件

每个组件只实现本文列出的状态与尺寸；新增状态前先更新规范。

## 5.1 按钮

| 变体 | 用途 | 视觉 |
| --- | --- | --- |
| Primary | 页面唯一主操作 | 主色底 + `--color-on-accent` 文字 |
| Secondary | 常规操作 | 表面底 + 1px 边框 |
| Ghost | 行内次要操作 | 透明底，悬停加 `--color-surface-2` |
| Danger | 删除、撤销、移除 | 危险色文字；确认时用实心危险底 |

- 尺寸：`sm` 24px、`md` 28px、`lg` 32px；触控用 44px。
- 状态：default、hover、active、focus-visible、disabled、loading。
- 按下缩放 0.96–0.98，不做位移。
- 禁用态降低透明度，不改变尺寸；`disabled` 属性与视觉必须一致。
- 加载中保留原宽度，避免布局跳动。
- 一个视图只能有一个 Primary；其余用 Secondary 或 Ghost。
- 图标按钮必须有可访问名称（`aria-label` 或可见文字）。

## 5.2 表单控件

- 输入框高度 28–32px；触控 44px；圆角 `--radius-sm`。
- 标签始终可见，不用 placeholder 代替标签。
- 每个控件有 `id`，标签用 `for` 关联。
- 错误信息放在控件下方，用 `aria-describedby` 关联，并说明如何修复。
- 必填项用文字或 `required` 表达，不只靠星号颜色。
- 禁用与只读要区分：只读仍可聚焦和复制，禁用不可交互。
- 输入框获得焦点时，容器显示焦点环；不要只给 input 加 outline 后又去掉。
- 手机输入框字号至少 16px，避免 iOS 自动缩放。

## 5.3 选择器与菜单

- 优先使用原生 `<select>`（Web）或平台选择器，除非视觉一致性是硬需求。
- 自定义选择器必须实现 combobox 模式：键盘打开、方向键移动、Enter 选择、Escape 关闭、焦点返回触发器。
- 菜单项高度 28–32px；悬停与键盘焦点使用同一底色。
- 菜单必须支持：点击外部关闭、Escape 关闭、焦点不丢失、打开期间不滚动页面。
- 选项很多时提供搜索；搜索框高度 32–36px。
- 选中项用勾选或高亮表达，不能只改文字颜色。
- 禁用项仍可被键盘读到，并说明原因。

## 5.4 分段控件与页签

- 分段控件用于 2–5 个互斥选项；超过 5 个改用菜单。
- 容器 padding 2px，选项高度 22–28px；选中项用滑块或底色表达。
- 页签高度 26–32px；当前页用 `aria-current="page"` 或 `aria-selected="true"`。
- 选中项文字用主文字色，未选用弱化色；不要同时使用滑块和深色底。
- 窄屏允许横向滚动或换行，不能让页面横向滚动。

## 5.5 列表与表格

- 行高：compact 40px，comfortable 48px，触控 48–56px。
- 行结构固定：前导图标 → 主名称/副文 → 元数据 → 操作。
- 行悬停使用 `--color-surface-2`，选中使用 `--color-selection`。
- 行内操作与整行点击必须分离；按钮点击不能触发行跳转。
- 表格数字右对齐并使用等宽数字；文本左对齐。
- 表头吸顶时保持 `--z-sticky`，并加分隔线。
- 列很多时允许表格容器横向滚动，表头与首列可以冻结。
- 空状态、加载状态、错误状态分别设计，不能只显示空白。
- 排序、筛选、分页必须有文字或图标说明当前状态。

## 5.6 卡片

- 卡片用于把相关信息分组，不用于装饰。
- 默认：`--color-surface` 底、1px 边框、`--radius-lg`、内边距 12–16px。
- 卡片内标题字号 `--text-md`，说明用 `--color-text-muted`。
- 卡片可以点击时，整张卡片有 hover/focus 状态；内部按钮不触发卡片点击。
- 不要在卡片上叠加多层阴影和渐变；一个视觉层级即可。

## 5.7 弹层与工具提示

- 弹层宽度 280–360px，最大高度不超过视口 70%。
- 圆角 `--radius-md`–`lg`，使用 `--shadow-md`，背景可加轻微模糊。
- 从触发控件方向生长；上下翻转时保持箭头或原点对齐。
- 进入 180–320ms，退出 180–220ms；减少动效时只淡入。
- 必须：点击外部关闭、Escape 关闭、焦点返回触发器、打开期间不滚动页面。
- 工具提示只用于补充说明，不承载唯一关键信息；延迟 300–500ms，可被 Escape 关闭。
- 工具提示不能包含交互元素。

## 5.8 模态与确认

- 模态用于需要集中注意力的任务；能用页面或抽屉解决时不要用模态。
- 宽度 400–560px，最大 `calc(100vw - 32px)`；圆角 `--radius-xl`。
- 遮罩使用 `rgba(0,0,0,.28–.4)`；必要时加 4–8px 模糊。
- 必须：焦点移入、Tab 循环、背景 `inert`、Escape 取消、关闭后焦点返回。
- 确认对话框使用 `role="alertdialog"`；标题说明操作，正文说明后果。
- 危险按钮使用实心危险色，文字对比度至少 4.5:1。
- 未保存草稿在关闭、切换页面、点击遮罩前都要确认。
- 预览、计划、试运行不得产生副作用。

## 5.9 通知、状态与徽章

- 行内状态：文字 + 颜色；成功绿、失败红、警告琥珀、信息蓝。
- 状态胶囊：12–12.5px、500 字重；底色为语义色 12–16%，内环 30%。
- 全局通知：底部或顶部居中，最大宽度 560px；3–5 秒自动消失，可手动关闭。
- 徽章：10–11px、600 字重、全大写；只用于短标签。
- 错误文本必须可选中复制。
- 任何异步操作都要有进行中、成功、失败三种可见状态。
- 不要用闪烁或抖动吸引注意；用颜色、图标和文字。

## 5.10 空状态

- 结构：标题（主文字色）+ 一句说明（弱化色）+ 一个主操作（可选）。
- 上下留白 24–40px，居中；不要用大幅插画占据首屏。
- 区分"没有数据"、"没有结果"、"读取失败"、"无权限"四种状态。
- 读取失败时保留上一次成功内容，并说明数据的时间。

## 5.11 导航

- 主导航最多两级；超过两级使用侧栏分组或页面内页签。
- 当前页用 `aria-current="page"`，视觉上用主文字色 + 底色/滑块。
- 分组名是弱化文字，不是可点击项。
- 窄屏导航折叠为抽屉或底部栏；抽屉必须支持 Escape 关闭和焦点陷阱。
- 提供跳过导航链接（Skip to content），获得焦点时可见。
- 页面有且只有一个 `h1`；分节使用 `h2`/`h3`，不跳级。

## 5.12 图标

- 行内图标 16px；导航 16–20px；空状态 24–32px。
- 线性图标统一线宽 1.5px、圆角端点；同一套图标不要混用填充和线性。
- 图标与文字间距 6–8px；纯图标按钮必须有 `aria-label`。
- 图标不能是唯一的信息载体；状态、错误、成功都要有文字。
- 品牌图标保留原色；单色图标用 `currentColor` 随主题变化。

# 6. 交互规范

## 6.1 反馈时限

| 时间 | 反馈 |
| --- | --- |
| < 100ms | 按下、悬停等即时视觉反馈 |
| 100–300ms | 允许轻量过渡，不显示加载 |
| 300ms–1s | 显示局部 loading 或骨架屏 |
| > 1s | 显示进度、可取消操作或分步状态 |

- 按钮点击后立即进入 loading，不要等请求返回。
- 超过 10 秒的操作提供取消或后台执行。

## 6.2 加载

- 首次加载用骨架屏；局部刷新用行内 spinner；不要整页白屏。
- 骨架屏尺寸与真实内容一致，避免布局跳动。
- 重试按钮放在错误信息旁，不要只提示"出错了"。
- 乐观更新失败时必须回滚，并说明原因。

## 6.3 错误

错误文案包含三段：发生了什么、影响了什么、下一步做什么。

- 不要只写 "Failed" 或 "Error"。
- 不要暴露堆栈、token、内部路径。
- 网络错误与业务错误分开表达。
- 表单错误定位到字段，并在提交失败时把焦点移到第一个错误。
- 读取失败保留旧值，标注"显示的是上次成功的数据"。

## 6.4 破坏性操作

- 删除、覆盖、撤销权限、退出登录、清空数据必须先确认。
- 确认框说明对象名称和后果；不要只问"确定吗？"。
- 不可逆操作使用实心危险按钮；可逆操作可以用普通确认。
- 批量操作说明数量；超过阈值时要求输入名称或二次确认。
- 提供撤销入口时，优先撤销而不是确认。

## 6.5 草稿与未保存内容

- 编辑器检测脏状态；关闭、切换、刷新前确认。
- 纯草稿内的删除不需要确认，取消时恢复。
- 自动保存要显示保存时间和状态；失败时保留本地副本。
- 刷新页面使用 `beforeunload` 保护未保存内容。

## 6.6 焦点管理

- 打开模态/抽屉：焦点移入第一个可操作元素或标题。
- 关闭：焦点返回触发元素。
- 删除列表项：焦点移到相邻项或空状态。
- 页面切换：焦点移到页面标题或主区域。
- 不要自动聚焦会打断输入的控件；不要抢走用户正在输入的焦点。

## 6.7 拖拽

- 提供拖拽手柄，不要整行可拖。
- 键盘提供上移/下移命令；触控提供长按或菜单。
- 拖拽中显示插入位置；释放后给出结果反馈。
- 拖拽不能触发点击或导航。

# 7. 可访问性

目标：WCAG 2.2 AA。

- 正文对比度 ≥4.5:1；大文本 ≥3:1；UI 边界、图标、焦点环 ≥3:1。
- 焦点始终可见：2px 焦点环 + 2px offset；禁止只写 `outline: none`。
- 所有功能可用键盘完成：Tab/Shift+Tab、Enter/Space、Escape、方向键。
- 触控目标 ≥44×44px 推荐，最低 24×24px。
- 状态不能只靠颜色；使用图标、文字、线型或形状。
- 支持 200% 缩放和 320px 宽度，不出现内容裁切或横向滚动。
- 尊重 `prefers-reduced-motion`、`prefers-contrast`、`forced-colors`。
- 图片有替代文本；装饰图片 `alt=""`；图标按钮有 `aria-label`。
- 表单错误用 `aria-describedby` 关联；动态状态用 `aria-live`。
- 模态使用 `role="dialog"` 或 `alertdialog`，背景 `inert`。
- 表格有表头；复杂表格使用 `scope` 或 `headers`。
- 不自动播放声音/视频；自动播放必须可暂停。
- 内容文本可选中复制；按钮、标签、菜单、拖拽柄不可选中。

# 8. 国际化与文案

- 所有用户可见字符串走翻译函数；源码语言作为键，缺失时回退。
- 插值使用命名占位符 `{name}`，不要拼接句子片段。
- 支持复数、性别、语序差异；不要把数量词写死在句子里。
- 日期、数字、货币、单位按 locale 格式化。
- 德语、芬兰语等长文案需要 1.3–1.5 倍空间；中文/日文不需要空格。
- 支持 RTL：使用逻辑属性（`margin-inline`、`padding-inline`、`inset-inline`），不要写死 left/right。
- 翻译键按页面/组件分组；删除字符串时同步删除翻译。
- 文案语气：短、具体、说明后果；避免营销词和感叹号。
- 错误文案说明下一步；按钮文案使用动词。
- 文案改动后搜索测试中的旧字符串，并测试空值、长文本和 RTL。

# 9. 数据可视化

- 序列色固定顺序使用 `--chart-1`…`--chart-7`；不要按页面重排。
- 不只靠颜色区分：同时使用线型、点形、直接标注或图例文字。
- 色盲模式切换 Okabe–Ito；新增图表必须在该模式下检查。
- 坐标轴有单位和刻度；不要截断基线误导比较。
- 数字右对齐、等宽；百分比和金额标注精度。
- 空数据、加载、部分失败、全部失败分别表达。
- 失败时保留上一次成功数据，并标注时间。
- 图表提供文本摘要或表格替代，供屏幕阅读器读取。
- 颜色对比度：数据点与背景至少 3:1；细线至少 1.5px。

# 10. 实现约定

## 10.1 CSS 架构

推荐目录：

```text
styles/
  tokens.css          # 3.3 的模板
  base.css            # reset、排版、焦点、滚动条
  layout.css          # 页面骨架、响应式
  components/
    button.css
    field.css
    popover.css
    dialog.css
  utilities.css       # 少量工具类
```

- 组件样式按文件拆分；不要把所有样式堆在一个文件里。
- 使用 `@layer reset, tokens, base, components, utilities` 控制优先级。
- 允许少量工具类（间距、隐藏、截断），但不要用工具类替代组件。
- 类名使用组件前缀或 BEM；状态类统一 `.is-open`、`.is-selected`、`.is-disabled`。
- 不引入 CSS-in-JS 运行时；需要时用构建期方案。

## 10.2 主题

- 首屏前应用主题，避免闪烁：在 `<head>` 内联脚本读取 `localStorage` 并设置 `data-theme`。
- 同时支持系统偏好和显式选择：`system`、`light`、`dark`。
- 主题切换可以加 200–350ms 的颜色过渡；减少动效时关闭。
- 图片、图标、阴影、图表都要检查暗色版本。
- 不用纯黑 `#000` 和纯白 `#fff` 做大面积背景；使用带轻微色相的中性色。

## 10.3 组件 API

- 变体用枚举，不用布尔堆叠：`variant="primary|secondary|ghost|danger"`。
- 尺寸用 `size="sm|md|lg"`；不要同时暴露 `small`、`compact`、`dense`。
- 状态由属性驱动：`disabled`、`loading`、`invalid`、`selected`。
- 组件只消费 token；不要接受任意颜色 prop。
- 所有交互组件必须转发 `ref`、`aria-*`、`data-*` 和原生事件。
- 受控与非受控只选一种，不要混用。

## 10.4 性能

- 动画只改 `transform` 和 `opacity`；避免动画 `width`、`height`、`top`、`left`。
- `will-change` 只在动画期间使用，结束后移除。
- 大列表使用虚拟滚动；避免一次渲染上千行。
- 全窗口 `backdrop-filter` 在低端 GPU/WebView2 上可能卡顿；提供降级。
- 图片使用 `loading="lazy"`、`decoding="async"` 和明确尺寸。
- 字体使用 `font-display: swap`；避免布局偏移。

## 10.5 测试

| 类型 | 要求 |
| --- | --- |
| 视觉回归 | 亮/暗、窄屏/宽屏、关键组件状态 |
| 键盘 | Tab 顺序、焦点可见、模态焦点陷阱、Escape |
| 屏幕阅读器 | 至少一个桌面 + 一个移动读屏走查 |
| 自动化 a11y | axe 或同类工具，0 严重问题 |
| 多语言 | 英文 + 最长语言 + RTL（如支持） |
| 缩放 | 200% 与 320px 宽 |
| 主题 | 系统亮/暗 + 显式亮/暗 + 高对比度 |

- 新增共享组件或断点时跑完整视觉回归，不只跑当前页面。
- 组件测试覆盖：默认、悬停、焦点、禁用、加载、错误、空状态。
- 截图基线要固定字体和数据，避免环境差异导致假失败。

# 11. 评审清单

| 类别 | 检查项 |
| --- | --- |
| Token | 只使用 token；亮/暗/高对比度同步；无裸色值 |
| 排版 | 字号/行高/字重来自刻度；数字等宽；长文案可换行 |
| 布局 | 内容最大宽；断点正确；窄屏无横向滚动 |
| 密度 | 同一视图一种密度；触控目标 ≥44px |
| 组件 | 状态完整；一个主操作；禁用与加载不跳布局 |
| 弹层 | 焦点返回；Escape 关闭；不滚动页面；层级正确 |
| 模态 | 焦点陷阱；背景 inert；危险操作说明后果 |
| 交互 | 反馈及时；错误可修复；失败保留旧值；可撤销 |
| 可访问性 | 键盘可达；焦点可见；对比度达标；不只靠颜色 |
| 国际化 | 字符串已翻译；占位符完整；RTL/长文案正常 |
| 动效 | 时长/缓动来自 token；减少动效可用；不可见时暂停 |
| 验证 | 视觉回归、键盘走查、200% 缩放、多语言截图 |

# 12. 版本与变更

- 规范使用语义化版本：`MAJOR.MINOR.PATCH`。
- 新增 token 或组件为 `MINOR`；修改既有语义、删除 token、改变默认密度为 `MAJOR`。
- 每次变更记录：改了什么、为什么、影响哪些组件、迁移方式。
- 弃用 token 时保留一个版本，并在代码中标注替代项和移除时间。
- 规范与实现不一致时，先修实现或先改规范，不要让两者长期分叉。
