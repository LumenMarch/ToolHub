import os
from datetime import datetime
from pathlib import Path

from dateutil.relativedelta import relativedelta
from app.services.asset_engine.mod import create_excel_template

current_date = datetime.now()
this_month_str = current_date.strftime("%Y%m")
last_month_date = current_date - relativedelta(months=1)
last_month_str = last_month_date.strftime("%Y%m")


current_file_path = os.path.abspath(__file__)
current_directory = os.path.dirname(current_file_path)
current_resources = os.path.join(current_directory, "Resources")

LOGO_PATH = os.path.join(current_resources, "foxlink.png")
GIF_PATH = os.path.join(current_resources, "loading.gif")

CHARGE_LIST_PATH = os.path.join(current_resources, "Change_list.txt")

VERSION = "1.2.7"

BASE_PATH = Path.home()
DESKTOP_PATH = BASE_PATH / "Desktop"
ALL_DATA_PATH = DESKTOP_PATH / "对比数据"
SAVE_CHECK_PATH = ALL_DATA_PATH / "对比结果"
if not os.path.exists(SAVE_CHECK_PATH):
    os.makedirs(SAVE_CHECK_PATH, exist_ok=True)

THIS_FINANCE_PATH = ALL_DATA_PATH / f"{this_month_str}财务资产"
LAST_FINANCE_PATH = ALL_DATA_PATH / f"{last_month_str}财务资产"

THIS_SFC_PATH = ALL_DATA_PATH / f"{this_month_str}SFC资产"
LAST_SFC_PATH = ALL_DATA_PATH / f"{last_month_str}SFC资产"

THIS_NOTES_PATH = ALL_DATA_PATH / f"{this_month_str}Notes资产"
LAST_NOTES_PATH = ALL_DATA_PATH / f"{last_month_str}Notes资产"

THIS_CUSTOMER_PATH = ALL_DATA_PATH / f"{this_month_str}客户资产"
LAST_CUSTOMER_PATH = ALL_DATA_PATH / f"{last_month_str}客户资产"

CUSTODIAN_PATH = ALL_DATA_PATH / "财务保管人"
DEPARTMENT_PATH = ALL_DATA_PATH / "财务保管部门"
DRI_PATH = ALL_DATA_PATH / "客户系统DRI"


FINANCE_FINANCE_SAVE_PATH = os.path.join(
    SAVE_CHECK_PATH, f"{this_month_str}财务与{last_month_str}财务对比结果.xlsx"
)
NOTES_NOTES_SAVE_PATH = os.path.join(
    SAVE_CHECK_PATH, f"{this_month_str}Notes与{last_month_str}Notes对比结果.xlsx"
)
SFC_SFC_SAVE_PATH = os.path.join(
    SAVE_CHECK_PATH, f"{this_month_str}SFC与{last_month_str}SFC对比结果.xlsx"
)
CUSTOMER_CUSTOMER_SAVE_PATH = os.path.join(
    SAVE_CHECK_PATH, f"{this_month_str}客户与{last_month_str}客户对比结果.xlsx"
)
FINANCE_NOTES_SAVE_PATH = os.path.join(
    SAVE_CHECK_PATH, f"{this_month_str}财务与{this_month_str}Notes对比结果.xlsx"
)
NOTES_SFC_SAVE_PATH = os.path.join(
    SAVE_CHECK_PATH, f"{this_month_str}Notes与{this_month_str}SFC对比结果.xlsx"
)
CUSTOMER_NOTES_SAVE_PATH = os.path.join(
    SAVE_CHECK_PATH, f"{this_month_str}客户与{this_month_str}Notes对比结果.xlsx"
)

SAVE_ALL_PATH = os.path.join(
    SAVE_CHECK_PATH, f"TE&PE资产对比_{this_month_str}对比总结.xlsx"
)
SAVE_ALL_PDF_PATH = os.path.join(
    SAVE_CHECK_PATH, f"TE&PE资产对比_{this_month_str}对比总结.pdf"
)
SAVE_ALL_SHEET_PDF_PATH = os.path.join(
    SAVE_CHECK_PATH, f"TE&PE资产对比_{this_month_str}对比总结_sheet.pdf"
)
SAVE_EXCAL_PDF_PATH = os.path.join(
    SAVE_CHECK_PATH, f"TE&PE资产对比_{this_month_str}对比总结_差异总结.pdf"
)
SAVE_ALL_RAW_DATA_PATH = os.path.join(SAVE_CHECK_PATH, "原始数据.xlsx")


if not os.path.exists(SAVE_ALL_PATH):
    create_excel_template(SAVE_ALL_PATH)
