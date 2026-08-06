"""农历黄历服务。

完整对齐 60s 项目 src/modules/lunar/lunar.module.ts 的响应 JSON 结构：
solar / lunar / stats / term / zodiac / sixty_cycle / legal_holiday /
festival / phase / constellation / taboo / julian_day / nayin / baizi /
fortune / constants，字段名与文案逐一保持一致。

计算基于 lunar_python（lunar-python 1.4.8）：
- 农历/干支/生肖/星座/节气/宜忌/时辰/月相/纳音/八字 均有原生 API；
- 法定节假日（含调休）lunar_python 不提供数据集（Holiday 仅为数据容器），
  因此 legal_holiday 恒为 null、constants.legal_holiday_list 为空数组；
- 月相（phase）与 tyme4ts 同源（同一作者的 ts 移植版），按 8 相
  （新月/蛾眉月/上弦月/盈凸月/满月/亏凸月/下弦月/残月）用
  ShouXingUtil 天文算法复刻 tyme4ts Phase 的定位逻辑。
"""

import calendar
from datetime import date as Date
from datetime import timedelta

from lunar_python import Lunar, LunarMonth, LunarTime, Solar, SolarWeek
from lunar_python.util import ShouXingUtil as _sx
from lunar_python.util import SolarUtil

HEAVEN_STEMS = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"]
EARTH_BRANCHES = [
    "子",
    "丑",
    "寅",
    "卯",
    "辰",
    "巳",
    "午",
    "未",
    "申",
    "酉",
    "戌",
    "亥",
]

ZODIAC_BY_BRANCH = {
    "子": "鼠",
    "丑": "牛",
    "寅": "虎",
    "卯": "兔",
    "辰": "龙",
    "巳": "蛇",
    "午": "马",
    "未": "羊",
    "申": "猴",
    "酉": "鸡",
    "戌": "狗",
    "亥": "猪",
}
ZODIAC_LIST = ["鼠", "牛", "虎", "兔", "龙", "蛇", "马", "羊", "猴", "鸡", "狗", "猪"]

SEASON_NAMES = ["一季度", "二季度", "三季度", "四季度"]
SEASON_CN = ["春", "夏", "秋", "冬"]
SEASON_CN_DESC = ["春天", "夏天", "秋天", "冬天"]

# 24 节气（立春起，奇数为节、偶数为气）
SOLAR_TERMS = [
    {"name": "立春", "desc": "春季开始"},
    {"name": "雨水", "desc": "降雨增多"},
    {"name": "惊蛰", "desc": "春雷乍响"},
    {"name": "春分", "desc": "昼夜等长"},
    {"name": "清明", "desc": "天清地明"},
    {"name": "谷雨", "desc": "雨生百谷"},
    {"name": "立夏", "desc": "夏季开始"},
    {"name": "小满", "desc": "麦粒渐满"},
    {"name": "芒种", "desc": "麦类收割"},
    {"name": "夏至", "desc": "白昼最长"},
    {"name": "小暑", "desc": "天气渐热"},
    {"name": "大暑", "desc": "一年最热"},
    {"name": "立秋", "desc": "秋季开始"},
    {"name": "处暑", "desc": "暑热结束"},
    {"name": "白露", "desc": "露水增多"},
    {"name": "秋分", "desc": "昼夜等长"},
    {"name": "寒露", "desc": "露水渐凉"},
    {"name": "霜降", "desc": "开始降霜"},
    {"name": "立冬", "desc": "冬季开始"},
    {"name": "小雪", "desc": "开始降雪"},
    {"name": "大雪", "desc": "降雪增多"},
    {"name": "冬至", "desc": "白昼最短"},
    {"name": "小寒", "desc": "天气渐冷"},
    {"name": "大寒", "desc": "一年最冷"},
]
SOLAR_TERM_NAMES = [t["name"] for t in SOLAR_TERMS]

# tyme4ts SolarTerm 下标：冬至=0，之后奇数为节、偶数为气
TERM_INDEX = {name: (i + 3) % 24 for i, name in enumerate(SOLAR_TERM_NAMES)}

CONSTELLATION_NAMES = [
    "白羊",
    "金牛",
    "双子",
    "巨蟹",
    "狮子",
    "处女",
    "天秤",
    "天蝎",
    "射手",
    "摩羯",
    "水瓶",
    "双鱼",
]
CONSTELLATION_STARTS = [321, 420, 521, 622, 723, 823, 923, 1024, 1123, 1222, 120, 219]
CONSTELLATION_ENDS = [419, 520, 621, 722, 822, 922, 1023, 1122, 1221, 119, 218, 320]

# 月相 8 相（tyme4ts Phase.NAMES）
PHASE_NAMES = ["新月", "蛾眉月", "上弦月", "盈凸月", "满月", "亏凸月", "下弦月", "残月"]
PHASE_SIZE = 8

# 各时辰对应的起始钟点（子时=23 点）
SHICHEN_START_HOUR = [23, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21]

# 60s getBaiziDescription 的八字描述映射（缺省兜底文案一致）
BAIZI_MAP = {
    "甲子": "海中金命，做事有始有终，个性沉稳。",
    "乙丑": "海中金命，为人忠厚老实，心地善良。",
    "丙寅": "炉中火命，性格急躁但有才华。",
    "丁卯": "炉中火命，聪明伶俐，善于交际。",
    "戊辰": "大林木命，心胸宽广，有领导能力。",
    "己巳": "大林木命，智慧过人，善于理财。",
}
BAIZI_FALLBACK = "性格温和，为人正直诚信。"

_J2000 = 2451545
_ONE_THIRD = _sx.ONE_THIRD
_PI_2 = _sx.PI_2


# ---------- 月相（复刻 tyme4ts Phase） ----------


def _jd_to_civil(jd: float) -> tuple[int, int, int]:
    """儒略日（绝对）→ 公历日期（Meeus 算法，同 tyme4ts JulianDay.getSolarTime）。"""
    d = int(jd + 0.5)
    if d >= 2299161:
        c = int((d - 1867216.25) / 36524.25)
        d += 1 + c - int(c * 0.25)
    d += 1524
    y = int((d - 122.1) / 365.25)
    d -= int(365.25 * y)
    m = int(d / 30.601)
    d -= int(30.601 * m)
    if m > 13:
        m -= 12
    else:
        y -= 1
    m -= 1
    y -= 4715
    return y, m, d


def _phase_start_julian_day(lunar_year: int, lunar_month: int, index: int) -> float:
    """tyme4ts Phase.getStartSolarTime()：某月某相的起始儒略日时刻。"""
    n = int((lunar_year - 2000) * 365.2422 / 29.53058886)
    i = 0
    jd = _J2000 + _ONE_THIRD
    first = Lunar.fromYmd(lunar_year, lunar_month, 1).getSolar()
    first_day = (first.getYear(), first.getMonth(), first.getDay())
    while True:
        t = _sx.msaLonT((n + i) * _PI_2) * 36525
        if _jd_to_civil(jd + t - _sx.dtT(t)) >= first_day:
            break
        i += 1
    r = [0, 90, 180, 270]
    t = _sx.msaLonT((n + i + r[index // 2] / 360.0) * _PI_2) * 36525
    return jd + t - _sx.dtT(t)


def _phase_solar_day(
    lunar_year: int, lunar_month: int, index: int
) -> tuple[int, int, int]:
    """tyme4ts Phase.getSolarDay()：相的起始公历日（奇数相顺延一日）。"""
    ymd = _jd_to_civil(_phase_start_julian_day(lunar_year, lunar_month, index))
    if index % 2 == 1:
        d = Date(*ymd) + timedelta(days=1)
        return d.year, d.month, d.day
    return ymd


def _get_phase(lunar_year: int, lunar_month: int, lunar_day: int) -> tuple[str, int]:
    """tyme4ts LunarDay.getPhase()：返回 (月相名, 位置 1-8)。"""
    month = LunarMonth.fromYm(lunar_year, lunar_month).next(1)
    py, pm = month.getYear(), month.getMonth()
    today = Lunar.fromYmd(lunar_year, lunar_month, lunar_day).getSolar()
    today_ymd = (today.getYear(), today.getMonth(), today.getDay())
    index = 0
    while True:
        if not (_phase_solar_day(py, pm, index) > today_ymd):
            break
        index -= 1
        if index < 0:
            index += PHASE_SIZE
            month = month.next(-1)
            py, pm = month.getYear(), month.getMonth()
    return PHASE_NAMES[index % PHASE_SIZE], (index % PHASE_SIZE) + 1


# ---------- 运势（复刻 60s hash 函数） ----------


def _daily_fortune(ganzhi: str) -> str:
    fortunes = [
        "今日运势平稳，适合处理日常事务",
        "今日贵人运佳，有望得到他人帮助",
        "今日财运亨通，投资理财可获利",
        "今日感情运势不错，单身者有桃花",
        "今日工作顺利，上司赏识",
        "今日健康运佳，精神饱满",
        "今日学习运好，适合进修",
    ]
    return fortunes[(ord(ganzhi[0]) + ord(ganzhi[1])) % len(fortunes)]


def _career_fortune(ganzhi: str) -> str:
    careers = [
        "事业稳步上升，把握机会",
        "工作中有贵人相助",
        "适合团队合作，发挥所长",
        "创新思维得到认可",
        "领导能力突出，升职有望",
    ]
    return careers[(ord(ganzhi[0]) * 2 + ord(ganzhi[1])) % len(careers)]


def _money_fortune(ganzhi: str) -> str:
    money = [
        "财运平稳，收支平衡",
        "正财运佳，工资奖金丰厚",
        "偏财运不错，可小试投资",
        "理财有道，积累渐丰",
        "支出较多，节俭为宜",
    ]
    return money[(ord(ganzhi[0]) + ord(ganzhi[1]) * 3) % len(money)]


def _love_fortune(ganzhi: str) -> str:
    love = [
        "感情稳定，恋人关系和谐",
        "桃花运旺，单身者有缘分",
        "夫妻恩爱，家庭和睦",
        "感情需要沟通，避免误会",
        "情感丰富，表达爱意的好时机",
    ]
    return love[(ord(ganzhi[0]) * 5 + ord(ganzhi[1])) % len(love)]


def _get_baizi_description(ganzhi: str) -> str:
    return BAIZI_MAP.get(ganzhi, BAIZI_FALLBACK)


def _get_constellation_list() -> list[dict]:
    result = []
    for i, name in enumerate(CONSTELLATION_NAMES):
        start = CONSTELLATION_STARTS[i]
        end = CONSTELLATION_ENDS[i]
        start_month, start_day = start // 100, start % 100
        end_month, end_day = end // 100, end % 100
        result.append(
            {
                "name": name,
                "desc": f"{name}座",
                "start": f"{start_month}月{start_day}日",
                "end": f"{end_month}月{end_day}日",
                "range": f"{start_month}月{start_day}日~{end_month}月{end_day}日",
                "start_month": start_month,
                "start_day": start_day,
                "end_month": end_month,
                "end_day": end_day,
            }
        )
    return result


def _ongoing_term(today: Date, jieqi_dates: dict[str, Date]) -> tuple[str, Date]:
    """返回 (当前节气名, 节气起始日)，取表中不晚于 today 的最近节气。"""
    ongoing = None
    for name, d in jieqi_dates.items():
        if d <= today and (ongoing is None or d > jieqi_dates[ongoing]):
            ongoing = name
    if ongoing is None:
        # 兜底：取最早节气（理论不可达，表内总含上一年的冬至）
        ongoing = min(jieqi_dates, key=jieqi_dates.get)
    return ongoing, jieqi_dates[ongoing]


def build_lunar_info(
    year: int,
    month: int,
    day: int,
    hour: int = 0,
    minute: int = 0,
    second: int = 0,
) -> dict:
    """构建农历黄历响应（对齐 60s lunar 模块 JSON 分支输出）。"""
    solar = Solar.fromYmdHms(year, month, day, hour, minute, second)
    lunar = solar.getLunar()
    today = Date(year, month, day)

    lunar_year = lunar.getYear()
    lunar_month = lunar.getMonth()
    lunar_day = lunar.getDay()
    is_leap_month = lunar_month < 0

    # 干支与生肖
    year_ganzhi = lunar.getYearInGanZhi()
    month_ganzhi = lunar.getMonthInGanZhi()
    day_ganzhi = lunar.getDayInGanZhi()
    hour_ganzhi = lunar.getTimeInGanZhi()
    hour_branch = hour_ganzhi[1]
    month_cn = lunar.getMonthInChinese().replace("闰", "")

    # 农历描述（tyme4ts 格式：农历{干支}年{月份}{日}）
    month_desc = ("闰" if is_leap_month else "") + month_cn + "月"
    lunar_desc_short = f"农历{year_ganzhi}年{month_desc}{lunar.getDayInChinese()}"
    hour_desc = f"{hour_branch}时"

    # 周信息（0=周日，同 dayjs .day()）
    week = solar.getWeek()
    week_desc_short = solar.getWeekInChinese()

    # 季节（公历季度）
    season_index = (month - 1) // 3
    day_of_year = SolarUtil.getDaysInYear(year, month, day)
    days_in_month = calendar.monthrange(year, month)[1]
    is_leap_year = calendar.isleap(year)

    solar_week = SolarWeek.fromYmd(year, month, day, 0)

    # 节气
    jieqi_table = {
        name: Date(s.getYear(), s.getMonth(), s.getDay())
        for name, s in lunar.getJieQiTable().items()
        if not name.isupper()
    }
    ongoing_term, term_start = _ongoing_term(today, jieqi_table)
    term_index = TERM_INDEX.get(ongoing_term, 3)
    term_today = lunar.getJieQi() or None

    # 星座
    constellation = solar.getXingZuo()

    # 月相
    phase_name, phase_position = _get_phase(lunar_year, lunar_month, lunar_day)

    # 节日
    solar_festivals = solar.getFestivals()
    lunar_festivals = lunar.getFestivals()
    festival_solar = solar_festivals[0] if solar_festivals else None
    festival_lunar = lunar_festivals[0] if lunar_festivals else None
    festival_both = "、".join(n for n in (festival_solar, festival_lunar) if n) or None

    # 时辰（从当前时辰起共 12 个，含跨日）
    current_branch_index = lunar.getTimeZhiIndex()
    hour_entries = []
    for i in range(12):
        bi = (current_branch_index + i) % 12
        offset_days = (current_branch_index + i) // 12
        if bi == 0:
            d = today + timedelta(days=offset_days - 1)
            clock_hour = SHICHEN_START_HOUR[0]
        else:
            d = today + timedelta(days=offset_days)
            clock_hour = SHICHEN_START_HOUR[bi]
        lt = LunarTime.fromYmdHms(d.year, d.month, d.day, clock_hour, 30, 0)
        hour_entries.append(
            {
                "hour": f"{EARTH_BRANCHES[bi]}时",
                "hour_short": EARTH_BRANCHES[bi],
                "recommends": ".".join(lt.getYi()),
                "avoids": ".".join(lt.getJi()),
            }
        )

    return {
        "solar": {
            "year": year,
            "month": month,
            "day": day,
            "hour": hour,
            "minute": minute,
            "second": second,
            "full": f"{year:04d}-{month:02d}-{day:02d}",
            "full_with_time": f"{year:04d}-{month:02d}-{day:02d} {hour:02d}:{minute:02d}:{second:02d}",
            "week": week,
            "week_desc": f"星期{week_desc_short}",
            "week_desc_short": week_desc_short,
            "season": season_index + 1,
            "season_desc": SEASON_NAMES[season_index],
            "season_desc_short": SEASON_NAMES[season_index].replace("季度", ""),
            "season_name": SEASON_CN[season_index],
            "season_name_desc": SEASON_CN_DESC[season_index],
            "is_leap_year": is_leap_year,
        },
        "lunar": {
            "year": year_ganzhi,
            "month": month_cn,
            "day": lunar.getDayInChinese(),
            "hour": hour_branch,
            "full_with_hour": f"{lunar_desc_short}{hour_desc}",
            "desc_short": lunar_desc_short,
            "year_desc": f"农历{year_ganzhi}年",
            "month_desc": month_desc,
            "day_desc": lunar.getDayInChinese(),
            "hour_desc": hour_desc,
            "is_leap_month": is_leap_month,
        },
        "stats": {
            "day_of_year": day_of_year,
            "week_of_year": solar_week.getIndexInYear() + 1,
            "week_of_month": solar_week.getIndex() + 1,
            "percents": {
                "year": day_of_year / (366 if is_leap_year else 365),
                "month": day / days_in_month,
                "week": week / 7,
                "day": (hour * 3600 + minute * 60 + second) / 86400,
            },
            "percents_formatted": {
                "year": f"{day_of_year / (366 if is_leap_year else 365) * 100:.2f}%",
                "month": f"{day / days_in_month * 100:.2f}%",
                "week": f"{week / 7 * 100:.2f}%",
                "day": f"{(hour * 3600 + minute * 60 + second) / 86400 * 100:.2f}%",
            },
        },
        "term": {
            "today": term_today,
            "stage": {
                "name": ongoing_term,
                "position": (today - term_start).days + 1,
                "is_jie": term_index % 2 == 1,
                "is_qi": term_index % 2 == 0,
            },
        },
        "zodiac": {
            "year": lunar.getYearShengXiao(),
            "month": ZODIAC_BY_BRANCH[month_ganzhi[1]],
            "day": ZODIAC_BY_BRANCH[day_ganzhi[1]],
            "hour": ZODIAC_BY_BRANCH[hour_branch],
        },
        "sixty_cycle": {
            "year": {
                "heaven_stem": year_ganzhi[0],
                "earth_branch": year_ganzhi[1],
                "name": f"{year_ganzhi}年",
                "name_short": year_ganzhi,
            },
            "month": {
                "heaven_stem": month_ganzhi[0],
                "earth_branch": month_ganzhi[1],
                "name": f"{month_ganzhi}月",
                "name_short": month_ganzhi,
            },
            "day": {
                "heaven_stem": day_ganzhi[0],
                "earth_branch": day_ganzhi[1],
                "name": f"{day_ganzhi}日",
                "name_short": day_ganzhi,
            },
            "hour": {
                "heaven_stem": hour_ganzhi[0],
                "earth_branch": hour_branch,
                "name": f"{hour_ganzhi}时",
                "name_short": hour_ganzhi,
            },
        },
        "legal_holiday": None,  # lunar_python 无法定节假日数据集（含调休）
        "festival": {
            "solar": festival_solar,
            "lunar": festival_lunar,
            "both_desc": festival_both,
        },
        "phase": {
            "name": phase_name,
            "position": phase_position,
        },
        "constellation": {
            "name": f"{constellation}座",
            "name_short": constellation,
        },
        "taboo": {
            "day": {
                "recommends": ".".join(lunar.getDayYi()),
                "avoids": ".".join(lunar.getDayJi()),
            },
            "hour": {
                "hour": hour_entries[0]["hour"],
                "hour_short": hour_entries[0]["hour_short"],
                "avoids": hour_entries[0]["avoids"],
                "recommends": hour_entries[0]["recommends"],
            },
            "hours": hour_entries,
        },
        "julian_day": solar.getJulianDay(),
        "nayin": {
            "year": lunar.getYearNaYin(),
            "month": lunar.getMonthNaYin(),
            "day": lunar.getDayNaYin(),
            "hour": LunarTime.fromYmdHms(
                year, month, day, hour, minute, second
            ).getNaYin(),
        },
        "baizi": {
            "year_baizi": _get_baizi_description(year_ganzhi),
            "day_baizi": _get_baizi_description(day_ganzhi),
        },
        "fortune": {
            "today_luck": _daily_fortune(day_ganzhi),
            "career": _career_fortune(day_ganzhi),
            "money": _money_fortune(day_ganzhi),
            "love": _love_fortune(day_ganzhi),
        },
        "constants": {
            "legal_holiday_list": [],  # lunar_python 无法定节假日数据集
            "phase_list": [
                {"name": n, "lunar_day": i + 1} for i, n in enumerate(PHASE_NAMES)
            ],
            "zodiac_list": ZODIAC_LIST,
            "constellation_list": _get_constellation_list(),
            "heaven_stems": HEAVEN_STEMS,
            "earth_branches": EARTH_BRANCHES,
            "solar_terms": SOLAR_TERMS,
        },
    }
