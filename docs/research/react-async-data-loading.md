# 1. React 共享异步数据与首屏加载方案调研

## 1.1 调研问题

本次调研聚焦以下问题：

1. 多个 React 组件消费同一份服务端数据时，GitHub 主流项目如何共享请求、缓存和状态。
2. 首屏请求尚未完成时，如何避免先显示默认数据、随后替换成后台数据所造成的“重载”观感。
3. ToolHub 的 `/tools-meta`、登录页每日一言、主页工具列表和顶部索引应采用哪种方案。

调研只使用 GitHub 官方仓库中的 README、文档和源码。GitHub Star 数据采集于 2026-07-28，只用于说明生态成熟度，不代表技术方案的绝对优劣。

## 1.2 核心结论

GitHub 主流倾向不是让各组件各自通过 `useEffect` 请求数据，也不是在请求完成前先渲染“看起来真实”的默认数据，而是：

1. 将服务端数据提升为共享的查询或路由数据，以稳定的 key 标识并统一缓存。
2. 明确区分“首次无数据加载”和“已有数据后台刷新”。
3. 首次无真实数据时渲染骨架、占位布局或暂不渲染数据区域；只有请求明确失败后才使用错误兜底。
4. 如果已有可信缓存，可以继续显示缓存数据并在后台刷新；这与先显示假默认值再替换不是一回事。
5. 通过预取或路由 loader 提前发起请求，减少组件挂载后才开始请求所形成的瀑布。

React 官方文档直接指出，在 Effect 中手写数据请求容易造成网络瀑布、缺少预取和缓存、重复请求及竞态；建议优先使用框架内置的数据加载机制，否则使用或构建客户端缓存，并点名 TanStack Query、SWR 和 React Router 6.4+。[React 官方 `useEffect` 文档](https://github.com/reactjs/react.dev/blob/main/src/content/reference/react/useEffect.md#what-are-good-alternatives-to-data-fetching-in-effects)

## 1.3 三类主流方案

| 方案 | 共享与去重 | 首屏加载模型 | 适用场景 | 对 ToolHub 的适配 |
|---|---|---|---|---|
| TanStack Query | `QueryClient` 和 `queryKey` 统一缓存，多消费者共享同一查询 | `isPending` 表示首次无数据，`isFetching` 表示后台刷新 | 中长期维护的客户端 React 应用，查询会被多处消费或需要失效刷新 | 最合适 |
| SWR | 全局 cache、相同 key 请求去重，stale-while-revalidate | `isLoading` 表示请求中且尚无已加载数据，`isValidating` 表示任何刷新 | 希望 API 更轻量、读请求模型简单的 React 应用 | 可行，能力足够 |
| React Router loader | 路由在组件渲染前加载数据，父路由数据可由后代读取 | 路由等待 loader，并提供 navigation pending 或 `HydrateFallback` | 已使用 Data Router 或 Framework Mode，数据天然属于路由 | 原理很好，但本项目迁移面较大 |

### 1.3.1 TanStack Query

TanStack Query 官方将自身定义为异步状态管理和服务端状态工具；仓库约 50,007 Star。[官方仓库](https://github.com/TanStack/query)

与本问题直接相关的官方行为包括：

- 查询结果由缓存维护；未使用的查询默认仍在缓存中保留 5 分钟。
- `staleTime` 控制数据新鲜期，避免组件重新挂载时反复请求。
- 返回值默认进行结构共享；数据没有变化时尽量保持引用稳定。
- `initialData` 会写入缓存，官方明确不建议把占位、局部或不完整数据作为 `initialData`。
- `placeholderData` 不写入缓存，并通过 `isPlaceholderData` 与真实数据区分；这说明占位数据不应伪装成已确认的服务端状态。

来源：[Important Defaults](https://github.com/TanStack/query/blob/main/docs/framework/react/guides/important-defaults.md)、[Initial Query Data](https://github.com/TanStack/query/blob/main/docs/framework/react/guides/initial-query-data.md)、[Placeholder Query Data](https://github.com/TanStack/query/blob/main/docs/framework/react/guides/placeholder-query-data.md)。

成熟项目采用方面，Supabase 官方仓库约 107,143 Star，其 Studio 在应用根部挂载 `QueryClientProvider` 和 `HydrationBoundary`，并在仓库规范中要求使用 `queryKey`、`queryOptions`、请求取消以及按 `pending → error → success` 顺序显式渲染状态。[Supabase `_app.tsx`](https://github.com/supabase/supabase/blob/master/apps/studio/pages/_app.tsx)、[Supabase Studio 查询规范](https://github.com/supabase/supabase/blob/master/.claude/skills/studio-queries/SKILL.md)。

### 1.3.2 SWR

SWR 官方仓库约 32,435 Star。官方 README 将缓存、请求去重、聚焦或网络恢复时重新验证、SSR/SSG 和 Suspense 列为内置能力；相同 key 作为请求的唯一标识。[SWR 官方 README](https://github.com/vercel/swr/blob/main/README.md)

SWR 对加载状态的定义尤其贴近本问题：

- `isLoading`：正在请求，并且尚无已加载的数据。
- `isValidating`：任何正在进行的初次请求或后台刷新。
- 官方示例在 `isLoading` 时渲染 skeleton；已有数据后的重新验证只显示轻量 spinner。
- `fallbackData` 和 `keepPreviousData` 不被视为“已加载数据”，避免把占位内容与服务端真实数据混为一谈。

来源：[Understanding SWR](https://github.com/vercel/swr-site/blob/main/content/docs/advanced/understanding.mdx)、[Global Configuration](https://github.com/vercel/swr-site/blob/main/content/docs/global-configuration.mdx)、[Prefetching Data](https://github.com/vercel/swr-site/blob/main/content/docs/prefetching.mdx)。

### 1.3.3 React Router Data Loader

React Router 官方仓库约 56,530 Star。Data Mode 中，loader 会在路由组件渲染前调用；父路由 loader 的结果可以由后代通过 `useRouteLoaderData(routeId)` 读取，因此很适合把用户、权限或工具元数据放到根路由统一加载。[Data Loading](https://github.com/remix-run/react-router/blob/main/docs/start/data/data-loading.md)、[`useRouteLoaderData`](https://github.com/remix-run/react-router/blob/main/docs/api/hooks/useRouteLoaderData.md)

React Router 还提供：

- `useNavigation` 驱动全局或局部 pending UI。
- `clientLoader` 加载期间使用 `HydrateFallback`。
- 导航到新路由时，先等待下一页 loader，再渲染下一页。

来源：[Pending UI](https://github.com/remix-run/react-router/blob/main/docs/start/framework/pending-ui.md)、[Framework Data Loading](https://github.com/remix-run/react-router/blob/main/docs/start/framework/data-loading.md)。

ToolHub 当前使用 `BrowserRouter` 加声明式 `Routes`，还没有使用 `createBrowserRouter` Data Router。为了一个共享元数据接口切换路由组织方式，会同时影响鉴权、布局、懒加载和错误边界，收益不及引入查询缓存直接。

## 1.4 ToolHub 当前问题映射

当前实现中，以下组件分别请求同一个 `/tools-meta`：

- `frontend/src/pages/Dashboard.tsx`
- `frontend/src/components/Layout.tsx`
- `frontend/src/components/ToolGuard.tsx`

这导致同一服务端资源有三套请求、三套生命周期和三套加载判定。`Dashboard` 与 `Layout` 又都以空覆盖表开始计算，因此初次渲染会把本地 `toolsConfig` 当作完整真实数据，接口返回后再过滤、排序和改名，造成列表跳变。`Dashboard` 的动画依赖 `visibleTools.length`，数量变化还会再次执行入场动画，使“重载”感更明显。

登录页的 `useHitokoto` 初始状态直接放入兜底句，请求成功后替换为接口返回值；`Login.tsx` 的动画 Effect 又依赖 `hitokotoLoading`，因此请求结束会重跑包含表单在内的整组动画。这是“兜底值冒充初始真实值”和“数据状态驱动非数据区域动画”叠加的结果。

`ToolGuard` 在未 ready 时直接渲染 `<Outlet />`，会在元数据返回前暂时放行可能已禁用的工具。它的错误分支还写成 `if (!active) setReady(true)`，组件仍挂载时请求失败反而不会结束加载状态。

## 1.5 推荐方案

推荐在本项目采用 TanStack Query，并把此前候选方案中的“共享工具元数据 Provider”实现为查询缓存 Provider，而不是自行维护一套通用请求缓存。

推荐结构如下：

1. 在应用根部创建唯一 `QueryClient` 并挂载 `QueryClientProvider`。
2. 建立唯一的 `toolMetaQueryOptions` 或 `useToolMetaQuery`，固定使用同一个 `queryKey`，集中完成接口调用、类型定义和 `toolsConfig` 合并。
3. `Dashboard`、`Layout` 和 `ToolGuard` 消费同一查询结果，不再各自请求。
4. 首次 `isPending` 时，工具列表与索引显示尺寸稳定的 skeleton 或暂不显示数据项；不要先渲染默认工具全集。
5. `isError` 后才回退到本地 `toolsConfig`。错误兜底应与正常成功数据有清楚的状态边界。
6. 工具元数据更新频率低，可设置较长 `staleTime`；若后台管理页能修改工具配置，应在修改成功后按同一 `queryKey` 执行 `invalidateQueries`。不建议无条件使用永不刷新的静态缓存。
7. `ToolGuard` 在 `isPending` 时显示路由级加载占位，不渲染 `<Outlet />`；成功后才判断 enabled。请求失败时采用明确的产品策略，但后端仍必须独立执行权限和工具可用性校验。
8. 每日一言使用独立 query key；初始 `data` 保持 `undefined`，在固定高度容器内显示骨架或留白，请求失败后才显示兜底句。
9. 登录表单的入场动画只在页面或登录/注册模式切换时运行；每日一言成功后只动画一言区域，避免数据返回触发表单整体重播。

这套方案符合 React 官方“客户端缓存”的建议，也与 Supabase 等成熟 React 项目的结构一致。相比 SWR，它在本项目未来需要从后台变更工具元数据、主动失效缓存、共享查询选项和区分初次加载与后台刷新时更直接。相比 React Router loader，它无需先改造现有路由架构。

## 1.6 不推荐做法

1. 不建议继续让三个组件分别 `useEffect + axios` 请求 `/tools-meta`，即使分别补上 loading，也仍然存在重复请求、状态漂移和错误策略不一致。
2. 不建议在请求开始前把 `toolsConfig` 或兜底句当作成功数据渲染；它们应只用于明确失败后的降级。
3. 不建议用淡入淡出掩盖数据替换。动画可以改善过渡，但不能修复错误的数据状态模型。
4. 不建议仅为这个问题立即迁移到 React Router Data Router；如果未来计划系统性采用 route loader、route error boundary 和 navigation pending，再统一迁移更合适。

## 1.7 最终判断

如果问题只是“GitHub 上主流方案是什么”，答案是：使用共享的服务端状态缓存或路由 loader，并显式建模首次 loading；不是每个组件独立请求后用默认数据顶住首屏。

对当前 ToolHub，建议选择：

> `TanStack Query + 单一工具元数据查询 + 首次 skeleton/留白 + 失败后才使用默认配置 + 动画与请求状态解耦`

如果团队明确不希望新增依赖，自建一个只服务 `/tools-meta` 的 Context Provider 也能解决当前问题，但它属于局部、轻量的工程折中，不是生态中更通用的主流方案。
