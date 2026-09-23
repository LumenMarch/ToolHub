"""TT 时间分析建议的领域提示词。

这里只放「TT、机台、IQR」这类工站领域知识；HTTP、超时、并发一律不出现 ——
那些在全局网关（app/services/llm）里。工具对模型服务的全部诉求就是：
「把这组统计数字变成一段中文诊断」。

提示词里的术语定义与输出结构都是按实测行为调出来的，改动前先想清楚
是否会破坏「只引用真实出现的数字」这条铁律。
"""

from __future__ import annotations

from typing import Any

from app.services.llm import ChatMessage, LlmRequest


def _fmt(v: float | int | None) -> str:
    """数字格式化：整数不带小数，否则保留 1 位。"""
    if v is None:
        return "-"
    try:
        num = float(v)
    except (TypeError, ValueError):
        return str(v)
    return str(int(num)) if num.is_integer() else f"{num:.1f}"


def build_analysis_prompt(data: dict[str, Any]) -> str:
    """把统计结构加工成一段简洁的概览诊断提示词。"""

    stats = data.get("stats") or {}
    tail = data.get("tail") or {}
    total_rows = int(data.get("totalRows") or 0)

    station_filter = str(data.get("stationFilter") or "all")
    station_desc = "全部机台" if station_filter in ("", "all") else station_filter
    file_label = str(data.get("fileName") or "当前数据") or "当前数据"

    lines = [
        f"- 样本量：{total_rows} 条",
        f"- 最小值/最大值：{_fmt(stats.get('min'))} 秒 / {_fmt(stats.get('max'))} 秒",
        (
            "- 四分位数（Q1 / 中值 / Q3）："
            f"{_fmt(stats.get('q1'))} / {_fmt(stats.get('q2'))} / "
            f"{_fmt(stats.get('q3'))} 秒"
        ),
    ]
    mean = stats.get("mean")
    if mean is not None:
        lines.append(f"- 平均值：{_fmt(mean)} 秒")

    # 高分位给尾部更直接的信号（前端已随请求算好）；p50 与中值(Q2)同义，
    # 不重复给，免得小模型把两个「中值」当成不同指标。
    pct = data.get("percentiles") or {}
    if any(pct.get(key) is not None for key in ("p90", "p95", "p99")):
        lines.append(
            "- 高分位（P90 / P95 / P99）："
            f"{_fmt(pct.get('p90'))} / {_fmt(pct.get('p95'))} / "
            f"{_fmt(pct.get('p99'))} 秒"
        )

    try:
        thr = float(tail.get("iqrThreshold") or 0)
        oc = int(tail.get("outlierCount") or 0)
        op = float(tail.get("outlierPercent") or 0)
    except (TypeError, ValueError):
        thr, oc, op = 0, 0, 0
    extra = ""
    # oc=0 时也要显式给出「0 条」：否则输出要求第 3 节让模型援引异常占比
    # 与长尾阈值，模型手里却没这两个数，只能违反铁律编造或把该节写残。
    if total_rows and thr > 0:
        extra = (
            f"\n补充：超过 Q3+1.5×(Q3-Q1) = {_fmt(thr)} 秒的异常样本 "
            f"{oc} 条（占比 {op:.1f}%）。"
        )

    return (
        "你是一名工厂数据分析专家，擅长基于测试时间统计指标给出严谨、简洁的诊断。"
        f"\n请基于以下统计结果，对【{file_label}】（机台：{station_desc}）"
        "的测试时间(TT)进行概览分析：\n\n"
        + "\n".join(lines)
        + extra
        + "\n\n【业务场景（重要，据此归因）】\n"
        "这是工厂测试工站的多机台测试场景：一个测试工站内有多台测试机（机台）并行执行"
        "单条测试。TT = EndTime - StartTime，是单条测试在某台测试机上的纯测试时间（秒），"
        "不包含人工上下料、装夹、扫码、取放等任何过程动作。因此异常根因只可能来自两类——"
        "某台测试机（机台）问题（执行机构、信号/接口、工装状态、校准偏移等）或"
        "测试程序/测试项问题（某测试步骤耗时、重复测试、程序分支卡滞等）；"
        "不要归因于上下料、人工、扫码、治具、换线等本批数据不存在的环节。\n\n"
        "【术语定义（严格按此理解，勿混淆）】\n"
        "- TT 是单条测试的纯测试时间，单位一律为秒(s)；样本量是“测试条数”，"
        "不是时间。\n"
        "- Q1 / 中值(Q2) / Q3 分别指第 25 / 50 / 75 百分位；IQR = Q3 - Q1。\n"
        "- 长尾阈值 = Q3 + 1.5 × IQR（即 5.5s 这类的数），它只用于判定异常样本；"
        "它【不是】Q3，不要把它当成 Q3 或最大最小值使用。\n"
        "- 异常值判定按国际标准（Tukey 箱线图法）：超过 Q3 + 1.5 × IQR（长尾阈值）"
        "的样本记为异常。\n"
        "- 右偏判定：平均值明显大于中值(Q2)即右偏，说明长尾样本拉高了均值。\n\n"
        "【输出要求（简体中文，Markdown 结构，≤280 字，不要代码围栏）】\n"
        "1. **整体水平**：以中值(Q2)为准给一句结论，写明“X 秒”；若数据右偏或存在异常，"
        "一并说明，不要只写“平稳”。\n"
        "2. **正常波动范围**：写明“Q1=…秒 ~ Q3=…秒”，只引用上面的数值，禁止自创区间。\n"
        "3. **分布形态**：比较平均值与中值，判定是否右偏，并援引“异常样本占比/长尾阈值”"
        "说明依据；P95/P99 明显高于中值时，援引具体数值点明尾部偏长。\n"
        "4. **改善方案**：仅当右偏明显或存在异常样本时给出，用“建议：……”句式写明"
        "具体动作；从两类切入——机台状态（执行机构、信号/接口、工装、校准偏移）或"
        "测试程序（某测试步骤耗时、重复测试、程序分支卡滞），结合“长尾阈值、异常占比、"
        "最大值”给出 1~2 条可执行动作；若分布正常，写“无显著异常，无需干预”。\n"
        "【铁律】只能引用上面实际出现的数字；禁止编造任何数值、百分比或区间；"
        "不提及数据里没有的指标（单机台耗时、规格、良率）。"
    )


# 系统提示词：过去被硬编码在 HTTP 调用函数里（导致任何工具想复用模型调用
# 都必须整文件复制），现在回到它该在的地方 —— 它是 tt-time 的领域内容。
SYSTEM_PROMPT = (
    "你是一名严谨的测试工站生产数据分析工程师。"
    "只依据用户提供的统计数字作答，不臆造；默认使用简体中文。"
)


def build_analysis_request(data: dict[str, Any]) -> LlmRequest:
    """把统计结构组装成一次网关补全请求。

    source 会进指标与审计，用于按调用方拆分延迟、失败率与 token 用量。
    """
    return LlmRequest(
        messages=(
            ChatMessage("system", SYSTEM_PROMPT),
            ChatMessage("user", build_analysis_prompt(data)),
        ),
        source="tt-time",
    )
