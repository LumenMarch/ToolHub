"""calendar 端点测试：lunar 与 moyu 块同响应断言、已知值、无效日期 400、缺认证 401。"""

from datetime import datetime

from tests.conftest import auth_header

INFO_URL = "/api/v1/tools/calendar/info"

LUNAR_TOP_LEVEL_KEYS = [
    "solar",
    "lunar",
    "stats",
    "term",
    "zodiac",
    "sixty_cycle",
    "legal_holiday",
    "festival",
    "phase",
    "constellation",
    "taboo",
    "julian_day",
    "nayin",
    "baizi",
    "fortune",
    "constants",
]

MOYU_TOP_LEVEL_KEYS = [
    "date",
    "today",
    "progress",
    "currentHoliday",
    "nextHoliday",
    "nextWeekend",
    "countdown",
    "moyuQuote",
]

PHASE_NAMES = ["新月", "蛾眉月", "上弦月", "盈凸月", "满月", "亏凸月", "下弦月", "残月"]


def test_today_default(admin_client):
    """缺省 date 返回完整结构：lunar 16 块 + moyu 8 块。"""
    client, token = admin_client
    resp = client.post(INFO_URL, json={}, headers=auth_header(token))
    assert resp.status_code == 200, resp.text
    data = resp.json()["result"]

    for key in LUNAR_TOP_LEVEL_KEYS + MOYU_TOP_LEVEL_KEYS:
        assert key in data

    # lunar 块
    assert data["solar"]["full"] == datetime.now().strftime("%Y-%m-%d")
    assert data["solar"]["full_with_time"].startswith(data["solar"]["full"])
    assert data["lunar"]["year"] and data["lunar"]["month"] and data["lunar"]["day"]
    assert data["solar"]["week"] in range(7)
    assert data["solar"]["season"] in range(1, 5)

    # moyu 块
    assert data["date"]["gregorian"] == datetime.now().strftime("%Y-%m-%d")
    assert data["date"]["weekday"]
    assert data["date"]["dayOfWeek"] in range(7)

    lunar = data["date"]["lunar"]
    for key in (
        "year",
        "month",
        "day",
        "yearCN",
        "monthCN",
        "dayCN",
        "isLeapMonth",
        "yearGanZhi",
        "monthGanZhi",
        "dayGanZhi",
        "zodiac",
    ):
        assert key in lunar

    today = data["today"]
    assert today["isWeekend"] is (data["date"]["dayOfWeek"] in (0, 6))
    assert isinstance(today["isHoliday"], bool)
    assert isinstance(today["isWorkday"], bool)
    assert isinstance(today["lunarFestivals"], list)

    for dim in ("week", "month", "year"):
        p = data["progress"][dim]
        assert {"passed", "total", "remaining", "percentage"} <= set(p)
        assert 0 <= p["percentage"] <= 100

    for key in ("toWeekEnd", "toFriday", "toMonthEnd", "toYearEnd"):
        assert key in data["countdown"]
        assert data["countdown"][key] >= 0

    assert data["moyuQuote"]


def test_specified_date_2026_08_08(admin_client):
    """2026-08-08 已知值断言（农历/干支/星期/节气/纳音 + moyu 农历字段）。"""
    client, token = admin_client
    resp = client.post(
        INFO_URL, json={"date": "2026-08-08"}, headers=auth_header(token)
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()["result"]

    # lunar 块
    assert data["solar"]["full"] == "2026-08-08"
    assert data["solar"]["week"] == 6
    assert data["solar"]["week_desc"] == "星期六"
    assert data["solar"]["season"] == 3  # 第三季度

    assert data["lunar"]["year"] == "丙午"  # 干支纪年（对齐 60s lunarYear.getName()）
    assert data["lunar"]["month"] == "六"
    assert data["lunar"]["day"] == "廿六"
    assert data["lunar"]["is_leap_month"] is False
    assert data["lunar"]["desc_short"] == "农历丙午年六月廿六"

    assert data["zodiac"]["year"] == "马"
    assert data["sixty_cycle"]["year"]["name"] == "丙午年"
    assert data["sixty_cycle"]["day"]["name_short"] == "甲寅"

    assert data["stats"]["day_of_year"] == 220
    assert data["stats"]["week_of_year"] >= 1
    assert data["stats"]["week_of_month"] >= 1

    # 当日非节气：today 为 null，当前节气为立秋（8/7 起）
    assert data["term"]["today"] is None
    assert data["term"]["stage"]["name"] == "立秋"
    assert data["term"]["stage"]["position"] >= 1
    assert data["term"]["stage"]["is_jie"] is True

    assert data["constellation"]["name"] == "狮子座"
    assert data["phase"]["name"] in PHASE_NAMES
    assert data["phase"]["position"] in range(1, 9)

    assert data["festival"]["solar"] is None
    assert data["julian_day"] == 2461260.5
    assert data["nayin"]["year"] == "天河水"
    assert data["legal_holiday"] is None

    # constants 结构
    constants = data["constants"]
    assert constants["legal_holiday_list"] == []
    assert len(constants["phase_list"]) == 8
    assert len(constants["zodiac_list"]) == 12
    assert len(constants["constellation_list"]) == 12
    assert constants["heaven_stems"] == list("甲乙丙丁戊己庚辛壬癸")
    assert len(constants["solar_terms"]) == 24

    # moyu 块：农历字段已知值
    mlunar = data["date"]["lunar"]
    assert mlunar["year"] == 2026
    assert mlunar["month"] == 6
    assert mlunar["day"] == 26
    assert mlunar["yearCN"] == "二〇二六"
    assert mlunar["monthCN"] == "六"
    assert mlunar["dayCN"] == "廿六"
    assert mlunar["isLeapMonth"] is False
    assert mlunar["yearGanZhi"] == "丙午"
    assert mlunar["dayGanZhi"] == "甲寅"
    assert mlunar["zodiac"] == "马"


def test_specified_date_term_day(admin_client):
    """节气当天 term.today 返回节气名。"""
    client, token = admin_client
    resp = client.post(
        INFO_URL, json={"date": "2026-08-07"}, headers=auth_header(token)
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()["result"]
    assert data["term"]["today"] == "立秋"
    assert data["term"]["stage"]["position"] == 1


def test_taboo_yi_ji(admin_client):
    """宜忌存在性：taboo.day 的 recommends/avoids 非空，hours 12 项。"""
    client, token = admin_client
    resp = client.post(
        INFO_URL, json={"date": "2026-08-08"}, headers=auth_header(token)
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()["result"]

    taboo = data["taboo"]
    assert taboo["day"]["recommends"]
    assert taboo["day"]["avoids"]
    assert (
        taboo["hour"]["hour"]
        and taboo["hour"]["recommends"]
        and taboo["hour"]["avoids"]
    )
    assert len(taboo["hours"]) == 12


def test_national_day_2026_10_01(admin_client):
    """2026-10-01 国庆节：lunar_python 有节日数据，isHoliday=true。"""
    client, token = admin_client
    resp = client.post(
        INFO_URL, json={"date": "2026-10-01"}, headers=auth_header(token)
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()["result"]

    assert data["date"]["gregorian"] == "2026-10-01"
    assert data["date"]["dayOfWeek"] == 4  # 星期四
    assert data["date"]["weekday"] == "星期四"
    assert data["today"]["isWeekend"] is False
    assert data["today"]["isHoliday"] is True
    assert data["today"]["holidayName"] == "国庆节"
    assert data["today"]["isWorkday"] is False

    # 节日近似：currentHoliday 为单日
    assert data["currentHoliday"] is not None
    assert data["currentHoliday"]["name"] == "国庆节"
    assert data["currentHoliday"]["totalDays"] == 1
    assert data["currentHoliday"]["dayOfHoliday"] == 1

    assert data["date"]["lunar"]["yearGanZhi"] == "丙午"


def test_next_holiday_structure(admin_client):
    """nextHoliday 结构断言：workdays 为空数组（无调休数据）。"""
    client, token = admin_client
    resp = client.post(
        INFO_URL, json={"date": "2026-10-01"}, headers=auth_header(token)
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()["result"]

    # 10-01 当天已放假，nextHoliday 应为下一个非周末节日（如 2027-01-01）
    assert data["nextHoliday"] is not None
    for key in ("name", "date", "until", "duration", "workdays"):
        assert key in data["nextHoliday"]
    assert data["nextHoliday"]["workdays"] == []


def test_quote_deterministic(admin_client):
    """同一天返回固定摸鱼格言。"""
    client, token = admin_client
    payload = {"date": "2026-03-15"}
    first = client.post(INFO_URL, json=payload, headers=auth_header(token))
    second = client.post(INFO_URL, json=payload, headers=auth_header(token))
    assert first.status_code == 200
    assert first.json()["result"]["moyuQuote"] == second.json()["result"]["moyuQuote"]


def test_invalid_date_400(admin_client):
    """非法日期返回 400 中文文案。"""
    client, token = admin_client
    for bad in ("2026-13-45", "2026-02-30", "not-a-date", "20260808", ""):
        resp = client.post(INFO_URL, json={"date": bad}, headers=auth_header(token))
        assert resp.status_code == 400, (bad, resp.text)
        assert "日期格式错误" in resp.json()["detail"]


def test_requires_auth_401(client):
    """缺认证返回 401。"""
    resp = client.post(INFO_URL, json={})
    assert resp.status_code == 401
