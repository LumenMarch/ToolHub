# 60s 项目 API 模块离线复刻可行性分析 — Research Report

> **Date**: 2026-08-06
> **Scope**: 对 GitHub 仓库 [vikiboss/60s](https://github.com/vikiboss/60s)（Deno/Oak 实现的聚合 API 服务，约 50 个模块）逐一分析其数据来源，判断每个模块是否能在"离线/无外部依赖"环境下用 Python 复刻到 ToolHub。所有代码事实均来自仓库源码 `/tmp/60s-analysis/src/modules/`（repo-verified），未做运行时验证。
> **分析口径**：
> - ① 完全离线可用 = 纯本地计算/内置 JSON 数据，无任何 fetch/网络调用；
> - ② 半离线 = 数据是"上游仓库/静态托管"的一次性静态文件，拉取一次本地缓存后即可永久工作；
> - ③ 强在线依赖 = 实时抓取第三方站点/API，数据持续变化，离线无法工作。
> - 复刻难度仅针对"用 Python 重写该模块逻辑"本身，不含部署运维。

---

## 1. 结论速览

| 分类 | 数量 | 代表模块 |
|---|---|---|
| ① 完全离线可用 | **14** | hash、color、health、password、qrcode、lunar、moyu、awesome-js、hitokoto、duanzi、fabing、luck、answer、dad-joke |
| ② 半离线（静态数据一次性拉取） | **3** | 60s、60s-rss、kfc |
| ③ 强在线依赖（实时第三方） | **33** | 全部热搜类、weather、fanyi、maoyan、whois、ncm、lyric、epic、olympics 等 |
| 其他（非模块或死代码） | 2 | not-found 中间件（纯本地）、dy-parser（空壳，路由未注册） |

关键结论：
- **28% 的模块（14/50）可以零改动思路直接离线复刻**，且其中大部分是纯标准库可实现的（hash、qrcode、color、health）。
- 60s 主接口（每日新闻）**并非实时抓取**，而是读取上游 GitHub 静态仓库 `vikiboss/60s-static-host` 的每日 JSON——这是整个项目里最适合 ToolHub 复刻的"半离线"数据源。
- 热搜类模块（baidu/bili/douyin/weibo/zhihu/toutiao/quark/rednote/dongchedi）全部是实时抓取，且 weibo 内置了硬编码 Cookie、rednote 内置了硬编码签名头，**极易失效**，离线环境无法工作。
- 全项目没有任何模块依赖 API 密钥（无需要用户申请的 key），但 maoyan（自研签名 + WOFF 反爬）、fanyi（逆向 AES 密钥）、rednote（签名头）属于反爬逆向类，维护成本高。

---

## 2. ① 完全离线可用（纯本地计算 / 内置数据，共 14 个）

| 模块 | API 路径 | 功能 | 分类依据（代码事实） | 复刻难度 |
|---|---|---|---|---|
| hash | `POST/GET /v2/hash` | MD5/SHA1/SHA256/SHA512、Base64、URL 编码、gzip/deflate/brotli 编解码 | `hash.module.ts` 仅 import `node:zlib` / `node:crypto` / `node:buffer`，全量本地计算，无 fetch | 简单（Python `hashlib`/`base64`/`zlib`/`brotli` 全有） |
| color | `GET /v2/color/random`、`/v2/color/palette` | 随机/指定颜色 HEX↔RGB↔HSL 转换、配色方案生成 | `color.module.ts` 38KB 纯计算（normalizeHex/isValidHex/HSL 转换/调色板理论），无 fetch | 简单（纯数学） |
| health | `GET /v2/health` | BMI、标准体重、BMR/TDEE（Mifflin-St Jeor）、推荐热量 | `health.module.ts` 21KB 纯公式计算，无 fetch | 简单 |
| hitokoto | `GET /v2/hitokoto` | 一言句子，支持 id 取指定/随机 | `hitokoto/hitokoto.module.ts` import 本地 `hitokoto.json`，无 fetch | 简单（数据文件直接搬运） |
| duanzi | `GET /v2/duanzi` | 段子，id/随机 | `duanzi/duanzi.module.ts` import 本地 `duanzi.json` | 简单 |
| fabing | `GET /v2/fabing` | 发病文学，支持 `[name]` 替换 | `fabing/fabing.module.ts` import 本地 `fabing.json` + `replaceAll('[name]', name)` | 简单 |
| luck | `GET /v2/luck` | 运势签文，随机 tip | `luck/luck.module.ts` import 本地 `luck.json` + `randomItem` | 简单 |
| answer | `GET /v2/answer` | 人生答案之书式随机回答 | `answer/answer.module.ts` import 本地 `answer.json` | 简单 |
| dad-joke | `GET /v2/dad-joke` | 冷笑话，id/随机 | `dad-joke/dad-joke.module.ts` import 本地 `dad-joke.json` | 简单 |
| awesome-js | `GET /v2/awesome-js` | JS 面试题题库（约 150 题，含答案与解析） | `awesome-js/awesome-js.module.ts` import 本地 `awesome-js.json`（约 500KB） | 简单（JSON 体量大，需一并搬运） |
| password | `GET /v2/password`、`/v2/password/check` | 强密码生成（字符集/熵计算）与弱密码检测（对照本地常见密码表） | `password/password.module.ts` import 本地 `passwords.json`，熵/强度/破解耗时全为本地计算 | 简单~中等（熵与强度分级逻辑较细） |
| qrcode | `GET /v2/qrcode` | 二维码生成（size/纠错级别/类型参数） | `qrcode/qrcode.module.ts` 用 npm 库 `yaqrcode` 本地生成 dataURI，无 fetch | 简单（Python `qrcode` 库等价） |
| lunar | `GET /v2/lunar` | 农历/黄历（宜忌、吉神凶神、星座、生肖、时辰） | `lunar/lunar.module.ts` 用 `tyme4ts` 计算 + 本地 `area.ts`（837KB 地区码表）+ `constants.ts`（358KB 宜忌表），无 fetch | 中等（Python 可用 `lunar_python` 替代 tyme4ts，宜忌表需搬运） |
| moyu | `GET /v2/moyu` | 摸鱼日历：节假日/调休/农历/节气/倒计时 | `moyu.module.ts` 用 npm 包 `chinese-days` 本地计算，无 fetch | 简单~中等（Python 需 holidays + lunar 组合或移植其节假日表） |

> 另：`not-found` 中间件（`middlewares/not-found.ts`）是纯本地 404 响应，不属 API 模块但同样离线可用。

---

## 3. ② 半离线（一次性拉取静态数据后本地缓存即可工作，共 3 个）

这三个模块的数据源本质是"作者维护的静态文件"，不是实时变化的第三方业务数据。复刻时可选择：
- **方案 A（真离线）**：把数据文件 vendor 进 ToolHub 仓库，完全离线；
- **方案 B（推荐）**：启动时/定时从上游拉一次落盘缓存，之后离线工作。

| 模块 | API 路径 | 功能 | 数据来源细节 | 复刻难度 |
|---|---|---|---|---|
| 60s | `GET /v2/60s` | 每天 60 秒读懂世界：当日新闻列表 + 图片 + 农历 | `60s.module.ts#tryUrl` 调 `Common.tryRepoUrl({ repo: 'vikiboss/60s-static-host', path: 'static/60s/${date}.json' })`，回退链：GitHub raw → jsdelivr → jsdmirror → `https://60s-static.viki.moe/60s/{date}.json` → `https://60s-static-host.vercel.app/60s/{date}.json`；图片走 `data.image`（HEAD 探测失败则回退 `60s-static.viki.moe/images/{date}.png`）。按日期内存缓存 | 简单（拉 JSON + 解析；Python 端可做按日文件缓存） |
| 60s-rss | `GET /v2/60s/rss` | 将最近 10 天 60s 数据生成为 RSS 2.0 | 数据源与 60s 完全一致（`60s-rss.module.ts#tryUrl` 同样读 `vikiboss/60s-static-host`），本地用 tyme4ts 算农历 + 拼 XML | 简单（XML 生成，Python `xml.etree` 即可） |
| kfc | `GET /v2/kfc` | 疯狂星期四 v50 文案随机一条 | `kfc.module.ts#fetch` 调 `Common.tryRepoUrl({ repo: 'vikiboss/v50', path: 'static/v50.json' })`，回退链同上，另备选 `https://v50.deno.dev/list`；缓存 1 天 | 简单（纯字符串数组 JSON） |

> `Common.tryRepoUrl`（`common.ts:194`）的实际行为：按 `config.overseas_first` 依次尝试 `raw.githubusercontent.com` / `cdn.jsdelivr.net` / 自定义 alternatives / `jsdmirror.com` 等多个镜像，返回第一个成功的响应。**没有密钥、没有鉴权**，纯粹是公开静态文件多镜像回退。

---

## 4. ③ 强在线依赖（实时抓取第三方，离线无法工作，共 33 个）

### 4.1 热搜 / 榜单类（10 个）

| 模块 | API 路径 | 数据源 | 技术细节 | 复刻难度 |
|---|---|---|---|---|
| baidu | `/v2/baidu/hot`、`/v2/baidu/teleplay`、`/v2/baidu/tieba` | `top.baidu.com/board?tab=...`（HTML 内嵌 `<!--s-data:-->` JSON）、`tieba.baidu.com/hottopic/browse/topicList` | 正则提取 + cheerio，UA 伪装 | 中等 |
| bili | `/v2/bili` | `api.bilibili.com/x/web-interface/wbi/search/square`，失败回退 `app.bilibili.com/x/v2/search/trending/ranking` | 纯 JSON API + UA | 简单 |
| douyin | `/v2/douyin` | `aweme-lq.snssdk.com/aweme/v1/hot/search/list/?aid=1128...` | 纯 JSON API | 简单 |
| weibo | `/v2/weibo` | `m.weibo.cn/api/container/getIndex?...` | JSON API，但 `weibo.module.ts:6` **硬编码了完整 Cookie**（SUB/SUBP/XSRF-TOKEN 等），失效即 403；在线部署也需频繁更新 | 简单~中等（逻辑简单，维护难） |
| zhihu | `/v2/zhihu` | `api.zhihu.com/topstory/hot-lists/total?limit=30` | 纯 JSON API，无特殊头 | 简单 |
| toutiao | `/v2/toutiao` | `www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc` | 纯 JSON API | 简单 |
| quark | `/v2/quark` | `iflow.quark.cn/iflow/api/v1/article/aggregation?...` | JSON API + UA | 简单 |
| rednote | `/v2/rednote` | `edith.xiaohongshu.com/api/sns/v1/search/hot_list` | JSON API，但**硬编码 `shield` 签名头**（`rednote.module.ts:11`）——签名由 App 端算法生成，随时可能失效 | 简单~中等（签名逆向是难点） |
| dongchedi | `/v2/dongchedi` | `www.dongchedi.com/news` 首页 HTML 内嵌 `__NEXT_DATA__` | cheerio 解析 Next.js 数据 | 中等 |
| kuan | `/v2/beta/kuan` | `api.coolapk.com/v6/page/dataList?...`（酷安话题榜） | JSON API + `X-Requested-With` 等头 | 简单~中等 |

### 4.2 资讯 / 新闻类（3 个）

| 模块 | API 路径 | 数据源 | 技术细节 | 复刻难度 |
|---|---|---|---|---|
| hacker-news | `/v2/hacker-news/{new,top,best}` | `hacker-news.firebaseio.com/v0/{type}stories.json` + `item/{id}.json` | 公开 JSON API，稳定 | 简单 |
| it-news | `/v2/it-news`、`/v2/it-news/rank` | `www.ithome.com/rss/`（列表）+ `www.ithome.com/` 首页 `#rank`（热度榜） | RSS 解析 + cheerio HTML 解析，10 分钟缓存 | 中等 |
| ai-news | `/v2/ai-news` | `ai-bot.cn/daily-ai-news/`（AI 日报） | HTML 抓取解析，按日缓存 | 中等 |

### 4.3 行情 / 天气 / 工具类（7 个）

| 模块 | API 路径 | 数据源 | 技术细节 | 复刻难度 |
|---|---|---|---|---|
| exchange-rate | `/v2/exchange-rate` | `open.er-api.com/v6/latest/{currency}` | 公开 JSON API，按日缓存 | 简单 |
| gold-price | `/v2/gold-price` | `res.huangjinjiage.com.cn/panjia2.js`（金属价 JS）+ `www.huangjinjiage.cn/jinrijinjia.html`（金价页） | JS 文件解析 + HTML 解析 | 中等 |
| fuel-price | `/v2/fuel-price` | `www.qiyoujiage.com` 各区域页（区域清单在本地 `regions.json`） | HTML 解析，60 分钟缓存 | 中等 |
| weather | `/v2/weather/realtime`、`/v2/weather/forecast` | `i.news.qq.com/city/like`（城市检索）+ `i.news.qq.com/weather/common`（实况/预报/空气） | JSON API + UA/Referer | 中等 |
| ip | `/v2/ip` | 客户端 IP 从请求头取（本地）；公网 IP 从 `api.ipify.org`/`ifconfig.me`/`icanhazip.com` 取；归属地 `api.ip.sb/geoip` | 多处外部 API 备选回退 | 简单 |
| whois | `/v2/whois` | 主用 `rdap.org/domain/{domain}`（RDAP），缺失字段回退 npm `whois-raw`（原始 WHOIS 43 端口查询） | 双重网络依赖；whois-raw 是纯网络客户端 | 中等 |
| og | `/v2/og` | 抓取**用户传入的任意 URL** 解析 Open Graph 元数据 | 本质是通用抓取器；复刻本身简单，但需 SSRF 防护 | 简单（安全防护是难点） |

### 4.4 内容 / 媒体类（8 个）

| 模块 | API 路径 | 数据源 | 技术细节 | 复刻难度 |
|---|---|---|---|---|
| baike | `/v2/baike` | `baike.baidu.com/api/openapi/BaikeLemmaCardApi`（appid 硬编码 `379020`，公共演示 appid） | JSON API，3 次重试 | 简单 |
| today-in-history | `/v2/today-in-history` | `baike.baidu.com/cms/home/eventsOnHistory/{MM}.json`（月度事件文件） | 静态 JSON 文件，按月拉取 | 简单 |
| douban-weekly | `/v2/douban/weekly/{movie,tv_chinese,tv_global,show_chinese,show_global}` | `m.douban.com/rexxar/api/v2/subject_collection/{collection}/items` | JSON API + iPhone UA/Referer；封面图经作者自己的 `doubanio.viki.moe` 代理 | 简单 |
| changya | `/v2/changya` | `m.singduck.cn/user-piece/cont_{seedId}`（唱鸭小纸条） | 随机 seedId 列表 + HTML 解析 | 中等 |
| chemical | `/v2/chemical` | `www.chemspider.com/Chemical-Structure.{id}.html` | HTML 内 `__NUXT_DATA__` 提取 | 中等（依赖 NUXT 数据结构） |
| epic | `/v2/epic` | `store-site-backend-static-ipv4.ak.epicgames.com/freeGamesPromotions?locale=zh-CN&country=CN` | 公开 JSON API | 简单 |
| maoyan | `/v2/maoyan/all/movie`、`/v2/maoyan/realtime/{movie,tv,web}` | `piaofang.maoyan.com`：历史榜抓首页内嵌 `var props` + 实时榜走**自研 `mygsig` 签名算法** + **WOFF 字体反爬解密**（`maoyan/encode.ts`：md5 签名、解析动态字体映射） | 反爬逆向，最复杂的模块；`num-commands.json` 是本地字体映射表 | 困难 |
| olympics | `/v2/olympics`、`/v2/olympics/events` | 赛事列表来自本地 `events.json`（离线可用）；奖牌榜实时抓 `proxy.viki.moe/{code}/...`（作者自建代理）与 `bff-api.olympics.com`（需先 `bff/api/session/exchange` 换 cookie 的会话流程） | 事件列表本地 + 奖牌数据强在线且依赖作者代理 | 中等~困难 |

### 4.5 音乐 / 翻译 / 社交（5 个）

| 模块 | API 路径 | 数据源 | 技术细节 | 复刻难度 |
|---|---|---|---|---|
| fanyi | `/v2/fanyi`、`/v2/fanyi/langs` | `dict.youdao.com/webtranslate`（POST）+ `dict.youdao.com/webtranslate/key` 取动态密钥 | **逆向实现**：硬编码 AES key/iv（`fanyi.module.ts:122`）、伪造 cookie/referer、动态取密钥；`langs.json` 本地兜底 | 困难（密钥逆向，随时失效） |
| lyric | `/v2/lyric` | `u.y.qq.com/cgi-bin/musicu.fcg`（搜索）+ `c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg`（歌词） | 两步 JSON API + UA/Referer | 中等 |
| ncm | `/v2/ncm-rank/list`、`/v2/ncm-rank/:id` | `music.163.com/api/toplist` + `api/playlist/detail?id=` | 公开 JSON API + Referer | 简单 |
| qq | `/v2/beta/qq/profile` | `users.qzone.qq.com/fcg-bin/cgi_get_portrait.fcg?uins=` | JSONP 回调解析 | 简单 |
| bing | `/v2/bing` | `global.bing.com/?setmkt=zh-cn`（HTML 内 `var _model` JSON），回退 `HPImageArchive.aspx` | 双源回退 + 图片 URL 重组（bing.com/th?id=...） | 简单~中等 |

---

## 5. 其他发现

1. **dy-parser（抖音解析）是死代码**：`dy-parser/dy-parser.module.ts` 的 `handle()` 直接返回 `async (ctx) => {}` 空实现，`router.ts` 中也**未注册该路由**（`serviceKfc = new ServiceDyParser()` 还是复制粘贴残留的类名）。其目录下的 `encode.ts`（22KB）同样未被引用。复刻时可直接忽略。
2. **所有模块均无需 API 密钥**：作者全部采用"公开接口 + UA/Referer 伪装 + 硬编码 Cookie/签名头"策略。硬编码凭据的有：weibo（Cookie）、rednote（shield 签名）、fanyi（AES 密钥）、maoyan（mygsig 算法）、baike（公共 appid）。这些模块即使在线部署也面临失效风险。
3. **唯一依赖"作者自有基础设施"的模块**：olympics 奖牌榜走 `proxy.viki.moe` 代理、douban-weekly 封面走 `doubanio.viki.moe` 代理——复刻时这两个依赖必须替换。
4. **通用依赖**：`common.ts` 提供 `tryRepoUrl`（多镜像回退）、`useProxiedUrl`（仅 DEV 模式改写 URL）、`randomItem`、`buildJson`、`localeDate` 等，全部本地实现；复刻 60s/kfc 时建议把 `tryRepoUrl` 的多镜像回退思路一起搬走（raw.githubusercontent → jsdelivr → jsdmirror → 自定义备选）。

---

## 6. 推荐复刻到 ToolHub 的 Top 5 模块

按"离线可用性 × 实用价值 × 实现成本 × 维护成本"综合排序：

1. **hash**（① 完全离线）— 纯标准库实现（Python `hashlib`/`base64`/`zlib`/`brotli` 十分钟搞定），开发者工具刚需（MD5/SHA/Base64/gzip 编解码），零维护、零风险，是 ToolHub 最安全的"第一个复刻品"。
2. **color**（① 完全离线）— 纯数学计算，前端/设计场景高频（随机色、HEX↔RGB↔HSL、配色方案），Python 实现简单，输出可直接对接 ToolHub 前端取色器。
3. **password**（① 完全离线）— 密码生成器 + 弱密码检测（对照内置常见密码表 + 熵计算），安全类工具价值高、可离线、无合规风险；`passwords.json` 与打分逻辑可整体搬运。
4. **qrcode**（① 完全离线）— Python `qrcode` 库一行生成，接口参数（size/纠错级别）与 60s 对齐即可；二维码工具在任何工具箱里都是高频项。
5. **60s**（② 半离线）— 每日新闻速读是 60s 项目的招牌功能；数据源是公开 GitHub 静态仓库的 JSON 文件，**拉取一次落盘缓存后即可离线工作**，无需实时抓取任何第三方站点。按日缓存 + 图片代理的实现思路清晰，Python 端可做成"每日首次请求时拉取 + 磁盘缓存"，维护成本仅剩"上游偶尔断更"。

**备选**：`health`（BMI/BMR 纯计算，适合健康工具场景）、`awesome-js`（题库体量大但一次搬运永久可用，适合开发者学习场景）、`lunar`/`moyu`（中国用户高频，但 Python 端需引入 `lunar_python` 等依赖并搬运宜忌/节假日数据表）。

**明确不建议复刻**：`maoyan`（WOFF 字体反爬 + 自研签名）、`fanyi`（AES 密钥逆向）、`rednote`（签名头易失效）——三者都是"逆向对抗"型模块，离线环境无法工作，且在线维护成本随时间线性增长。
