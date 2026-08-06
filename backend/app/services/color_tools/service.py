"""颜色工具服务。

完整移植 60s 项目的 color.module.ts：颜色格式转换（HEX/RGB/HSL/HSV/CMYK/LAB）、
对比度与无障碍分析、颜色命名、随机颜色生成，以及基于色彩理论的配色方案生成。
随机颜色使用 crypto 安全的 secrets 模块。
"""

import math
import re
import secrets

# 3 位 HEX 展开为 6 位时的逐字符复制
# 有效 HEX 正则（含 # 前缀的 6 位十六进制）
_HEX_PATTERN = re.compile(r"^#[0-9A-F]{6}$")


def _js_round(value: float) -> int:
    """对齐 JS Math.round 语义（非负数场景下即 floor(x + 0.5)）。"""
    return math.floor(value + 0.5)


def normalize_hex(hex_value: str) -> str:
    """规范化 HEX：去首部 #、3 位展开为 6 位、统一大写并补回 # 前缀。"""
    normalized = hex_value.strip()
    if normalized.startswith("#"):
        normalized = normalized[1:]
    if len(normalized) == 3:
        normalized = "".join(char * 2 for char in normalized)
    return "#" + normalized.upper()


def is_valid_hex(hex_value: str) -> bool:
    """判断是否为合法的 6 位 HEX 颜色编码。"""
    return _HEX_PATTERN.match(hex_value) is not None


def hex_to_rgb(hex_value: str) -> dict:
    """HEX 转 RGB，返回 {r, g, b}。"""
    return {
        "r": int(hex_value[1:3], 16),
        "g": int(hex_value[3:5], 16),
        "b": int(hex_value[5:7], 16),
    }


def hex_to_hsl(hex_value: str) -> dict:
    """HEX 转 HSL，返回 {h, s, l}（h 0-360，s/l 0-100）。"""
    rgb = hex_to_rgb(hex_value)
    r_norm = rgb["r"] / 255
    g_norm = rgb["g"] / 255
    b_norm = rgb["b"] / 255

    max_value = max(r_norm, g_norm, b_norm)
    min_value = min(r_norm, g_norm, b_norm)
    delta = max_value - min_value

    h = 0.0
    s = 0.0
    lightness = (max_value + min_value) / 2

    if delta != 0:
        s = (
            delta / (2 - max_value - min_value)
            if lightness > 0.5
            else delta / (max_value + min_value)
        )
        if max_value == r_norm:
            h = ((g_norm - b_norm) / delta + (6 if g_norm < b_norm else 0)) / 6
        elif max_value == g_norm:
            h = ((b_norm - r_norm) / delta + 2) / 6
        else:
            h = ((r_norm - g_norm) / delta + 4) / 6

    return {
        "h": _js_round(h * 360),
        "s": _js_round(s * 100),
        "l": _js_round(lightness * 100),
    }


def hsl_to_hex(h: float, s: float, lightness: float) -> str:
    """HSL 转 HEX（大写 #RRGGBB），对齐 JS 的 HSLToHex。"""
    h_norm = h / 360
    s_norm = s / 100
    l_norm = lightness / 100

    c = (1 - abs(2 * l_norm - 1)) * s_norm
    x = c * (1 - abs(((h_norm * 6) % 2) - 1))
    m = l_norm - c / 2

    if 0 <= h_norm < 1 / 6:
        r, g, b = c, x, 0.0
    elif 1 / 6 <= h_norm < 2 / 6:
        r, g, b = x, c, 0.0
    elif 2 / 6 <= h_norm < 3 / 6:
        r, g, b = 0.0, c, x
    elif 3 / 6 <= h_norm < 4 / 6:
        r, g, b = 0.0, x, c
    elif 4 / 6 <= h_norm < 5 / 6:
        r, g, b = x, 0.0, c
    else:
        r, g, b = c, 0.0, x

    def _channel(channel: float) -> str:
        return format(_js_round((channel + m) * 255), "02X")

    return f"#{_channel(r)}{_channel(g)}{_channel(b)}"


def hex_to_hsv(hex_value: str) -> dict:
    """HEX 转 HSV，返回 {h, s, v, string}。"""
    rgb = hex_to_rgb(hex_value)
    r_norm = rgb["r"] / 255
    g_norm = rgb["g"] / 255
    b_norm = rgb["b"] / 255

    max_value = max(r_norm, g_norm, b_norm)
    min_value = min(r_norm, g_norm, b_norm)
    delta = max_value - min_value

    h = 0.0
    s = 0.0
    v = max_value

    if delta != 0:
        s = delta / max_value
        if max_value == r_norm:
            h = ((g_norm - b_norm) / delta + (6 if g_norm < b_norm else 0)) / 6
        elif max_value == g_norm:
            h = ((b_norm - r_norm) / delta + 2) / 6
        else:
            h = ((r_norm - g_norm) / delta + 4) / 6

    h_rounded = _js_round(h * 360)
    s_rounded = _js_round(s * 100)
    v_rounded = _js_round(v * 100)
    return {
        "h": h_rounded,
        "s": s_rounded,
        "v": v_rounded,
        "string": f"hsv({h_rounded}, {s_rounded}%, {v_rounded}%)",
    }


def hex_to_cmyk(hex_value: str) -> dict:
    """HEX 转 CMYK，返回 {c, m, y, k, string}。"""
    rgb = hex_to_rgb(hex_value)
    r_norm = rgb["r"] / 255
    g_norm = rgb["g"] / 255
    b_norm = rgb["b"] / 255

    k = 1 - max(r_norm, g_norm, b_norm)
    c = 0.0 if k == 1 else (1 - r_norm - k) / (1 - k)
    m = 0.0 if k == 1 else (1 - g_norm - k) / (1 - k)
    y = 0.0 if k == 1 else (1 - b_norm - k) / (1 - k)

    c_rounded = _js_round(c * 100)
    m_rounded = _js_round(m * 100)
    y_rounded = _js_round(y * 100)
    k_rounded = _js_round(k * 100)
    return {
        "c": c_rounded,
        "m": m_rounded,
        "y": y_rounded,
        "k": k_rounded,
        "string": f"cmyk({c_rounded}%, {m_rounded}%, {y_rounded}%, {k_rounded}%)",
    }


def hex_to_lab(hex_value: str) -> dict:
    """HEX 转 LAB（简化的 RGB→XYZ→LAB 转换），返回 {l, a, b, string}。"""
    rgb = hex_to_rgb(hex_value)
    r_norm = rgb["r"] / 255
    g_norm = rgb["g"] / 255
    b_norm = rgb["b"] / 255

    # 伽马校正
    def _gamma(channel: float) -> float:
        return (
            ((channel + 0.055) / 1.055) ** 2.4 if channel > 0.04045 else channel / 12.92
        )

    r_linear = _gamma(r_norm)
    g_linear = _gamma(g_norm)
    b_linear = _gamma(b_norm)

    # 转换到 XYZ（D65 白点归一化）
    x = (r_linear * 0.4124 + g_linear * 0.3576 + b_linear * 0.1805) / 0.95047
    y = (r_linear * 0.2126 + g_linear * 0.7152 + b_linear * 0.0722) / 1.0
    z = (r_linear * 0.0193 + g_linear * 0.1192 + b_linear * 0.9505) / 1.08883

    def _lab_part(value: float) -> float:
        return value ** (1 / 3) if value > 0.008856 else 7.787 * value + 16 / 116

    fx = _lab_part(x)
    fy = _lab_part(y)
    fz = _lab_part(z)

    l_rounded = _js_round(116 * fy - 16)
    a_rounded = _js_round(500 * (fx - fy))
    b_rounded = _js_round(200 * (fy - fz))
    return {
        "l": l_rounded,
        "a": a_rounded,
        "b": b_rounded,
        "string": f"lab({l_rounded}, {a_rounded}, {b_rounded})",
    }


def get_brightness(hex_value: str) -> float:
    """计算颜色感知亮度（0-255）。"""
    rgb = hex_to_rgb(hex_value)
    return (rgb["r"] * 299 + rgb["g"] * 587 + rgb["b"] * 114) / 1000


def get_contrast_ratio(color1: str, color2: str) -> float:
    """计算两种颜色之间的 WCAG 对比度（保留两位小数）。"""

    def _luminance(hex_value: str) -> float:
        rgb = hex_to_rgb(hex_value)
        channels = []
        for value in (rgb["r"], rgb["g"], rgb["b"]):
            normalized = value / 255
            channels.append(
                normalized / 12.92
                if normalized <= 0.03928
                else ((normalized + 0.055) / 1.055) ** 2.4
            )
        return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]

    lum1 = _luminance(color1)
    lum2 = _luminance(color2)
    brightest = max(lum1, lum2)
    darkest = min(lum1, lum2)
    return _js_round(((brightest + 0.05) / (darkest + 0.05)) * 100) / 100


def get_accessibility_info(hex_value: str) -> dict:
    """根据对比度计算无障碍检查结果与最佳文字颜色。"""
    white_contrast = get_contrast_ratio(hex_value, "#FFFFFF")
    black_contrast = get_contrast_ratio(hex_value, "#000000")
    return {
        "aa_normal": white_contrast >= 4.5 or black_contrast >= 4.5,
        "aa_large": white_contrast >= 3 or black_contrast >= 3,
        "aaa_normal": white_contrast >= 7 or black_contrast >= 7,
        "aaa_large": white_contrast >= 4.5 or black_contrast >= 4.5,
        "best_text_color": "#FFFFFF" if white_contrast > black_contrast else "#000000",
    }


def get_color_name(hex_value: str) -> str:
    """根据 RGB 分量推断颜色的中文名称（对齐 60s 的 getColorName）。"""
    rgb = hex_to_rgb(hex_value)
    total = rgb["r"] + rgb["g"] + rgb["b"]

    if total < 100:
        return "深色系"
    if total > 600:
        return "浅色系"

    max_value = max(rgb["r"], rgb["g"], rgb["b"])
    if max_value == rgb["r"] and rgb["r"] > rgb["g"] and rgb["r"] > rgb["b"]:
        return "红色系"
    if max_value == rgb["g"] and rgb["g"] > rgb["r"] and rgb["g"] > rgb["b"]:
        return "绿色系"
    if max_value == rgb["b"] and rgb["b"] > rgb["r"] and rgb["b"] > rgb["g"]:
        return "蓝色系"
    if rgb["r"] > 200 and rgb["g"] > 200 and rgb["b"] < 100:
        return "黄色系"
    if rgb["r"] > 200 and rgb["g"] < 100 and rgb["b"] > 200:
        return "品红系"
    if rgb["r"] < 100 and rgb["g"] > 200 and rgb["b"] > 200:
        return "青色系"

    return "中性色系"


def generate_random_color() -> str:
    """生成随机 HEX 颜色（使用 crypto 安全的 secrets 模块）。"""
    return f"#{secrets.randbelow(256):02X}{secrets.randbelow(256):02X}{secrets.randbelow(256):02X}"


def convert_color_formats(hex_value: str) -> dict:
    """将 HEX 颜色转换为完整格式（对齐 60s 的 convertColorFormats）。"""
    rgb = hex_to_rgb(hex_value)
    hsl = hex_to_hsl(hex_value)

    return {
        "hex": hex_value,
        "name": get_color_name(hex_value),
        "rgb": {
            "r": rgb["r"],
            "g": rgb["g"],
            "b": rgb["b"],
            "string": f"rgb({rgb['r']}, {rgb['g']}, {rgb['b']})",
        },
        "hsl": {
            "h": hsl["h"],
            "s": hsl["s"],
            "l": hsl["l"],
            "string": f"hsl({hsl['h']}, {hsl['s']}%, {hsl['l']}%)",
        },
        "hsv": hex_to_hsv(hex_value),
        "cmyk": hex_to_cmyk(hex_value),
        "lab": hex_to_lab(hex_value),
        "brightness": get_brightness(hex_value),
        "contrast": {
            "white": get_contrast_ratio(hex_value, "#FFFFFF"),
            "black": get_contrast_ratio(hex_value, "#000000"),
        },
        "accessibility": get_accessibility_info(hex_value),
        "complementary": hsl_to_hex((hsl["h"] + 180) % 360, hsl["s"], hsl["l"]),
        "analogous": [
            hsl_to_hex((hsl["h"] - 30 + 360) % 360, hsl["s"], hsl["l"]),
            hsl_to_hex((hsl["h"] + 30) % 360, hsl["s"], hsl["l"]),
        ],
        "triadic": [
            hsl_to_hex((hsl["h"] + 120) % 360, hsl["s"], hsl["l"]),
            hsl_to_hex((hsl["h"] + 240) % 360, hsl["s"], hsl["l"]),
        ],
    }


def is_warm_color(hue: float) -> bool:
    """判断色相是否属于暖色范围。"""
    return (hue >= 0 and hue <= 60) or (hue >= 300 and hue <= 360)


def is_cool_color(hue: float) -> bool:
    """判断色相是否属于冷色范围。"""
    return 120 <= hue <= 270


def constrain_to_warm_range(hue: float) -> float:
    """把色相约束到暖色范围（0-60 或 300-360）。"""
    normalized = ((hue % 360) + 360) % 360
    if 60 < normalized < 300:
        return 300 if normalized > 180 else 60
    return normalized


def constrain_to_cool_range(hue: float) -> float:
    """把色相约束到冷色范围（120-270）。"""
    normalized = ((hue % 360) + 360) % 360
    if normalized < 120 or normalized > 270:
        return 120 if normalized < 120 else 270
    return normalized


def generate_color_palettes(base_hex: str, base_hsl: dict) -> list[dict]:
    """基于色彩理论生成完整配色方案（对齐 60s 的 generateColorPalettes）。"""
    palettes: list[dict] = []

    # 1. 单色配色方案 (Monochromatic)
    palettes.append(
        {
            "name": "单色配色",
            "description": "基于同一色相，通过调整明度和饱和度创建的和谐配色方案，适合营造统一、专业的视觉效果",
            "colors": [
                {
                    "hex": base_hex,
                    "name": "主色",
                    "role": "primary",
                    "theory": "基础色相",
                },
                {
                    "hex": hsl_to_hex(
                        base_hsl["h"], base_hsl["s"], max(10, base_hsl["l"] - 30)
                    ),
                    "name": "深色变体",
                    "role": "dark",
                    "theory": "降低明度",
                },
                {
                    "hex": hsl_to_hex(
                        base_hsl["h"], base_hsl["s"], min(90, base_hsl["l"] + 20)
                    ),
                    "name": "浅色变体",
                    "role": "light",
                    "theory": "提高明度",
                },
                {
                    "hex": hsl_to_hex(
                        base_hsl["h"], max(10, base_hsl["s"] - 20), base_hsl["l"]
                    ),
                    "name": "柔和变体",
                    "role": "muted",
                    "theory": "降低饱和度",
                },
                {
                    "hex": hsl_to_hex(
                        base_hsl["h"], min(100, base_hsl["s"] + 15), base_hsl["l"]
                    ),
                    "name": "鲜艳变体",
                    "role": "vibrant",
                    "theory": "提高饱和度",
                },
            ],
        }
    )

    # 2. 互补配色方案 (Complementary)
    complementary_hue = (base_hsl["h"] + 180) % 360
    palettes.append(
        {
            "name": "互补配色",
            "description": "使用色轮上相对的颜色，创造强烈对比和视觉冲击力，适用于需要突出重点的设计",
            "colors": [
                {
                    "hex": base_hex,
                    "name": "主色",
                    "role": "primary",
                    "theory": "基础色相",
                },
                {
                    "hex": hsl_to_hex(complementary_hue, base_hsl["s"], base_hsl["l"]),
                    "name": "互补色",
                    "role": "complementary",
                    "theory": "色轮对面 +180°",
                },
                {
                    "hex": hsl_to_hex(
                        base_hsl["h"], base_hsl["s"], min(90, base_hsl["l"] + 25)
                    ),
                    "name": "主色浅调",
                    "role": "primary-light",
                    "theory": "主色提高明度",
                },
                {
                    "hex": hsl_to_hex(
                        complementary_hue, base_hsl["s"], min(90, base_hsl["l"] + 25)
                    ),
                    "name": "互补色浅调",
                    "role": "complementary-light",
                    "theory": "互补色提高明度",
                },
            ],
        }
    )

    # 3. 邻近配色方案 (Analogous)
    palettes.append(
        {
            "name": "邻近配色",
            "description": "使用色轮上相邻的颜色，创造自然和谐的渐变效果，常见于自然景观中",
            "colors": [
                {
                    "hex": hsl_to_hex(
                        (base_hsl["h"] - 30 + 360) % 360, base_hsl["s"], base_hsl["l"]
                    ),
                    "name": "邻近色1",
                    "role": "analogous-1",
                    "theory": "色相 -30°",
                },
                {
                    "hex": base_hex,
                    "name": "主色",
                    "role": "primary",
                    "theory": "基础色相",
                },
                {
                    "hex": hsl_to_hex(
                        (base_hsl["h"] + 30) % 360, base_hsl["s"], base_hsl["l"]
                    ),
                    "name": "邻近色2",
                    "role": "analogous-2",
                    "theory": "色相 +30°",
                },
                {
                    "hex": hsl_to_hex(
                        (base_hsl["h"] + 60) % 360, base_hsl["s"], base_hsl["l"]
                    ),
                    "name": "邻近色3",
                    "role": "analogous-3",
                    "theory": "色相 +60°",
                },
            ],
        }
    )

    # 4. 三角配色方案 (Triadic)
    palettes.append(
        {
            "name": "三角配色",
            "description": "在色轮上形成等边三角形的三种颜色，提供丰富对比的同时保持和谐平衡",
            "colors": [
                {
                    "hex": base_hex,
                    "name": "主色",
                    "role": "primary",
                    "theory": "基础色相",
                },
                {
                    "hex": hsl_to_hex(
                        (base_hsl["h"] + 120) % 360, base_hsl["s"], base_hsl["l"]
                    ),
                    "name": "三角色1",
                    "role": "triadic-1",
                    "theory": "色相 +120°",
                },
                {
                    "hex": hsl_to_hex(
                        (base_hsl["h"] + 240) % 360, base_hsl["s"], base_hsl["l"]
                    ),
                    "name": "三角色2",
                    "role": "triadic-2",
                    "theory": "色相 +240°",
                },
            ],
        }
    )

    # 5. 分裂互补配色方案 (Split Complementary)
    palettes.append(
        {
            "name": "分裂互补配色",
            "description": "使用互补色两侧的颜色，比纯互补配色更柔和，同时保持强烈的视觉对比",
            "colors": [
                {
                    "hex": base_hex,
                    "name": "主色",
                    "role": "primary",
                    "theory": "基础色相",
                },
                {
                    "hex": hsl_to_hex(
                        (base_hsl["h"] + 150) % 360, base_hsl["s"], base_hsl["l"]
                    ),
                    "name": "分裂互补色1",
                    "role": "split-comp-1",
                    "theory": "互补色 -30°",
                },
                {
                    "hex": hsl_to_hex(
                        (base_hsl["h"] + 210) % 360, base_hsl["s"], base_hsl["l"]
                    ),
                    "name": "分裂互补色2",
                    "role": "split-comp-2",
                    "theory": "互补色 +30°",
                },
            ],
        }
    )

    # 6. 四边形配色方案 (Tetradic/Square)
    palettes.append(
        {
            "name": "四边形配色",
            "description": "在色轮上形成正方形的四种颜色，提供最丰富的颜色变化，适合复杂的设计项目",
            "colors": [
                {
                    "hex": base_hex,
                    "name": "主色",
                    "role": "primary",
                    "theory": "基础色相",
                },
                {
                    "hex": hsl_to_hex(
                        (base_hsl["h"] + 90) % 360, base_hsl["s"], base_hsl["l"]
                    ),
                    "name": "四边形色1",
                    "role": "square-1",
                    "theory": "色相 +90°",
                },
                {
                    "hex": hsl_to_hex(
                        (base_hsl["h"] + 180) % 360, base_hsl["s"], base_hsl["l"]
                    ),
                    "name": "四边形色2",
                    "role": "square-2",
                    "theory": "色相 +180°",
                },
                {
                    "hex": hsl_to_hex(
                        (base_hsl["h"] + 270) % 360, base_hsl["s"], base_hsl["l"]
                    ),
                    "name": "四边形色3",
                    "role": "square-3",
                    "theory": "色相 +270°",
                },
            ],
        }
    )

    # 7. Web 设计专用配色
    palettes.append(
        {
            "name": "Web 设计配色",
            "description": "专为 Web 界面设计优化的配色方案，考虑了可访问性和用户体验",
            "colors": [
                {
                    "hex": base_hex,
                    "name": "品牌主色",
                    "role": "brand-primary",
                    "theory": "品牌识别色",
                },
                {
                    "hex": hsl_to_hex(
                        base_hsl["h"],
                        max(10, base_hsl["s"] - 15),
                        max(15, base_hsl["l"] - 20),
                    ),
                    "name": "按钮悬停",
                    "role": "hover-state",
                    "theory": "主色加深变体",
                },
                {
                    "hex": hsl_to_hex(
                        base_hsl["h"],
                        max(5, base_hsl["s"] - 25),
                        min(95, base_hsl["l"] + 35),
                    ),
                    "name": "背景浅色",
                    "role": "background",
                    "theory": "高明度低饱和度",
                },
                {
                    "hex": hsl_to_hex(
                        (base_hsl["h"] + 180) % 360,
                        min(100, base_hsl["s"] + 10),
                        max(20, base_hsl["l"] - 10),
                    ),
                    "name": "强调色",
                    "role": "accent",
                    "theory": "互补色系强调",
                },
                {
                    "hex": "#6B7280",
                    "name": "文本辅助",
                    "role": "text-secondary",
                    "theory": "中性灰色文本",
                },
            ],
        }
    )

    # 8. 暖色调配色方案（仅暖色系基础色时追加）
    if is_warm_color(base_hsl["h"]):
        palettes.append(
            {
                "name": "暖色调配色",
                "description": "基于暖色系的配色方案，营造温暖、活力和友好的氛围，适合餐饮、儿童产品等",
                "colors": [
                    {
                        "hex": base_hex,
                        "name": "主暖色",
                        "role": "warm-primary",
                        "theory": "暖色系基调",
                    },
                    {
                        "hex": hsl_to_hex(
                            constrain_to_warm_range(base_hsl["h"] - 20),
                            base_hsl["s"],
                            base_hsl["l"],
                        ),
                        "name": "暖色变体1",
                        "role": "warm-variant-1",
                        "theory": "暖色范围内调整",
                    },
                    {
                        "hex": hsl_to_hex(
                            constrain_to_warm_range(base_hsl["h"] + 25),
                            base_hsl["s"],
                            base_hsl["l"],
                        ),
                        "name": "暖色变体2",
                        "role": "warm-variant-2",
                        "theory": "暖色范围内调整",
                    },
                    {
                        "hex": hsl_to_hex(
                            base_hsl["h"], base_hsl["s"], min(85, base_hsl["l"] + 20)
                        ),
                        "name": "暖色浅调",
                        "role": "warm-tint",
                        "theory": "提高明度的暖色",
                    },
                ],
            }
        )

    # 9. 冷色调配色方案（仅冷色系基础色时追加）
    if is_cool_color(base_hsl["h"]):
        palettes.append(
            {
                "name": "冷色调配色",
                "description": "基于冷色系的配色方案，传达专业、冷静和可信赖的感觉，适合科技、医疗等行业",
                "colors": [
                    {
                        "hex": base_hex,
                        "name": "主冷色",
                        "role": "cool-primary",
                        "theory": "冷色系基调",
                    },
                    {
                        "hex": hsl_to_hex(
                            constrain_to_cool_range(base_hsl["h"] - 25),
                            base_hsl["s"],
                            base_hsl["l"],
                        ),
                        "name": "冷色变体1",
                        "role": "cool-variant-1",
                        "theory": "冷色范围内调整",
                    },
                    {
                        "hex": hsl_to_hex(
                            constrain_to_cool_range(base_hsl["h"] + 20),
                            base_hsl["s"],
                            base_hsl["l"],
                        ),
                        "name": "冷色变体2",
                        "role": "cool-variant-2",
                        "theory": "冷色范围内调整",
                    },
                    {
                        "hex": hsl_to_hex(
                            base_hsl["h"], base_hsl["s"], min(85, base_hsl["l"] + 20)
                        ),
                        "name": "冷色浅调",
                        "role": "cool-tint",
                        "theory": "提高明度的冷色",
                    },
                ],
            }
        )

    return palettes


def build_palette_data(hex_value: str) -> dict:
    """构建配色方案完整响应（对齐 60s 的 /color/palette 响应结构）。"""
    base_color = hex_to_hsl(hex_value)
    palettes = generate_color_palettes(hex_value, base_color)
    return {
        "input": {
            "hex": hex_value,
            "rgb": hex_to_rgb(hex_value),
            "hsl": base_color,
            "name": get_color_name(hex_value),
        },
        "palettes": palettes,
        "metadata": {
            "color_theory": "基于色彩理论生成的专业配色方案",
            "total_palettes": len(palettes),
            "applications": ["Web 设计", "UI/UX", "品牌设计", "室内设计", "服装搭配"],
        },
    }
