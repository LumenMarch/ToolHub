"""摸鱼日历服务。

完整对齐 60s 项目 src/modules/moyu.module.ts 的响应 JSON 结构：
date / today / progress / currentHoliday / nextHoliday / nextWeekend /
countdown / moyuQuote，字段名逐一保持一致。

约束（以 lunar_python 实际能力为准）：
- 农历/干支/节气由 lunar_python 计算；
- lunar_python 无法定节假日与调休数据集（Holiday 仅为数据容器），因此
  「节假日」以节日（公历节日 + 农历节日）近似：
  * today.isHoliday = 当天存在公历或农历节日；
  * currentHoliday 为单日节日（无连续假期数据，totalDays=1）；
  * nextHoliday.workdays 恒为空数组（无调休数据）；
  清明节等以节气定义的法定假日不在节日表中，isHoliday 不覆盖。
"""

from datetime import date as Date
from datetime import timedelta

from lunar_python import Solar

WEEKDAYS = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"]

MOYU_QUOTES = [
    "工作再累，一天也是24小时；摸鱼再爽，一天也是24小时。既然都是24小时，为什么不选择爽呢？",
    "老板赚的是我们加班的钱，我摸的是老板的鱼。谁占便宜还不一定呢。",
    "认真工作只会让你的老板买上更好的车，而摸鱼会让你的心情更加愉悦。",
    "打工人，打工魂，打工都是人上人。摸鱼人，摸鱼魂，摸鱼才是人上人！",
    "你在认真工作的时候，有人在摸鱼。你在加班的时候，有人在钓鱼。人生苦短，及时摸鱼。",
    "世界上有两种人：一种是在认真工作，一种是在摸鱼。前者为老板打工，后者为自己打工。",
    "别人上班赚工资，我上班只为摸鱼。我们不一样，不一样～",
    "有的人为了工作而活着，有的人为了摸鱼而工作。我显然属于后者。",
    "摸鱼使我快乐，加班令我痛苦。人生在世，当然要追求快乐啊！",
    "钱是老板的，命是自己的。工作做不完还有明天，命没了就真的没了。",
    "今日摸鱼，明日也摸。日日摸鱼，心情大好！",
    "认真上班的人不一定会升职加薪，但会认真摸鱼的人一定会快乐无边。",
    "工作做得再好，老板也只会说：这是你应该做的。但摸鱼带来的快乐，是实实在在的！",
    "我的座右铭：能坐着绝不站着，能躺着绝不坐着，能摸鱼绝不工作。",
    "老板喊你认真干活的时候，请记住：他是在为他自己的梦想买单，而不是你的。",
]


def _festival_names(target: Date) -> tuple[list[str], list[str]]:
    """返回 (公历节日, 农历节日) 名称列表。"""
    solar = Solar.fromYmd(target.year, target.month, target.day)
    lunar = solar.getLunar()
    return list(solar.getFestivals()), list(lunar.getFestivals())


def _is_holiday(target: Date) -> tuple[bool, str | None]:
    """lunar_python 节日近似判断：返回 (是否节假日, 节日名称)。"""
    solar_fest, lunar_fest = _festival_names(target)
    combined = solar_fest + lunar_fest
    return (bool(combined), combined[0] if combined else None)


def _calculate_progress(target: Date) -> dict:
    """时间进度（周一为一周起点，对齐 60s calculateProgress）。"""
    start_of_week = target - timedelta(days=target.weekday())
    week_passed = (target - start_of_week).days + 1
    week_total = 7

    month_passed = target.day
    month_total = (target.replace(day=28) + timedelta(days=4)).replace(
        day=1
    ) - timedelta(days=1)
    month_total = month_total.day

    year_total = (
        366
        if (target.year % 4 == 0 and (target.year % 100 != 0 or target.year % 400 == 0))
        else 365
    )
    year_passed = target.timetuple().tm_yday

    return {
        "week": {
            "passed": week_passed,
            "total": week_total,
            "remaining": week_total - week_passed,
            "percentage": round(week_passed / week_total * 100),
        },
        "month": {
            "passed": month_passed,
            "total": month_total,
            "remaining": month_total - month_passed,
            "percentage": round(month_passed / month_total * 100),
        },
        "year": {
            "passed": year_passed,
            "total": year_total,
            "remaining": year_total - year_passed,
            "percentage": round(year_passed / year_total * 100),
        },
    }


def _find_next_holiday(target: Date) -> dict | None:
    """查找下一个非周末的节日（对齐 60s findNextHoliday，无调休数据）。"""
    for offset in range(1, 366):
        check = target + timedelta(days=offset)
        is_holiday, name = _is_holiday(check)
        if is_holiday and check.weekday() not in (5, 6):
            return {
                "name": name,
                "date": check.isoformat(),
                "until": offset,
                "duration": 1,
                "workdays": [],  # lunar_python 无调休数据
            }
    return None


def _calculate_countdown(target: Date) -> dict:
    """摸鱼倒计时（对齐 60s calculateCountdown，dayOfWeek 0=周日）。"""
    day_of_week = (target.weekday() + 1) % 7  # 0=周日 … 6=周六

    if day_of_week == 0:
        to_week_end = 6
    elif day_of_week == 6:
        to_week_end = 0
    else:
        to_week_end = 6 - day_of_week

    if day_of_week == 5:
        to_friday = 0
    elif day_of_week in (6, 0):
        to_friday = 6 if day_of_week == 6 else 5
    else:
        to_friday = 5 - day_of_week

    last_of_month = (target.replace(day=28) + timedelta(days=4)).replace(
        day=1
    ) - timedelta(days=1)
    to_month_end = (last_of_month - target).days

    year_end = Date(target.year, 12, 31)
    to_year_end = (year_end - target).days

    return {
        "toWeekEnd": to_week_end,
        "toFriday": to_friday,
        "toMonthEnd": to_month_end,
        "toYearEnd": to_year_end,
    }


def build_moyu_calendar(target: Date) -> dict:
    """构建摸鱼日历响应（对齐 60s moyu 模块 JSON 分支输出）。"""
    day_of_week = (target.weekday() + 1) % 7  # 0=周日 … 6=周六
    is_weekend = day_of_week in (0, 6)
    is_holiday, holiday_name = _is_holiday(target)

    solar = Solar.fromYmd(target.year, target.month, target.day)
    lunar = solar.getLunar()
    is_leap_month = lunar.getMonth() < 0
    lunar_festivals = list(lunar.getFestivals())
    solar_term = lunar.getJieQi() or None

    result = {
        "date": {
            "gregorian": target.isoformat(),
            "weekday": WEEKDAYS[day_of_week],
            "dayOfWeek": day_of_week,
            "lunar": {
                "year": lunar.getYear(),
                "month": abs(lunar.getMonth()),
                "day": lunar.getDay(),
                "yearCN": lunar.getYearInChinese(),
                "monthCN": lunar.getMonthInChinese(),
                "dayCN": lunar.getDayInChinese(),
                "isLeapMonth": is_leap_month,
                "yearGanZhi": lunar.getYearInGanZhi(),
                "monthGanZhi": lunar.getMonthInGanZhi(),
                "dayGanZhi": lunar.getDayInGanZhi(),
                "zodiac": lunar.getYearShengXiao(),
            },
        },
        "today": {
            "isWeekend": is_weekend,
            "isHoliday": is_holiday,
            "isWorkday": (not is_weekend) and (not is_holiday),
            "holidayName": holiday_name,
            "solarTerm": solar_term,
            "lunarFestivals": lunar_festivals,
        },
        "progress": _calculate_progress(target),
        "currentHoliday": (
            {
                "name": holiday_name,
                "dayOfHoliday": 1,
                "daysRemaining": 1,
                "totalDays": 1,
            }
            if is_holiday
            else None
        ),
        "nextHoliday": _find_next_holiday(target),
        "nextWeekend": _find_next_weekend(target),
        "countdown": _calculate_countdown(target),
        "moyuQuote": MOYU_QUOTES[int(target.strftime("%Y%m%d")) % len(MOYU_QUOTES)],
    }
    return result


def _find_next_weekend(target: Date) -> dict:
    """查找下一个周末（对齐 60s findNextWeekend）。"""
    check = target + timedelta(days=1)
    day_of_week = (check.weekday() + 1) % 7
    if day_of_week not in (0, 6):
        days_until_saturday = 6 - day_of_week
        check += timedelta(days=days_until_saturday)
        day_of_week = 6
    return {
        "date": check.isoformat(),
        "weekday": "星期六" if day_of_week == 6 else "星期日",
        "daysUntil": (check - target).days,
    }
