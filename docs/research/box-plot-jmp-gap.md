# 1. 箱线图工具与 JMP 箱线图差距

> 调研日期：2026-09-02  
> 调研范围：ToolHub `box-plot` 工具（前后端当前实现）对照 JMP Graph Builder / Distribution / Fit Y by X（Oneway）官方箱线图能力。  
> 来源约束：JMP 只引用 `jmp.com/support/help` 与 JMP 学术一页纸 PDF；仓库事实来自当前工作树。  
> 结论边界：评估「箱线图图形本身 + 常叠在箱上的 JMP 显示元素」；不把 JMP 整套统计分析平台（ANOVA 报告、Explore Outliers、脚本、数据表）算作必须复刻对象，但会单独标出，因为现场说「JMP 箱线图」时经常把 Oneway 整页算进去。

## 2. 结论摘要

**不能、也不应该声称「完整实现 JMP 箱线图」。** JMP 没有单一「箱线图工具」，而是至少三条产品路径，箱只是其中一种图元：

| JMP 入口 | 箱线图角色 | 官方出处 |
|---|---|---|
| Graph > Graph Builder，箱线图元素 | 交互探索图：离群值箱 / 分位数箱 + 抖动、颜色、嵌套分区 | [Box Plot (JMP 19.1)](https://www.jmp.com/support/help/en/19.1/jmp/box-plot.shtml) |
| Analyze > Distribution | 单变量分布旁的离群值箱（默认）或分位数箱 | [Outlier Box Plot (JMP 19.1)](https://www.jmp.com/support/help/en/19.1/jmp/outlier-box-plot.shtml) |
| Analyze > Fit Y by X（Oneway） | 连续 Y × 分类 X；Display Options 可叠离群值箱、均值菱形、比较圆等 | [Oneway Platform Options (JMP 19.2)](https://www.jmp.com/support/help/en/19.2/jmp/the-oneway-platform-options.shtml) |

ToolHub 当前实现的是 **一条数值列 + 可选一个分组列的 Tukey 离群值箱**，外加前端 Min-Max 须线切换。这已经覆盖 JMP 离群值箱的**几何核心**（Q1–Q3 箱、中位线、须线到 1.5×IQR 内最远点、箱外点为离群值），但距离 Graph Builder 选项集仍有明显缺口，距离 Oneway「分析页」则是另一类产品。

**可完整对齐的范围（建议产品定义）：** Graph Builder 的 **Outlier Box Plot** 主路径（Tukey 须线 + 离群点 + 五数 + 单层分组）。  
**不能完整对齐的范围：** Graph Builder 全选项 + Distribution 定制 + Oneway 均值检验/比较圆 + 嵌套分区/颜色/频数权重。把后者塞进现有 `POST /tools/box-plot/analyze` 会把工具从「画箱」变成「迷你 JMP」。

另有一个**数值不可互操作**的硬差距：四分位算法不同，同样数据的 Q1/Q3/围栏/离群点集合可以和 JMP 对不上。见 §5.2。

## 3. ToolHub 现状（仓库事实）

### 3.1. 数据与接口

- 上传 CSV / XLSX / XLS，同步分析，无任务轮询。[`index.tsx` API 注释](../../frontend/src/pages/tools/box-plot/index.tsx)
- `POST /tools/box-plot/columns` 推断列类型；`POST /tools/box-plot/analyze` 返回各组统计。[`box_plot.py`](../../backend/app/api/endpoints/box_plot.py)
- 每组字段：`count, min, q1, median, q3, max, iqr, fence_low/high, whisker_low/high, outlier_count, outliers`（离群点每组最多 500）。[`GroupStatModel`](../../backend/app/schemas/box_plot.py)
- **不回传组内全部原始点、均值、标准差、置信区间。** 前端无法在不改契约的前提下画全量散点或均值菱形。

### 3.2. 统计约定

[`service.py`](../../backend/app/services/boxplot/service.py)：

- 分位数：`quantile(..., interpolation="linear")`，文档写明 **Hyndman-Fan R7**（与 numpy 默认、Excel `QUARTILE.INC` 一致）。
- 围栏：`Q1 - 1.5×IQR`、`Q3 + 1.5×IQR`。
- 须线：围栏内最远观测；之外计入离群点。
- 分组上限 200；无效值（空、非有限）跳过。

### 3.3. 图形与交互

[`chart.tsx`](../../frontend/src/pages/tools/box-plot/chart.tsx)、[`index.tsx`](../../frontend/src/pages/tools/box-plot/index.tsx)：

- ECharts `boxplot` + 离群点 `scatter`。
- 须线模式：`tukey` | `minmax`（minmax 只改渲染，后端仍按 Tukey 算离群点）。
- 可选数值标签（Q1/中位/Q3 等）。
- Tooltip 与下方统计表给出五数、IQR、离群个数。
- 导出 SVG / PNG。
- **没有**水平方向、全量点、抖动、均值菱形、缺口箱、最短半集、按 n 调箱宽、第二分组/颜色、分位数刻度须线。

## 4. JMP 箱线图能力清单（官方）

### 4.1. Graph Builder 箱线图元素

来源：[JMP 19.1 Box Plot](https://www.jmp.com/support/help/en/19.1/jmp/box-plot.shtml)、[中文 18.2 箱线图](https://www.jmp.com/support/help/zh-cn/18.2/jmp/box-plot.shtml)。

| 能力 | JMP 文档要点 |
|---|---|
| 箱体 | 第 25–75 百分位，间距为 IQR；箱内标中位数 |
| 离群值箱 | 须线到距箱端 1.5×IQR 内最后一个点 |
| 分位数箱 | 须线覆盖全部观测，并在特定分位数处打刻度 |
| 变量角色 | 一连续 + 一名义/有序 → 每水平一箱；两连续 → 响应轴上的连续变量按另一连续变量的水平分箱 |
| 抖动 | None / Auto / Random Uniform / Random Normal / Density Random / Packed / Grid / Hex Grid / Beeswarm |
| 离群值开关 | 显示或隐藏须线外的点 |
| 框类型 | 离群值箱 vs 分位数箱 |
| 框样式 | Normal（空心+中位线）、Solid（填色，中位为空白）、Thin（无箱体，中位为点） |
| 5 数汇总 | 在图上标注 min / Q1 / median / Q3 / max |
| 宽度比例 | 调整箱宽 |
| 置信菱形 | 均值的 95% 置信区间菱形 |
| 锯齿状（Notched） | 在中位数处做缺口；跨度公式在帮助页以公式图给出（抓取文本未展开该式） |
| 围栏线（Fences） | 须线末端的竖线 |
| 最短半集 | 覆盖最密 50% 观测的括号（Rousseeuw and Leroy） |
| 响应轴 | 两变量皆连续时可选 |
| 箱放置 | 有分组时对齐或错开 |
| 按计数缩放 | 分类轴 Size By > Count，箱宽与样本量成比例 |
| Color / Size / Shape / Freq | Graph Builder 区域变量，可作用于箱元素 |

学术一页纸补充：Graph Builder 可叠加点图（按住 Shift 点选点图图标）；比较箱可把分类变量放到 X，再把第二分类放到 Group X。[JMP Learning Library Box Plots PDF (Oct 2025)](https://www.jmp.com/content/dam/jmp/documents/en/academic/learning-library/03-data-visualization-and-descriptive-statistics/03-07-box-plots.pdf)

### 4.2. Distribution 离群值箱 / 分位数箱

来源：[Outlier Box Plot (JMP 19.1)](https://www.jmp.com/support/help/en/19.1/jmp/outlier-box-plot.shtml)、[Quantile Box Plot (JMP 19.0)](https://www.jmp.com/support/help/en/19.0/jmp/quantile-box-plot.shtml)、[中文离群值箱线图](https://www.jmp.com/support/help/zh-cn/18.2/jmp/outlier-box-plot.shtml)。

- 默认显示离群值箱（行数 < 100,000 时；阈值可在 Preferences > Platforms > Distribution 改）。
- 别名：Tukey outlier box plot / schematic box plot。
- 须线定义与 Graph Builder 离群值箱相同：到 `Q1-1.5×IQR` / `Q3+1.5×IQR` 内最远点。
- **置信菱形**：穿过菱形中部为均值；上下顶点为均值 95% 置信限。
- **最短半集**括号：最密集的 50% 观测。
- 分位数箱用来对照 Quantiles 报告里的分位是否对称。
- 可在图上 Customize 去掉菱形或最短半集，也可在平台首选项里全局关掉。

### 4.3. Fit Y by X / Oneway（现场常说的「JMP 箱线图」）

来源：[Oneway Platform Options (JMP 19.2)](https://www.jmp.com/support/help/en/19.2/jmp/the-oneway-platform-options.shtml)、[Mean Diamonds (JMP 18.2)](https://www.jmp.com/support/help/en/18.2/jmp/mean-diamonds-and-xaxis-proportional.shtml)、[Display Options (JMP 16.2)](https://www.jmp.com/support/help/en/16.2/jmp/display-options.shtml)。

默认图是 **按组散点**，不是箱。Display Options > Box Plots 才叠离群值箱。同一红三角还可叠：

- Points
- Mean Diamonds（组均值 + 等方差假定下的 (1-α)×100 置信区间；高度与 1/√n 成比例）
- X-Axis Proportional（组间距与样本量成比例）
- Mean Lines / Error Bars / Std Dev Lines / Grand Mean / Connect Means
- Comparison Circles（需先开 Compare Means：Each Pair Student's t 等）
- Quantiles 报告：0 / 10 / 25 / 50 / 75 / 90 / 100，并激活箱

这些是 **Oneway 分析图元**，不是 Graph Builder 箱元素的子集。比较圆、ANOVA、Means/Anova 报告属于假设检验产品，不是「把箱画全」。

### 4.4. JMP 分位数算法（与 ToolHub 不一致）

来源：[Statistical Details for Quantiles (JMP 19.0)](https://www.jmp.com/support/help/en/19.0/jmp/statistical-details-for-quantiles.shtml)、[Col Quantile (JMP 18.2)](https://www.jmp.com/support/help/en/18.2/jmp/statistical-functions.shtml)。

JMP Distribution：将 n 个非缺失值排序后，第 p 百分位的秩 **r = (n+1)p/100**；r 为整数取该秩，否则在相邻秩线性插值。这是 Hyndman-Fan **Type 6**，不是 ToolHub 的 **Type 7**（R7：`r = 1+(n-1)p`）。

社区说明 Graph Builder 与 Distribution 用同一套分位计算。[JMP Blog: Detecting outliers using quantile ranges](https://community.jmp.com/t5/JMP-Blog/Outliers-Episode-2-Detecting-outliers-using-quantile-ranges/ba-p/341727)（非帮助页，仅作「两平台算法相同」旁证）。

**含义：** 即使用户把须线、离群规则都设成 Tukey，Q1/Q3 仍可能与 JMP 差一个插值台阶，进而围栏和离群点集合不同。要对齐 JMP 数字，必须增加 Type 6（或显式「JMP 分位」）选项，而不是只改画法。

## 5. 差距对照

图例：已有 / 可加（现有架构内） / 需改契约或新模块 / 超出箱线图工具。

| 能力 | JMP | ToolHub | 判定 |
|---|---|---|---|
| Tukey 离群值箱（1.5 IQR 须线） | Graph Builder / Distribution / Oneway | 有，且与官方须线文字一致 | 已有 |
| Min–Max 须线 | 分位数箱覆盖全范围（另有分位刻度） | 有 `minmax` 渲染，无分位刻度 | 部分 |
| 分位数箱（全范围 + 分位刻度） | 有 | 无 | 可加 |
| 五数表 / tooltip | 有 | 有表 + tooltip | 已有 |
| 图上 5 数文字 | 有 | 可选标签，不是 JMP 那种可拖位置的 Caption | 可加 |
| 离群点绘制 | 有，可开关 | 有；每组最多回传 500 个 | 部分（截断） |
| 全量原始点 + 抖动/蜂群 | Graph Builder Jitter 九种；Oneway Points | 无（接口无全量点） | 需改契约 |
| 置信菱形（均值 95% CI） | 有 | 无均值/方差 | 需改契约 |
| 最短半集 | 有 | 无 | 需改契约（要原始点或预计算区间） |
| Notched 箱 | 有 | 无 | 可加（公式需再从帮助页公式图确认） |
| 须线末端围栏竖线 | 有 | 无 | 可加 |
| 箱样式 Normal/Solid/Thin | 有 | 固定空心箱 | 可加 |
| 箱宽 ∝ n | Size By Count；Oneway X-Axis Proportional | 固定 boxWidth | 可加 |
| 单分类分组 | 有 | 有，上限 200 组 | 已有 |
| 嵌套 Group X/Y、Wrap、Color、Overlay | Graph Builder 区域 | 无 | 需新交互模型 |
| 水平箱 | 响应轴可换 | 仅竖直 | 可加 |
| 多 Y 并排 | Graph Builder 多 Y | 一次一列 | 可加（多次分析或改请求） |
| 均值线 / 误差线 / 连接均值 | Oneway | 无 | 需改契约 |
| 比较圆 / ANOVA / t 检验 | Oneway Compare Means | 无 | 超出（新分析产品） |
| 分位算法与 JMP 一致 | Type 6，`r=(n+1)p` | Type 7，R7 | 可加选项 |
| 导出图 | JMP 图形导出 | SVG/PNG | 已有（能力级，非像素级仿 JMP） |

## 6. 「完整实现」是否可行

### 6.1. 不可行：把 JMP 当作一个功能清单一次性做完

原因不是画图库不够（ECharts 箱 + 散点能画几何；自定义 series 能画菱形和括号），而是：

1. **产品边界不同。** JMP 箱出现在探索器、单变量分布、单因素均值比较三条路径里。比较圆和 ANOVA 不是箱的装饰，是检验平台。
2. **数据契约不足。** 当前 analyze 只返回摘要 + 截断离群点。全量点、均值 CI、最短半集都要原始样本或额外统计量。
3. **分位定义不同。** 不改算法就无法通过「和 JMP 导出数字对表」验收。
4. **交互密度。** Graph Builder 的区域拖放、九种抖动、Color/Size/Freq 是桌面统计 IDE 的交互，不是当前「上传 → 选两列 → 出图」工作流。

### 6.2. 可行：分三档对齐，而不是「完整 JMP」

**档 A — 数字与 Tukey 箱对齐（建议作为「能和 JMP 对上」的最小承诺）**

- 增加分位算法选项：`R7`（现状）/ `JMP`（Type 6）。
- 须线保持 Tukey；可选画出围栏竖线。
- 离群点取消或提高 500 上限，或对超限组改抽样策略并在 UI 标明。
- 验收：同一 CSV，JMP Distribution 离群值箱的 Q1/Q3/须线/离群名单与工具一致（允许浮点误差）。

**档 B — Graph Builder 离群值箱观感（仍是箱线图工具）**

- 回传或另接口提供：`mean, sd, n`（菱形）、最短半集两端、可选全量或分层抽样点。
- 前端：均值菱形、最短半集括号、Notched、箱样式、水平、箱宽∝n、简单 jitter（先 Random Uniform / Beeswarm 一种）。
- 不包含 Color 嵌套、Wrap 分页、比较圆。

**档 C — Oneway 分析页（不建议挂在现有箱线图工具上）**

- 比较圆、ANOVA、Connect Means、X 轴按 n 比例，等于新工具或箱线图的「分析模式」。
- 工作量、统计正确性和文案责任都远高于画箱；与现有「同步摘要图」契约冲突。

### 6.3. 工作量粗估（仅工程，不含统计验收样本库）

| 档 | 主要改动 | 量级 |
|---|---|---|
| A | 后端 Type 6 分位 + 测试对表；前端算法开关 | 小（数天） |
| B | 扩展 analyze 载荷 + ECharts 自定义系列 + 点抖动 | 中（数周） |
| C | 新统计模块、多重比较、新 UI | 大（按产品另开） |

ECharts 没有官方「均值菱形 / 最短半集 / 比较圆」。档 B/C 都要自定义 graphic 或第二坐标系，不是改 `boxplot` 配置能结束。

## 7. 建议的产品表述

对外不要写「JMP 兼容箱线图」，除非完成档 A 的对表验收。

更准确的表述：

> Tukey 离群值箱（1.5×IQR），四分位默认 Hyndman-Fan R7；可选与 JMP Distribution 相同的 Type 6 分位，以便和 JMP 数字对齐。不覆盖 JMP Graph Builder 全选项，也不覆盖 Fit Y by X 的均值比较。

若现场痛点是「和工程师手里的 JMP 图长得像、数字对得上」，做 **档 A + 档 B 的菱形/全量点/jitter** 即可覆盖绝大多数对照场景。若痛点是「在网页里做完 Oneway」，应单独立项，不要继续加开关污染现有箱线图。
