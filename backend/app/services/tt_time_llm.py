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
        "  - 样本数(count) = 该范围内的测试条数，单位是\"条\"，不是秒。\n"
        "  - 测试时间(TT) = 单条测试耗时，单位一律是\"秒(s)\"。\n"
        "  - min/Q1/Q2/Q3/max 都是测试时间(秒)，Q2 即中位数。\n"
        "  请严格区分\"条数\"和\"秒\"，不要把机台的测试条数当成它的测试时间。"
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
    dist_block = "\n测试时间分箱占比（以下区间与占比是唯一权威数据，不可自行拆分或改名）：\n"
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
        top_stations = sorted(
            stations, key=lambda s: s.get("count", 0), reverse=True
        )[:8]
        station_block = (
            "\n机台样本条数（前 8，仅反映该机台产出的测试条数，与每条耗时长短无关）：\n"
            + "\n".join(
                f"  - {s.get('id')}: {s.get('count')} 条" for s in top_stations
            )
        )

    # ---- 6. 业务场景说明（纯测试时间分析）----
    # 注意：TT = EndTime - StartTime，纯测试环节时间，不含上下料/扫码等过程细分。
    # 改进计划只能基于已给出的测试时间数字，不臆造上下料/治具等字段外的环节。
    factory = (
        "\n\n业务背景（贴合工厂测试站）：这里的测试时间(TT) 是由导出的"
        " StartTime、EndTime 之差得到的纯测试环节耗时（单位秒），用于评估产线单机测试耗时"
        " 与异常。分析目标是\"降低纯测试时间\"与\"消除异常长耗时样本\"。"
        " 注意数据只包含测试时间本身，不含上下料、扫码、治具切换等其它过程的细分数据。"
    )

    # ---- 7. 数据可得范围（防 4B 臆造机台耗时）----
    availability = (
        "\n\n数据可得范围（重要）：本轮只提供了总体统计（五数、百分位、分箱占比）"
        " 以及各机台的测试条数；没有提供\"每个机台的测试时间(秒)\"数据，"
        " 也没有治具/程序/上下料等过程明细。"
        " 因此不得用机台测试条数推断该机台耗时长短或测试快慢，不要臆造过程数据；"
        " 分析只能依据给出的数字。"
    )

    # ---- 8. 任务指令与输出格式（重点防编数）----
    instructions = (
        "\n\n请基于以上数字，在\"工厂测试站\"场景下输出分析结论与改进计划。要求：\n"
        "  铁律（违反即视为错误）：\n"
        "    - 只能引用本提示里实际出现的数字（min/Q1/Q2/Q3/max、p50-p99、长尾"
        "      {阈值}/{条数}/{占比}、分箱里的 label/count/percent）。\n"
        "    - 绝对禁止编造或改写任何条数、百分比、区间上限。例如：数据里没有\"118-120秒 261条"
        "      6.2%\"就绝不能写出来；更不能用\"区间A内部的样本\"推导\"超过区间B上限\"这种"
        "      自相矛盾的说法（区间内的样本必然小于等于该区间上限）。\n"
        "    - 长尾占比直接用已给的真实占比（如\"{占比}%\"），不要自行另算。\n"
        "  1. 判断（1./2./3. 分点，每条引用具体数字）：\n"
        "     a) 集中性：Q1-Q3 区间宽度 vs 整体范围，Q2 附近是否集中？\n"
        "     b) 长尾/离群：直接引用已给的长尾阈值与真实占比，说明 max 是否远超阈值；"
        "        若差距小就写\"分布集中，无显著离群\"。\n"
        "     c) 若确有长尾：指出偏高/偏低方向。数据只有测试时间，定位异常耗时原因"
        "        需进一步结合测试项/测试程序排查，不把长尾归因到上下料/治具等"
        "        数据里没有的环节。\n"
        "  2.【改进计划】写成 2-4 条，每条格式：\n"
        "     - 动作：做什么（如\"导出超过长尾阈值(已给)的异常样本清单核查\"）。\n"
        "     - 对应数据：只引用本提示里的真实数字。\n"
        "     - 预期效果：不得凭空给出百分比目标。若数据里没有基准占比，就写成"
        "        \"先导出异常清单，确认其真实占比后再设定目标\"；若已给占比，则写"
        "        \"将该占比降低至当前值的一半以下\"这类用\"当前值相对变化\"的表述，"
        "        而不是编一个具体百分数。\n"
        "     - 验证方式：下一步如何确认（如\"再导出一批同型号数据复核 max/长尾真实占比是否下降\"）。\n"
        "     - 改进方向限定在由测试时间分布能支持的层面（异常样本溯源、测试项/程序耗时、"
        "        多次/重复测试、集中度优化），不得臆造上下料/治具等成分。\n"
        "  3. 全程只判断测试时间(秒)；机台条数只描述样本量，绝不当作耗时依据。\n"
        "  4. 措辞严谨，不编造数字、不提及数据里没有的指标（单机台平均耗时、规格、良率）。\n"
        "  5. 用简体中文，整个输出不超过 400 字。"
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
