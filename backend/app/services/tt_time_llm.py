"""TT 时间分析建议 — 对接本地 llama.cpp 生成中文结论。

纯服务层：接收前端传来的统计结构，构造一份\"足够详细、面向 4B 小模型\"的
提示词，再经 OpenAI 兼容的 /v1/chat/completions 调用本地 llama.cpp server，
返回模型生成的结论文本。

设计约束：
- 提示词必须显式区分\"样本数（测试条数）\"与\"测试时间（秒）\"，避免 4B 模型把
  机台条目数误当成时间。
- 显式声明\"数据可得范围\"：机台维度只有条数、没有各机台耗时(秒)，禁止模型用
  条数推断机台耗时瓶颈。
- 给 4B 模型提供客观离群判据（max 与 Q3 的差距），避免其臆造\"长尾\"。
- 输出要求结构化，便于前端直接展示。
"""

from __future__ import annotations

from typing import Any

import httpx
from loguru import logger

from app.core.config import settings

# 本地 LLM 未配置或调用失败时端点返回该状态码，前端据此提示
LLM_UNAVAILABLE_STATUS = 503


class LlmUnavailableError(RuntimeError):
    """本地大模型不可用（未配置 / 连接失败 / 返回非 2xx）。"""


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
    """把统计结构加工成一份适合 4B 模型的详细中文提示词。"""

    stats = data.get("stats") or {}
    dist = data.get("distribution") or []
    pcts = data.get("percentiles") or {}
    stations = data.get("stations") or []
    total_rows = int(data.get("totalRows") or 0)

    # ---- 1. 字段语义说明（消歧义，关键）----
    semantic = (
        "字段语义约定：\n"
        '  - 样本数(count) = 该范围内的测试条数，单位是"条"，不是秒。\n'
        '  - 测试时间(TT) = 单条测试耗时，单位一律是"秒(s)"。\n'
        "  - min/Q1/Q2/Q3/max 都是测试时间(秒)，Q2 即中位数。\n"
        '  请严格区分"条数"和"秒"，不要把机台的测试条数当成它的测试时间。'
    )

    # ---- 2. 范围 ----
    scope = (
        f"\n分析范围：{data.get('fileName', '')!r}"
        f" | 筛选机台：{data.get('stationFilter', '')}"
        f" | 样本数：{total_rows} 条"
    )

    # ---- 3. 五数 + 百分位 ----
    summary = (
        "\n测试时间(秒)五数概括："
        f" min={_fmt(stats.get('min'))}, Q1={_fmt(stats.get('q1'))},"
        f" Q2(中位)={_fmt(stats.get('q2'))}, Q3={_fmt(stats.get('q3'))},"
        f" max={_fmt(stats.get('max'))}"
    )
    tail = ""
    if total_rows:
        gap = None
        iqr = None
        try:
            q3 = float(stats.get("q3"))
            q1 = float(stats.get("q1"))
            mx = float(stats.get("max"))
            gap = mx - q3
            iqr = q3 - q1
        except (TypeError, ValueError):
            gap = None
        tail = (
            "\n分布特征："
            f" p50={_fmt(pcts.get('p50'))}, p90={_fmt(pcts.get('p90'))},"
            f" p95={_fmt(pcts.get('p95'))}, p99={_fmt(pcts.get('p99'))}。"
            f" max-Q3={_fmt(gap)} 秒，Q3-Q1={_fmt(iqr)} 秒。"
        )

    # ---- 4. 分箱分布 ----
    dist_block = (
        "\n测试时间分箱占比（以下区间与占比是唯一权威数据，不可自行拆分或改名）：\n"
    )
    if dist:
        dist_block += "\n".join(
            f"  - {b.get('label')}: {b.get('count')} 条 ({b.get('percent', 0):.1f}%)"
            for b in dist[:15]
        )
    else:
        dist_block += "  - （无数据）"

    # ---- 4.1 长尾真实统计（前端从原始样本精确算出，模型只引用不计算）----
    tail_block = ""
    tail_stats = data.get("tail") or {}
    try:
        thr = float(tail_stats.get("iqrThreshold") or 0)
        oc = int(tail_stats.get("outlierCount") or 0)
        op = float(tail_stats.get("outlierPercent") or 0)
    except (TypeError, ValueError):
        thr, oc, op = 0, 0, 0
    if total_rows and thr > 0:
        tail_block = (
            "\n长尾阈值（已算好，请直接引用）：超过 Q3+1.5*(Q3-Q1) = "
            f"{_fmt(thr)} 秒的样本视为长尾/异常。\n"
            f"该阈值以上的真实异常样本：{oc} 条（占比 {op:.1f}%）。\n"
            "这些百分比是已核实的真实数字，不要自行改写或另算区间占比。"
        )

    # ---- 5. 机台对比（仅全部机台时，只给条数）----
    station_block = ""
    if stations and total_rows and str(data.get("stationFilter", "")) == "all":
        top_stations = sorted(stations, key=lambda s: s.get("count", 0), reverse=True)[
            :8
        ]
        station_block = (
            "\n机台样本条数（前 8，仅反映该机台产出的测试条数，与每条耗时长短无关）：\n"
            + "\n".join(f"  - {s.get('id')}: {s.get('count')} 条" for s in top_stations)
        )

    # ---- 6. 业务场景说明（纯测试时间，无上下料等动作）----
    # 注意：TT = EndTime - StartTime，纯测试环节时间，不含上下料/扫码等过程细分。
    # 异常原因只能归因于机台状态或测试程序本身，不得臆造上下料等环节。
    factory = (
        "\n\n业务背景（工厂测试工站单机测试）：这里 TT = EndTime - StartTime，是单条"
        " 测试在工站上的纯测试时间（秒）。这段时长不包含任何上下料/装夹/扫码/取放等动作，"
        " 只反映机台执行测试与测试程序运行所花的时间。因此本批数据里的异常测试时间，"
        " 其根因只可能来自两类：机台问题（执行机构、信号/接口、工装状态、校准等）"
        " 或测试程序/测试项问题（某步骤耗时、重复测试、程序分支卡滞等）。"
    )

    # ---- 7. 数据可得范围（防 4B 臆造机台耗时）----
    availability = (
        "\n\n数据可得范围（重要）：本轮只提供总体统计（五数、百分位、长尾阈值与占比、分箱占比），"
        " 没有各机台耗时(秒)，也没有测试项/程序步骤级明细。因此：不得用机台条数推断耗时；"
        " 归因只能落到机台状态或测试程序这两个方向并给出排查切入点，"
        " 不要臆造本提示里没有的工序细节。"
    )

    # ---- 8. 任务指令与输出格式（只分析异常值 + 应对/解决/验证）----
    instructions = (
        "\n\n你的任务：只针对这批测试时间里的异常值做分析，并给出机台/程序层面的应对、"
        " 解决与验证方法。不要泛谈整体集中性，也不要涉及上下料等环节（本批数据无此环节）。要求：\n"
        "  一、异常判定（先给结论，引用已给数字）：\n"
        "     1) 用长尾阈值（{阈值} 秒）判定是否存在异常测试时间：max 是否超出阈值、超出多少秒。\n"
        "     2) 若存在异常：引用异常样本 {条数} 条（占比 {占比}%），并结合分箱区间说明"
        "        异常主要落在哪个高耗时档位（高于阈值的那一档）。\n"
        '     3) 若 max 与阈值差距小或不存在长尾：写"分布正常，无显著异常测试时间"即可结束，'
        "        不要硬造问题。\n"
        "  二、应对 / 解决 / 验证（仅当存在异常时给出，按机台、程序两类排查）：\n"
        "     每条给出三项：\n"
        "       - 排查切入点：机台层面（如执行机构/信号接口/工装状态/校准偏移）或程序层面"
        "         （如某测试步骤耗时/重复测试/程序分支卡滞），必须对应上面判定的异常档位与数据。\n"
        "       - 解决动作：具体处置方式（校准或检修相关部件、核对测试程序参数、复查重复测试逻辑等）。\n"
        "       - 验证方法：如何确认已解决（如复查同型号后续批次的 max / 长尾真实占比是否回落到正常档位）。\n"
        "  铁律（违反即视为错误）：\n"
        "    - 只能引用本提示里实际出现的数字（min/Q1/Q2/Q3/max、p50-p99、长尾"
        "      {阈值}/{条数}/{占比}、分箱里的 label/count/percent），禁止编造或改写任何条数、百分比、区间。\n"
        "    - 全程只分析纯测试时间(秒)；机台条数只描述样本量，绝不当作耗时依据。\n"
        "    - 异常只归因机台问题或测试程序问题，绝不归因上下料/扫码/治具/换线等本批数据"
        "      不存在的环节；不提及数据里没有的指标（单机台平均耗时、规格、良率）。\n"
        "  输出用简体中文，结构：一、异常判定；二、应对/解决/验证。整个输出不超过 400 字。"
    )

    return (
        "你是一名资深测试工站生产数据分析工程师。下面是一批产品的测试时间(TT)统计。"
        + scope
        + "\n\n"
        + semantic
        + "\n"
        + summary
        + tail
        + tail_block
        + dist_block
        + station_block
        + factory
        + availability
        + instructions
    )


def call_llama(user_text: str) -> str:
    """调用本地 llama.cpp 的 OpenAI 兼容端点，返回模型生成的文本。"""
    base_url = settings.LLM_BASE_URL.rstrip("/")
    model = settings.LLM_MODEL
    api_key = settings.LLM_API_KEY
    url = f"{base_url}/chat/completions"

    payload: dict[str, Any] = {
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": (
                    "你是一名严谨的测试工站生产数据分析工程师。"
                    "只依据用户提供的统计数字作答，不臆造；默认使用简体中文。"
                ),
            },
            {"role": "user", "content": user_text},
        ],
        "max_tokens": settings.LLM_MAX_TOKENS,
        "stream": False,
    }
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    try:
        with httpx.Client(timeout=settings.LLM_TIMEOUT_SECONDS) as client:
            resp = client.post(url, json=payload, headers=headers)
    except httpx.HTTPError as exc:  # 连接失败 / 超时等
        logger.warning("本地 LLM 调用失败: {}", exc)
        raise LlmUnavailableError("本地大模型连接失败或超时") from exc

    if resp.status_code != 200:
        logger.warning("本地 LLM 返回 HTTP {}: {}", resp.status_code, resp.text[:300])
        raise LlmUnavailableError(f"本地大模型返回 HTTP {resp.status_code}")

    try:
        body = resp.json()
        content = body["choices"][0]["message"]["content"]
    except (KeyError, IndexError, ValueError) as exc:  # 响应结构异常
        logger.warning("本地 LLM 响应解析失败: {}", resp.text[:300])
        raise LlmUnavailableError("本地大模型响应格式异常") from exc

    if not content or not content.strip():
        raise LlmUnavailableError("本地大模型返回空内容")

    return content.strip()
