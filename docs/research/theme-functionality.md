# 1. ToolHub 主题功能调研

> 调研日期：2026-08-10
> 调研范围：当前仓库的 React、Vite、Tailwind CSS、shadcn 主题实现，以及增加明暗模式、多配色主题、账号级主题的可行性。
> 来源约束：仓库事实来自当前工作树；外部结论只引用官方文档、标准或第一方实现。

## 2. 结论摘要

ToolHub 不是“尚未增加主题功能”，而是已经具备一套未产品化完成的主题基础设施：

- `Theme` 类型已经包含 `light`、`dark`、`system`；
- `ThemeProvider` 已使用 `localStorage` 持久化选择，并在根元素上切换 `light`、`dark` class；
- `tokens.css` 已建立明暗两套语义 token；
- 登录页、用户区、待审批页和管理区都有主题切换入口。

当前真正缺少的是完整、可靠的三态体验：

1. “跟随系统”只存在于类型和默认值中，界面没有入口可以重新选择它；现有按钮第一次点击后会把它永久改成显式明亮或暗黑。
2. 系统配色在页面打开期间发生变化时，应用不会跟随更新。
3. 根元素 class 在 React `useEffect` 中才设置，首屏存在错误主题闪烁窗口。
4. 存储值没有运行时校验，存储不可用或被写入非法值时缺少降级策略。
5. 没有设置 `color-scheme`，原生表单控件和浏览器绘制不一定与应用主题一致。
6. 两处现有 token 组合未达到 WCAG 2.2 AA 的普通文本对比度要求。

因此，推荐的第一期不是增加多套彩色皮肤，而是：

> 补全现有 `light / dark / system` 三态模式，消除首屏闪烁，增加系统变化监听、存储防御和 `color-scheme`，同时校准现有明暗 token 的对比度。

这项工作只需要前端改动，不需要新增依赖、数据库字段或后端接口。多配色主题和账号同步应作为独立需求，避免把三个不同问题混成一个不断扩张的 `Theme` 枚举。

## 3. 当前实现审计

### 3.1 已有能力

| 能力 | 当前状态 | 仓库证据 |
|---|---|---|
| 用户偏好类型 | 已有 `light \| dark \| system` | [`ThemeContext.tsx`](../../frontend/src/context/ThemeContext.tsx) |
| 根级 Provider | 已挂载在整个应用外层 | [`App.tsx`](../../frontend/src/App.tsx) |
| 本地持久化 | 使用 `toolhub-theme` | [`ThemeProvider.tsx`](../../frontend/src/components/ThemeProvider.tsx) |
| 明暗 token | `:root` 为明亮，`html.dark` 覆盖暗黑 | [`tokens.css`](../../frontend/src/styles/tokens.css) |
| Tailwind 暗色选择器 | 使用根元素 `.dark` | [`tokens.css`](../../frontend/src/styles/tokens.css) |
| 全局入口 | 登录、待审批、用户区、管理区均有按钮 | [`ThemeToggle.tsx`](../../frontend/src/components/ThemeToggle.tsx) |

现有架构方向是合理的。Tailwind CSS 4 官方同样建议通过根元素 class 驱动自定义 `dark` variant，并给出了明亮、暗黑、跟随系统三态模型；shadcn 的 Vite 官方示例也采用 `ThemeProvider + localStorage + 根 class + 三项菜单`。[Tailwind CSS Dark mode](https://tailwindcss.com/docs/dark-mode#toggling-dark-mode-manually)、[Tailwind CSS system theme](https://tailwindcss.com/docs/dark-mode#with-system-theme-support)、[shadcn Vite Dark Mode](https://ui.shadcn.com/docs/dark-mode/vite)

因此没有必要替换技术路线或引入主题库；应在当前实现上补齐生产级边界。

### 3.2 主题 token 覆盖情况

主体 UI 已普遍使用 `background`、`foreground`、`primary`、`muted`、`border` 和状态色等语义 token。新增明暗模式不需要逐页面复制样式。

仓库中的少量固定色不应机械主题化：

- 图片转 PDF 的白色 Canvas 代表实际输出纸张，不是应用背景；
- 取色器使用白字和混合模式是为了在任意用户颜色上保持可读；
- “每天 60 秒”结果卡片使用固定纸张色，是内容组件自身的视觉语义；
- Dialog 的半透明黑色遮罩是跨主题的层级语义。

主题审计应区分“应用 chrome”和“工具内容画布”。否则暗色模式可能改变导出结果或破坏工具要表达的真实颜色。

## 4. 主要缺口与影响

| 优先级 | 缺口 | 当前证据 | 实际影响 |
|---|---|---|---|
| P0 | 首屏主题设置过晚 | 根 class 在 `useEffect` 中设置，`index.html` 没有同步初始化 | 用户保存暗黑主题时，可能先看到明亮页面再切换 |
| P0 | `system` 不会实时跟随 | 只读取 `matchMedia(...).matches`，未监听 `change` | 操作系统切换主题后，已打开页面保持旧主题 |
| P0 | 三态模型只有二态 UI | Toggle 只执行 `dark ↔ light` | 用户点击后无法回到“跟随系统” |
| P0 | 存储值不安全 | `localStorage` 字符串直接 `as Theme` | 非法值会导致根元素没有有效主题 class；存储异常可能阻断渲染或切换 |
| P0 | 缺少 `color-scheme` | HTML 和 CSS 均未声明 | 原生控件、滚动条、默认绘制可能与页面主题不一致 |
| P0 | 现有颜色对比度不足 | 浅色主色与白色为 `3.68:1`；暗色弱化文字与弱化表面为 `3.94:1` | 普通字号文本未达到 WCAG AA `4.5:1` |
| P1 | 跨标签页不同步 | 未监听 `storage` | 一个标签页切换后，其他已打开标签页不会即时更新 |
| P1 | 偏好和生效值未分离 | Context 只暴露 `theme` | 组件各自重复调用 `matchMedia`，容易出现状态漂移 |

React 官方说明，`useEffect` 通常会在浏览器完成绘制后执行，视觉状态依赖 Effect 时可能产生闪烁。[React `useEffect` caveats](https://react.dev/reference/react/useEffect#caveats)、[React：visual Effect flicker](https://react.dev/reference/react/useEffect#my-effect-does-something-visual-and-i-see-a-flicker-before-it-runs)

`MediaQueryList` 规范提供 `matches` 和 `change` 事件，因此“跟随系统”应是持续订阅状态，不是仅在主题偏好改变时读取一次。[CSSOM View：MediaQueryList](https://drafts.csswg.org/cssom-view-1/#the-mediaquerylist-interface)

Web Storage 只保存字符串，访问或写入可能因浏览器策略、origin 或配额失败；标准同时定义了向其他同源上下文广播的 `storage` 事件。[HTML Standard：Web Storage](https://html.spec.whatwg.org/multipage/webstorage.html)

### 4.1 对比度实测

WCAG 2.2 AA 要求普通文本至少 `4.5:1`、大文本至少 `3:1`，关键 UI 组件和状态边界至少 `3:1`。[WCAG 2.2 1.4.3](https://www.w3.org/TR/WCAG22/#contrast-minimum)、[WCAG 2.2 1.4.11](https://www.w3.org/TR/WCAG22/#non-text-contrast)

| 组合 | 对比度 | 判断 |
|---|---:|---|
| 明亮背景 `#ffffff` / 正文 `#09090b` | `19.90:1` | 通过 |
| 明亮主色 `#3b82f6` / 白色 `#ffffff` | `3.68:1` | 仅适合大文本或非文本边界；普通文本失败 |
| 明亮背景 `#ffffff` / 弱化文字 `#71717a` | `4.83:1` | 通过 |
| 暗黑背景 `#050505` / 正文 `#f4f4f5` | `18.54:1` | 通过 |
| 暗黑主色 `#d4ff00` / 黑色 `#000000` | `18.10:1` | 通过 |
| 暗黑背景 `#050505` / 弱化文字 `#767680` | `4.54:1` | 临界通过 |
| 暗黑弱化表面 `#18181b` / 弱化文字 `#767680` | `3.94:1` | 普通文本失败 |

浅色 `primary` 不仅用于按钮背景，也大量用于普通字号 `text-primary`，因此不能用“按钮文字可能是大文本”规避。实施时应调整 token，而不是逐组件打补丁；例如选择同时满足“主色作文字”和“主色作按钮背景”两种用途的更深蓝色，或拆分 `brand` 与 `interactive-text` 语义。

## 5. 三种功能范围

### 5.1 方案 A：补全明亮、暗黑、跟随系统（推荐）

范围：

- 保留现有两套视觉设计；
- 将主题按钮改为可明确选择三项的菜单或分段选择器；
- 首屏同步解析主题；
- 监听系统与跨标签页变化；
- 防御非法或不可用存储；
- 设置 `color-scheme`；
- 校准对比度。

优点：改动集中、无需后端、无需依赖，直接修复真实体验缺口。现有 token 体系已经能承载。

限制：同一浏览器 origin 内持久化，换设备或清理站点数据后不会保留。

### 5.2 方案 B：增加多套预设配色

范围：在明暗模式之外，再增加如蓝色、绿色、高对比等 palette。

正确的数据模型应把两个维度分开：

```text
modePreference: system | light | dark
resolvedMode: light | dark
palette: default | <preset>
```

不建议把它们组合成 `blue-light | blue-dark | green-light | ...`。组合枚举会让状态数按“模式 × 配色”增长，并把 `.dark` 语义与品牌色混在一起。

优点：个性化更强，可支持品牌或高对比预设。

代价：每套 palette 都必须覆盖完整语义 token，并在所有工具、状态、图表、焦点和导出边界上验收；当前没有明确产品目标支持这项维护成本。

### 5.3 方案 C：账号级或管理员级主题

范围：跨浏览器、跨设备同步用户选择，或由管理员设置全站品牌主题。

需要新增：

- 用户偏好或站点设置的数据模型；
- 读取、更新 API 与权限规则；
- 数据迁移和默认值策略；
- 登录前、登录后本地偏好与服务端偏好的优先级、合并策略；
- 离线、接口失败时的缓存与降级。

优点：适合多设备使用、企业品牌和统一管控。

代价：这已不是纯前端主题切换，而是一项跨前后端偏好系统。目前仓库没有通用用户 preferences 模型，仅为主题增加它的收益不足。

### 5.4 方案对比

| 维度 | 方案 A：完整三态 | 方案 B：多配色 | 方案 C：账号/管理员主题 |
|---|---|---|---|
| 用户价值 | 直接、明确 | 取决于个性化需求 | 取决于多设备和企业需求 |
| 前端复杂度 | 低 | 中到高 | 中 |
| 后端改动 | 无 | 通常无 | 必需 |
| token 维护成本 | 两套模式 | 模式 × palette | 取决于可配置范围 |
| 数据迁移 | 无 | 无 | 有 |
| 当前必要性 | 高 | 未证实 | 未证实 |
| 推荐顺序 | 立即实施 | 有明确设计目标后 | 有跨设备或管控需求后 |

## 6. 推荐设计

### 6.1 状态模型

Context 应同时暴露：

```text
theme: light | dark | system       // 用户选择，持久化
resolvedTheme: light | dark        // 当前实际生效值，不持久化
setTheme(nextTheme)                // 更新用户选择
```

`prefers-color-scheme` 规范只有 `light` 与 `dark`；`system` 是应用层偏好，而不是媒体查询返回值。[Media Queries Level 5：prefers-color-scheme](https://www.w3.org/TR/mediaqueries-5/#prefers-color-scheme)

分离两者后：

- UI 能准确显示“跟随系统（当前暗黑）”；
- 根 class、`color-scheme` 和图标只依赖 `resolvedTheme`；
- 只有 `theme === system` 时系统变化才改变页面；
- 不再由每个组件自行调用 `matchMedia` 解析实际主题。

### 6.2 首屏初始化

在 React 和页面内容绘制前执行一个极小的同步初始化逻辑：

1. 读取 `toolhub-theme`；
2. 仅接受 `light`、`dark`、`system`，非法值降级到 `system`；
3. 在 `system` 时读取 `prefers-color-scheme`；
4. 原子替换 `<html>` 的 `light`、`dark` class；
5. 同步设置根元素实际 `color-scheme`。

Tailwind 官方明确建议把三态主题初始化逻辑放在 `<head>` 中内联执行，以避免 FOUC。[Tailwind CSS：system theme support](https://tailwindcss.com/docs/dark-mode#with-system-theme-support)

若未来部署 Content Security Policy，内联脚本必须使用 nonce 或固定 hash；不应为了主题脚本开启宽泛的 `'unsafe-inline'`。[CSP Level 3](https://www.w3.org/TR/CSP3/)

### 6.3 运行期同步

Provider 接管后应：

- 当 `theme === system` 时监听媒体查询 `change`；
- 主题变化时统一更新 class 与 `color-scheme`；
- 监听 `storage`，让其他标签页切换后同步；
- 对存储读取、写入使用白名单校验与 `try/catch`；
- 存储不可用时仍在当前标签页内正常切换，只是不持久化。

### 6.4 主题入口

推荐把纯图标二态 Toggle 改成三项 Dropdown Menu：

- 明亮；
- 暗黑；
- 跟随系统。

当前项目已经依赖并使用 Dropdown Menu，不需要新增组件库。菜单项应同时提供文字和选中状态；不能只靠太阳、月亮图标或颜色表达状态，因为 WCAG 要求颜色不能成为传递信息的唯一手段。[WCAG 2.2 1.4.1](https://www.w3.org/TR/WCAG22/#use-of-color)

触发按钮可继续显示当前实际主题图标，但 accessible name 应表达动作和选择，例如“主题：跟随系统，当前暗黑”，而不是把偏好状态与实际状态混为一谈。

### 6.5 原生控件和浏览器绘制

`color-scheme` 会影响浏览器提供的表单控件、滚动条、默认颜色等，但不会替代应用自身 token。[CSS Color Adjustment：color-scheme](https://www.w3.org/TR/css-color-adjust-1/#color-scheme-prop)

推荐同时：

- 在 HTML 声明支持 `light dark`，帮助浏览器尽早选择合适的默认绘制；
- 运行期把根元素实际 `color-scheme` 设为 `light` 或 `dark`；
- 继续由根 class 驱动应用 CSS 变量和 Tailwind `dark:`。

### 6.6 动画

现有 `body` 有背景色和文字色过渡。首次初始化不应播放主题过渡；用户主动切换时可以保留轻量过渡。

`prefers-reduced-motion: reduce` 表示用户希望移除或替换非必要动态效果。[Media Queries Level 5：prefers-reduced-motion](https://www.w3.org/TR/mediaqueries-5/#prefers-reduced-motion)

现有全局 reduced-motion 规则已经把 transition 缩短到 `0.01ms`，实施时应确认新增的图标旋转、菜单动画或主题切换效果同样受该规则约束。

## 7. 分期建议

### 7.1 P0：完整三态主题

1. 建立唯一的主题解析和应用函数，分离 `theme` 与 `resolvedTheme`。
2. 增加首屏同步初始化，消除错误主题闪烁。
3. 增加系统媒体查询 `change` 监听。
4. 将 Toggle 改为明亮、暗黑、跟随系统三项入口。
5. 校验存储值并处理读写异常。
6. 声明并同步 `color-scheme`。
7. 调整不达标的主色和弱化文字 token，并复查所有普通文本组合。

### 7.2 P1：一致性和维护性

1. 增加跨标签页 `storage` 同步。
2. 明确首次加载不动画、主动切换才动画的状态标记。
3. 形成主题 token 清单，区分应用 UI token 与内容画布固定色。
4. 在 Chromium、Firefox、Safari 的明亮、暗黑和系统动态切换下做手工回归。

### 7.3 P2：有需求后扩展

1. 有明确品牌或个性化目标后，再把 `palette` 作为独立维度增加预设。
2. 有跨设备同步需求后，再设计通用用户 preferences，而不是只增加一个零散 theme 字段。
3. 有企业管控需求后，再区分管理员默认值与用户覆盖值。

## 8. 预计影响文件

| 文件 | 建议变更 |
|---|---|
| `frontend/src/context/ThemeContext.tsx` | 暴露 `resolvedTheme`，收紧主题类型和 Context 契约 |
| `frontend/src/components/ThemeProvider.tsx` | 统一解析、class 应用、系统监听、存储校验与跨标签页同步 |
| `frontend/src/components/ThemeToggle.tsx` | 改为三项选择，并表达偏好和实际状态 |
| `frontend/index.html` | 增加首屏初始化和 `color-scheme` 声明 |
| `frontend/src/styles/tokens.css` | 同步 `color-scheme`、校准对比度、控制初始化过渡 |

预计无需改动后端、数据库和 API。若把首屏解析逻辑直接内联在 HTML，需要防止它与 Provider 各维护一套不同规则；可以共享稳定的常量约定并用验收用例约束两端行为。

## 9. 验收标准

### 9.1 功能

1. 用户可明确选择明亮、暗黑、跟随系统三项。
2. 刷新页面后保留用户原始选择，不把 `system` 存成当时解析出的 `light` 或 `dark`。
3. 选择跟随系统时，操作系统主题变化无需刷新即可生效。
4. 选择显式明亮或暗黑时，操作系统变化不会覆盖用户选择。
5. 另一个同源标签页修改主题后，当前标签页即时同步。

### 9.2 稳健性

1. 慢速加载下，首屏不会先显示错误主题再切换。
2. `localStorage` 为非法字符串时回退到 `system`。
3. `localStorage` 读取或写入失败时页面仍能渲染，当前会话仍可切换主题。
4. 根元素始终只有一个有效的 `light` 或 `dark` class。
5. 原生表单控件和浏览器默认绘制与实际主题一致。

### 9.3 可访问性和视觉

1. 两套模式下普通文本对比度均不低于 `4.5:1`。
2. 焦点、边界、选中状态等非文本信息对比度不低于 `3:1`。
3. 当前偏好不只通过颜色或图标表达。
4. reduced-motion 下不播放非必要主题切换动画。
5. PDF 白纸、取色器颜色、60 秒内容卡片等内容语义不因主题切换而失真。

### 9.4 仓库验证

实施代码后按仓库要求从 `frontend/` 运行：

```bash
bun run lint
bun run build
bunx react-doctor
```

并在仓库根目录运行：

```bash
git diff --check
```

## 10. 最终建议

立即做方案 A，并把它定义为“现有主题基础设施补全”，不是新建另一套主题系统。

第一期完成后，ToolHub 将获得可靠的三态主题、无闪烁首屏、系统实时同步、正确的原生控件配色和可验证的对比度，同时保持纯前端、零新增依赖、零数据迁移。只有在出现明确的品牌、多配色或跨设备需求后，再分别启动 palette 或 preferences 设计。
