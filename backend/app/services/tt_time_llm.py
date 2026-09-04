"""TT 时间分析建议 — 对接本地大模型生成中文诊断结论。

纯服务层：接收前端传来的统计结构，构造一段面向本地大模型的简洁中文提示词，
再经 OpenAI 兼容的 /v1/chat/completions 调用本地模型端点（Ollama / llama.cpp
server），返回模型生成的诊断文本。

设计约束：
- 只给模型"测试时间(秒)"的客观统计（样本量/五数/均值/长尾），并把"样本量=条数"
  与"测试时间=秒"的语义显式讲清，避免小模型把测试条数当成耗时。
- 输出要求结构化为 Markdown 短结构（1 整体水平 / 2 正常范围 / 3 分布形态 /
  4 改善方案），前端组件直接按 Markdown 渲染。
"""

from __future__ import annotations

import re
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

    try:
        thr = float(tail.get("iqrThreshold") or 0)
        oc = int(tail.get("outlierCount") or 0)
        op = float(tail.get("outlierPercent") or 0)
    except (TypeError, ValueError):
        thr, oc, op = 0, 0, 0
    extra = ""
    if total_rows and thr > 0 and oc > 0:
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
        "说明依据。\n"
        "4. **改善方案**：仅当右偏明显或存在异常样本时给出，用“建议：……”句式写明"
        "具体动作；从两类切入——机台状态（执行机构、信号/接口、工装、校准偏移）或"
        "测试程序（某测试步骤耗时、重复测试、程序分支卡滞），结合“长尾阈值、异常占比、"
        "最大值”给出 1~2 条可执行动作；若分布正常，写“无显著异常，无需干预”。\n"
        "【铁律】只能引用上面实际出现的数字；禁止编造任何数值、百分比或区间；"
        "不提及数据里没有的指标（单机台耗时、规格、良率）。"
    )


def _strip_code_fence(text: str) -> str:
    """去掉模型给正文包上的 ```markdown/``` 围栏，及思考模型泄漏的标记 token。"""
    # 思考标记（如 K2 的 </ifm|think_faster>、<|im_start|think>）以 <..|..> 或 <|..|> 形式出现在正文，
    # 只影响可读性，安全剔除。
    cleaned = re.sub(r"<[^<>]*\|[^<>]*>", "", text)
    # 再剔除 <think>...</think> 块与孤立的 </?think> 标签（大小写不敏感）
    cleaned = re.sub(
        r"<think\b[^>]*>[\s\S]*?</think>", "", cleaned, flags=re.IGNORECASE
    )
    cleaned = re.sub(r"</?think\b[^>]*>", "", cleaned, flags=re.IGNORECASE)
    stripped = cleaned.strip()
    if stripped.startswith("```"):
        lines = stripped.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        while lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        stripped = "\n".join(lines).strip()
    return stripped


def call_llama(user_text: str) -> str:
    """调用本地模型的 OpenAI 兼容端点，返回模型生成的文本。"""
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
    # 思考强度：置空则交由模型默认（开启思考的模型保持默认思考）。
    if settings.LLM_REASONING_EFFORT:
        payload["reasoning_effort"] = settings.LLM_REASONING_EFFORT
    # 注：上下文窗口(num_ctx)无法在 OpenAI 兼容端点逐请求设置，
    # 需在服务端放大（Ollama: OLLAMA_CONTEXT_LENGTH；llama.cpp: --ctx-size）。

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

    return _strip_code_fence(content)
