import os
import sys
import traceback
from datetime import datetime
from pathlib import Path
from unittest.mock import MagicMock

from dateutil.relativedelta import relativedelta
from fastapi import APIRouter
from pydantic import BaseModel


# 强行注入 Mock 来绕过对 PyQt5 等桌面 UI 库的依赖
class MockQThread:
    def __init__(self, *args, **kwargs):
        pass


class MockQMainWindow:
    def __init__(self, *args, **kwargs):
        pass


class MockQWidget:
    def __init__(self, *args, **kwargs):
        pass


pyqt5_mock = MagicMock()
pyqt5_mock.QtCore.QThread = MockQThread
pyqt5_mock.QtWidgets.QMainWindow = MockQMainWindow
pyqt5_mock.QtWidgets.QWidget = MockQWidget
sys.modules["PyQt5"] = pyqt5_mock
sys.modules["PyQt5.QtCore"] = pyqt5_mock.QtCore
sys.modules["PyQt5.QtWidgets"] = pyqt5_mock.QtWidgets
sys.modules["PyQt5.QtGui"] = MagicMock()
sys.modules["qfluentwidgets"] = MagicMock()

OLD_PROJECT_PATH = (
    "/Users/foxlink/Desktop/ATE/ATE/Asset_comparison/Asset_comparison_V1.2.7"
)
if OLD_PROJECT_PATH not in sys.path:
    sys.path.insert(0, OLD_PROJECT_PATH)

from Customer_Customer import Customer_Customer  # noqa: E402
from Customer_Notes import Customer_Notes  # noqa: E402
from Finance_Finance import Finance_Finance  # noqa: E402
from Finance_Notes import Finance_Notes  # noqa: E402
from Notes_Notes import Notes_Notes  # noqa: E402
from Notes_SFC import Notes_SFC  # noqa: E402
from openpyxl import load_workbook  # noqa: E402
from openpyxl.styles import Alignment, PatternFill  # noqa: E402
from openpyxl.utils import get_column_letter  # noqa: E402
from SFC_SFC import SFC_SFC  # noqa: E402

try:
    from mod import create_excel_template
except ImportError:
    pass
try:
    from pdf_generator import excel_sheet_to_pdf
except ImportError:
    pass

router = APIRouter()


class ComparisonRequest(BaseModel):
    thisFinance: str
    lastFinance: str
    thisSFC: str
    lastSFC: str
    thisNotes: str
    lastNotes: str
    thisCustomer: str
    lastCustomer: str
    departmentData: str
    custodianData: str
    driData: str
    remarks: dict = {}
    reviews: dict = {}


@router.get("/auto-paths")
async def get_auto_paths():
    current_date = datetime.now()
    this_month_str = current_date.strftime("%Y%m")
    last_month_date = current_date - relativedelta(months=1)
    last_month_str = last_month_date.strftime("%Y%m")

    all_data_path = Path.home() / "Desktop" / "对比数据"
    expected_stems = {
        "thisFinance": f"{this_month_str}财务资产",
        "lastFinance": f"{last_month_str}财务资产",
        "thisSFC": f"{this_month_str}SFC资产",
        "lastSFC": f"{last_month_str}SFC资产",
        "thisNotes": f"{this_month_str}Notes资产",
        "lastNotes": f"{last_month_str}Notes资产",
        "thisCustomer": f"{this_month_str}客户资产",
        "lastCustomer": f"{last_month_str}客户资产",
        "custodianData": "财务保管人",
        "departmentData": "财务保管部门",
        "driData": "客户系统DRI",
    }
    result = {k: "" for k in expected_stems}

    if all_data_path.exists() and all_data_path.is_dir():
        for f in all_data_path.iterdir():
            if f.is_file() and not f.name.startswith("~"):
                for k, stem in expected_stems.items():
                    if f.stem == stem:
                        result[k] = str(f)
    return {"status": "success", "data": result}


def _safe_len(d):
    if d is None:
        return 0
    try:
        return len(d)
    except Exception:
        return 0


def run_comparisons(req: ComparisonRequest):

    ui = MagicMock()
    results_info = []
    summary = {}

    # 1. 财务-财务
    ff = Finance_Finance(ui)
    ff.this_Finance_path = req.thisFinance
    ff.last_Finance_path = req.lastFinance
    ff.Custodian_path = req.custodianData
    ff.Department_path = req.departmentData

    if req.thisFinance and req.lastFinance:
        try:
            ff.read_Custodian_data()
            ff.read_Department_data()
            ff.read_this_Finance_data()
            ff.read_last_Finance_data()
            ff.Finance_check()
            diff_count = (
                _safe_len(ff.check_Custodian)
                + _safe_len(ff.check_Department)
                + _safe_len(ff.new_Custodian_assets)
                + _safe_len(ff.removed_Custodian_assets)
                + _safe_len(ff.new_Department_assets)
                + _safe_len(ff.removed_Department_assets)
            )
            results_info.append(
                {
                    "key": "ff",
                    "label": "【财务-财务】",
                    "has_diff": diff_count > 0,
                    "msg": f"保管人异常 {_safe_len(ff.check_Custodian)} | 部门异常 {_safe_len(ff.check_Department)}",
                }
            )
        except Exception as e:
            results_info.append(
                {
                    "key": "ff",
                    "label": "【财务-财务】",
                    "has_diff": False,
                    "msg": f"异常: {e}",
                }
            )
    summary["ff"] = ff

    # 2. SFC-SFC
    sfc = SFC_SFC(ui)
    sfc.This_data_Path = req.thisSFC
    sfc.Last_data_path = req.lastSFC

    if req.thisSFC and req.lastSFC:
        try:
            sfc.This_SFC_date()
            sfc.Last_SFC_date()
            sfc.SFC_SFC_Comparison()
            diff_count = _safe_len(sfc.new_assets) + _safe_len(sfc.removed_assets)
            results_info.append(
                {
                    "key": "sfc",
                    "label": "【SFC-SFC】",
                    "has_diff": diff_count > 0,
                    "msg": f"新增: {_safe_len(sfc.new_assets)}, 减少: {_safe_len(sfc.removed_assets)}",
                }
            )
        except Exception as e:
            results_info.append(
                {
                    "key": "sfc",
                    "label": "【SFC-SFC】",
                    "has_diff": False,
                    "msg": f"异常: {e}",
                }
            )
    summary["sfc"] = sfc

    # 3. Notes-Notes
    nn = Notes_Notes(ui)
    nn.This_Notes_path = req.thisNotes
    nn.Last_Notes_path = req.lastNotes

    if req.thisNotes and req.lastNotes:
        try:
            nn.This_Notes_date()
            nn.Last_Notes_date()
            nn.Notes_Notes_Comparison()
            diff_count = (
                _safe_len(nn.new_assets)
                + _safe_len(nn.removed_assets)
                + abs(_safe_len(nn.new_No_assets) - _safe_len(nn.removed_No_assets))
            )
            results_info.append(
                {
                    "key": "nn",
                    "label": "【Notes-Notes】",
                    "has_diff": diff_count > 0,
                    "msg": f"有资产新增: {_safe_len(nn.new_assets)}, 有资产减少: {_safe_len(nn.removed_assets)} | 无资产总差异: {abs(_safe_len(nn.new_No_assets) - _safe_len(nn.removed_No_assets))}",
                }
            )
        except Exception as e:
            results_info.append(
                {
                    "key": "nn",
                    "label": "【Notes-Notes】",
                    "has_diff": False,
                    "msg": f"异常: {e}",
                }
            )
    summary["nn"] = nn

    # 4. 客户-客户
    cc = Customer_Customer(ui)
    cc.this_Customer_path = req.thisCustomer
    cc.last_Customer_path = req.lastCustomer
    cc.Custodian_DRI_path = req.driData

    if req.thisCustomer and req.lastCustomer and req.driData:
        try:
            cc.get_Customer_DRI()
            cc.read_this_Customer_data()
            cc.read_last_Customer_data()
            cc.Customer_Customer_Comparison()
            diff_count = _safe_len(cc.new_Customer_assets) + _safe_len(
                cc.removed_Customer_assets
            )
            results_info.append(
                {
                    "key": "cc",
                    "label": "【客户-客户】",
                    "has_diff": diff_count > 0,
                    "msg": f"新增: {_safe_len(cc.new_Customer_assets)}, 减少: {_safe_len(cc.removed_Customer_assets)}",
                }
            )
        except Exception as e:
            results_info.append(
                {
                    "key": "cc",
                    "label": "【客户-客户】",
                    "has_diff": False,
                    "msg": f"异常: {e}",
                }
            )
    summary["cc"] = cc

    # 5. 财务-Notes
    fn = Finance_Notes(ui)
    fn.Finance_path = req.thisFinance
    fn.Notes_path = req.thisNotes
    fn.Custodian_path = req.custodianData

    if req.thisFinance and req.thisNotes and req.custodianData:
        try:
            fn.read_Custodian_data()
            fn.read_Finance_data()
            fn.read_Notes_data()
            fn.Finance_Notes_Comparison()
            diff_count = _safe_len(fn.removed_assets) + _safe_len(fn.new_assets)
            results_info.append(
                {
                    "key": "fn",
                    "label": "【财务比Notes】",
                    "has_diff": diff_count > 0,
                    "msg": f"财务比Notes新增: {_safe_len(fn.removed_assets)}, 财务比Notes减少: {_safe_len(fn.new_assets)}",
                }
            )
        except Exception as e:
            results_info.append(
                {
                    "key": "fn",
                    "label": "【财务比Notes】",
                    "has_diff": False,
                    "msg": f"异常: {e}",
                }
            )
    summary["fn"] = fn

    # 6. Notes-SFC
    ns = Notes_SFC(ui)
    ns.this_Notes_path = req.thisNotes
    ns.this_SFC_path = req.thisSFC

    if req.thisNotes and req.thisSFC:
        try:
            ns.This_Notes_date()
            ns.This_SFC_date()
            ns.Notes_SFC_Comparison()
            diff_count = _safe_len(ns.Notes_new_assets) + _safe_len(
                ns.Notes_removed_assets
            )
            results_info.append(
                {
                    "key": "ns",
                    "label": "【Notes比SFC】",
                    "has_diff": diff_count > 0,
                    "msg": f"Notes比SFC新增: {_safe_len(ns.Notes_new_assets)}, Notes比SFC减少: {_safe_len(ns.Notes_removed_assets)}",
                }
            )
        except Exception as e:
            results_info.append(
                {
                    "key": "ns",
                    "label": "【Notes比SFC】",
                    "has_diff": False,
                    "msg": f"异常: {e}",
                }
            )
    summary["ns"] = ns

    # 7. 客户-Notes
    cn = Customer_Notes(ui)
    cn.this_Customer_path = req.thisCustomer
    cn.this_Notes_path = req.thisNotes
    cn.this_Customer_DRI_path = req.driData

    if req.thisCustomer and req.thisNotes and req.driData:
        try:
            cn.read_Customer_DRI()
            cn.read_this_Customer_data()
            cn.read_this_Notes_data()
            cn.Customer_Notes_Comparison()
            diff_count = _safe_len(cn.remove_assets) + _safe_len(cn.new_assets)
            results_info.append(
                {
                    "key": "cn",
                    "label": "【客户比Notes】",
                    "has_diff": diff_count > 0,
                    "msg": f"客户比Notes新增: {_safe_len(cn.remove_assets)}, 客户比Notes减少: {_safe_len(cn.new_assets)}",
                }
            )
        except Exception as e:
            results_info.append(
                {
                    "key": "cn",
                    "label": "【客户比Notes】",
                    "has_diff": False,
                    "msg": f"异常: {e}",
                }
            )
    summary["cn"] = cn

    summary["results_info"] = results_info
    return summary


def apply_review_colors(ws, req_reviews):
    """根据前端的选择，给对应单元格涂色"""
    color_mapping = {
        "差異確認OK": "71D0F1",
        "待跟进": "FFEE00",
        "異常": "EC4337",
    }

    # 绿色填充（用于数据为0的情况）
    green_fill = PatternFill(
        start_color="D0F1AD", end_color="D0F1AD", fill_type="solid"
    )

    combo_to_cell = {
        "ff": ["D5"],
        "nn": ["D6"],
        "sfc": ["D7"],
        "cc": ["D8"],
        "fn": ["E5"],
        "ns": ["F6"],
        "cn": ["G8"],
    }

    for key, val in req_reviews.items():
        if key in combo_to_cell:
            coords = combo_to_cell[key]
            fill_color = color_mapping.get(val, "FFFFFF")
            fill_pattern = PatternFill(
                start_color=fill_color, end_color=fill_color, fill_type="solid"
            )
            for coord in coords:
                cell = ws[coord]
                # 若为0填充绿色，反之填选项色
                cv = (
                    str(cell.value).strip().replace("/", "")
                    if cell.value is not None
                    else ""
                )
                numeric_val = float(cv) if cv and cv != "0" else 0
                if numeric_val == 0:
                    cell.fill = green_fill
                else:
                    cell.fill = fill_pattern


@router.post("/check")
async def check_data(req: ComparisonRequest):
    try:
        summary = run_comparisons(req)
        return {
            "status": "success",
            "message": "交叉盘点全部完成。",
            "data": {"results": summary["results_info"]},
        }
    except Exception as e:
        return {
            "status": "error",
            "message": str(e),
            "errors": [traceback.format_exc()],
        }


def _safe_to_pandas(df):
    if df is None:
        import pandas as pd

        return pd.DataFrame()
    if hasattr(df, "collect"):
        return df.collect().to_pandas()
    if hasattr(df, "to_pandas"):
        return df.to_pandas()
    return df


@router.post("/save")
async def save_results(req: ComparisonRequest):
    try:
        summary = run_comparisons(req)
        ff = summary["ff"]
        nn = summary["nn"]
        sfc = summary["sfc"]
        cc = summary["cc"]
        fn = summary["fn"]
        ns = summary["ns"]
        cn = summary["cn"]

        fs_res = summary.get("fs_res")
        ns_res = summary.get("ns_res")
        sfc_res = summary.get("sfc_res")
        cs_res = summary.get("cs_res")
        fns_res = summary.get("fns_res")
        nss_res = summary.get("nss_res")
        cns_res = summary.get("cns_res")

        SAVE_CHECK_PATH = Path.home() / "Desktop" / "对比数据" / "对比结果"
        if not os.path.exists(SAVE_CHECK_PATH):
            os.makedirs(SAVE_CHECK_PATH, exist_ok=True)

        current_date = datetime.now()
        this_month_str = current_date.strftime("%Y%m")
        save_all_path = os.path.join(
            SAVE_CHECK_PATH, f"TE&PE资产对比_{this_month_str}对比总结.xlsx"
        )
        save_pdf_path = os.path.join(
            SAVE_CHECK_PATH, f"TE&PE资产对比_{this_month_str}对比总结.pdf"
        )

        if os.path.exists(save_all_path):
            os.remove(save_all_path)

        try:
            create_excel_template(save_all_path)
        except Exception as err:
            print("Template creation err: ", err)

        wb = load_workbook(save_all_path)
        ws = wb["差异总结"]

        # Numbers Mapping
        this_Finance_Custodian_assets = _safe_len(
            getattr(ff, "this_Custodian_assets", [])
        )
        last_Finance_Custodian_assets = _safe_len(
            getattr(ff, "last_Custodian_assets", [])
        )

        this_Notes_assets = _safe_len(getattr(nn, "this_assets_filtered", []))
        last_Notes_assets = _safe_len(getattr(nn, "last_assets_filtered", []))

        this_Notes_NO_assets = getattr(nn, "this_invalid_all_rows", 0)
        last_Notes_NO_assets = getattr(nn, "last_invalid_all_rows", 0)

        this_SFC_assets = _safe_len(getattr(sfc, "this_SFC_assets", []))
        last_SFC_assets = _safe_len(getattr(sfc, "last_SFC_assets", []))

        this_Customer_assets = _safe_len(getattr(cc, "this_Customer_assets", []))
        last_Customer_assets = _safe_len(getattr(cc, "last_Customer_assets", []))

        this_Notes_Customer_assets = _safe_len(getattr(cn, "this_Notes_assets", []))

        data_rows = [
            [
                last_Finance_Custodian_assets,
                this_Finance_Custodian_assets,
                this_Finance_Custodian_assets - last_Finance_Custodian_assets,
                this_Finance_Custodian_assets - this_Notes_assets,
                "/",
                "/",
            ],
            [
                last_Notes_assets,
                this_Notes_assets,
                this_Notes_assets - last_Notes_assets,
                "",
                this_Notes_assets - this_SFC_assets,
                "/",
            ],
            [
                last_SFC_assets,
                this_SFC_assets,
                this_SFC_assets - last_SFC_assets,
                "/",
                "",
                "/",
            ],
            [
                last_Customer_assets,
                this_Customer_assets,
                this_Customer_assets - last_Customer_assets,
                "/",
                "/",
                this_Notes_Customer_assets - this_Customer_assets,
            ],
            ["/", this_Notes_Customer_assets, "/", "/", "/", ""],
            [
                last_Notes_NO_assets,
                this_Notes_NO_assets,
                this_Notes_NO_assets - last_Notes_NO_assets,
                "/",
                "/",
                "/",
            ],
        ]

        start_row = 5
        start_col = 2
        for row_idx, row_data in enumerate(data_rows):
            for col_idx, value in enumerate(row_data):
                col_letter = get_column_letter(start_col + col_idx)
                coord = f"{col_letter}{start_row + row_idx}"
                ws[coord] = value

        ws.merge_cells("A3:G3")
        ws.merge_cells("E5:E6")
        ws.merge_cells("F6:F7")
        ws.merge_cells("G8:G9")
        ws.merge_cells("A12:G12")

        # Apply Status Colors
        apply_review_colors(ws, req.reviews)

        remark_mapping = [
            (13, "ff"),
            (14, "nn"),
            (15, "sfc"),
            (16, "cc"),
            (17, "fn"),
            (18, "ns"),
            (19, "cn"),
        ]
        for row_idx, r_key in remark_mapping:
            ws.merge_cells(f"B{row_idx}:G{row_idx}")
            cell = ws.cell(row=row_idx, column=2)
            cell.value = req.remarks.get(r_key, "")
            cell.alignment = Alignment(
                horizontal="left", vertical="top", wrap_text=True
            )

        wb.save(save_all_path)

        # 写出 Excel 各项清单（原版通过 RemitUI write_comparison_to_sheet 写出）
        from PyQt5.QtWidgets import QApplication

        QApplication.instance() or QApplication(sys.argv)
        from MyUI import RemitUI

        remit_ui = RemitUI()

        # Structure expects:
        # comparisons = [("sheet_name", diff_dict, comment), ...]
        # diff_dict = {"Category": pd.DataFrame}

        # Gather data

        comparisons = []

        # 1-财务 VS 财务
        if fs_res or ff:
            ff_dict = {}
            if getattr(ff, "new_Custodian_assets", []):
                df = _safe_to_pandas(ff.this_Finance_data)
                ff_dict["依保管人新增"] = df[
                    df["資產編號"].isin(list(ff.new_Custodian_assets))
                ][["資產名稱", "資產編號", "保管人員"]].drop_duplicates(
                    subset=["資產編號"]
                )
            if getattr(ff, "removed_Custodian_assets", []):
                df = _safe_to_pandas(ff.last_Finance_data)
                ff_dict["依保管人减少"] = df[
                    df["資產編號"].isin(list(ff.removed_Custodian_assets))
                ][["資產名稱", "資產編號", "保管人員"]].drop_duplicates(
                    subset=["資產編號"]
                )
            if getattr(ff, "new_Department_assets", []):
                df = _safe_to_pandas(ff.this_Finance_data)
                ff_dict["依部门新增"] = df[
                    df["資產編號"].isin(list(ff.new_Department_assets))
                ][["資產名稱", "資產編號", "資產所屬部門代號"]].drop_duplicates(
                    subset=["資產編號"]
                )
            if getattr(ff, "removed_Department_assets", []):
                df = _safe_to_pandas(ff.last_Finance_data)
                ff_dict["依部门减少"] = df[
                    df["資產編號"].isin(list(ff.removed_Department_assets))
                ][["資產名稱", "資產編號", "資產所屬部門代號"]].drop_duplicates(
                    subset=["資產編號"]
                )
            if ff_dict:
                comparisons.append(
                    ("1-财务 VS 财务", ff_dict, req.remarks.get("ff", ""))
                )

        # 2-Notes VS Notes
        if ns_res or nn:
            nn_dict = {}
            if getattr(nn, "new_assets", []):
                df = _safe_to_pandas(nn.this_Notes_data)
                nn_dict["本月新增"] = df[df["資產編號"].isin(list(nn.new_assets))][
                    ["資產名稱", "資產編號", "保管人"]
                ].drop_duplicates()
            if getattr(nn, "removed_assets", []):
                df = _safe_to_pandas(nn.last_Notes_data)
                nn_dict["本月减少"] = df[df["資產編號"].isin(list(nn.removed_assets))][
                    ["資產名稱", "資產編號", "保管人"]
                ].drop_duplicates()
            if getattr(nn, "new_No_assets", []):
                df = _safe_to_pandas(nn.this_Notes_data)
                try:
                    nn_dict["无资产记录-本月新增"] = df[
                        df["機身SN"].isin(list(nn.new_No_assets))
                    ]
                except Exception:
                    pass
            if getattr(nn, "removed_No_assets", []):
                df = _safe_to_pandas(nn.last_Notes_data)
                try:
                    nn_dict["无资产记录-本月减少"] = df[
                        df["機身SN"].isin(list(nn.removed_No_assets))
                    ]
                except Exception:
                    pass
            if nn_dict:
                comparisons.append(
                    ("2-Notes VS Notes", nn_dict, req.remarks.get("nn", ""))
                )

        # 3-SFC VS SFC
        if sfc_res or sfc:
            ss_dict = {}
            if getattr(sfc, "new_assets", []):
                df = _safe_to_pandas(sfc.this_SFC_data)
                ss_dict["本月新增"] = df[df["资产编号"].isin(list(sfc.new_assets))][
                    ["设备名称", "资产编号", "保管人"]
                ].drop_duplicates()
            if getattr(sfc, "removed_assets", []):
                df = _safe_to_pandas(sfc.last_SFC_data)
                ss_dict["本月减少"] = df[df["资产编号"].isin(list(sfc.removed_assets))][
                    ["设备名称", "资产编号", "保管人"]
                ].drop_duplicates()
            if ss_dict:
                comparisons.append(
                    ("3-SFC VS SFC", ss_dict, req.remarks.get("sfc", ""))
                )

        # 4-客户资产 VS 客户资产
        if cs_res or cc:
            cc_dict = {}
            if getattr(cc, "new_Customer_assets", []):
                df = _safe_to_pandas(cc.this_Customer_data)
                cc_dict["本月新增"] = df[
                    df["Asset ID"].isin(list(cc.new_Customer_assets))
                ][["DRI", "Asset ID", "RFID"]].drop_duplicates()
            if getattr(cc, "removed_Customer_assets", []):
                df = _safe_to_pandas(cc.last_Customer_data)
                cc_dict["本月减少"] = df[
                    df["Asset ID"].isin(list(cc.removed_Customer_assets))
                ][["DRI", "Asset ID", "RFID"]].drop_duplicates()
            if cc_dict:
                comparisons.append(
                    ("4-客户资产 VS 客户资产", cc_dict, req.remarks.get("cc", ""))
                )

        # 5-财务 VS Notes
        if fns_res or fn:
            fn_dict = {}
            if getattr(fn, "new_assets", []):
                df = _safe_to_pandas(fn.Notes_data)
                fn_dict["Notes比财务新增资产"] = df[
                    df["資產編號"].isin(list(fn.new_assets))
                ][["資產名稱", "資產編號", "保管人"]].drop_duplicates()
            if getattr(fn, "removed_assets", []):
                df = _safe_to_pandas(fn.Finance_data)
                fn_dict["Notes比财务减少资产"] = df[
                    df["資產編號"].isin(list(fn.removed_assets))
                ][["資產名稱", "資產編號", "保管人員"]].drop_duplicates()
            if fn_dict:
                comparisons.append(
                    ("5-财务 VS Notes", fn_dict, req.remarks.get("fn", ""))
                )

        # 6-Notes VS SFC
        if nss_res or ns:
            ns_dict = {}
            if getattr(ns, "Notes_new_assets", []):
                df = _safe_to_pandas(ns.this_Notes_data)
                ns_dict["Notes有且SFC无"] = df[
                    df["資產編號"].isin(list(ns.Notes_new_assets))
                ][["資產名稱", "資產編號", "保管人"]].drop_duplicates()
            if getattr(ns, "Notes_removed_assets", []):
                df = _safe_to_pandas(ns.this_SFC_data)
                ns_dict["SFC有且Notes无"] = df[
                    df["资产编号"].isin(list(ns.Notes_removed_assets))
                ][["设备名称", "资产编号", "保管人"]].drop_duplicates()
            if ns_dict:
                comparisons.append(
                    ("6-Notes VS SFC", ns_dict, req.remarks.get("ns", ""))
                )

        # 7-Notes客户资产 VS 客户系统资产
        if cns_res or cn:
            cn_dict = {}
            if getattr(cn, "remove_assets", []):
                df = _safe_to_pandas(cn.this_Customer_data)
                cn_dict["客户有且Notes无"] = df[
                    df["RFID"].isin(list(cn.remove_assets))
                ][["DRI", "Asset ID", "RFID"]].drop_duplicates()
            if getattr(cn, "new_assets", []):
                df = _safe_to_pandas(cn.this_Notes_data)
                cn_dict["Notes有且客户无"] = df[
                    df["RFID（Tag）"].isin(list(cn.new_assets))
                ]
            if cn_dict:
                comparisons.append(
                    (
                        "7-Notes客户资产 VS 客户系统资产",
                        cn_dict,
                        req.remarks.get("cn", ""),
                    )
                )

        # Append using openpyxl directly like the original UI does
        wb = load_workbook(save_all_path)
        for sheet_name, diff_dict, comment in comparisons:
            if sheet_name not in wb.sheetnames:
                wb.create_sheet(sheet_name)
            ws_comp = wb[sheet_name]

            if sheet_name == "1-财务 VS 财务":
                excel_diff_dict = {
                    key: value
                    for key, value in diff_dict.items()
                    if key.startswith("依保管人")
                }
                remit_ui.write_comparison_to_sheet(excel_diff_dict, comment, ws_comp)
            else:
                remit_ui.write_comparison_to_sheet(diff_dict, comment, ws_comp)

        wb.save(save_all_path)

        # Generate PDF as in the original logic
        try:
            excel_sheet_to_pdf(save_all_path, "差异总结", save_pdf_path)
            msg_appendix = f"\n📄 PDF已生成: {save_pdf_path}"
        except Exception as pdf_e:
            msg_appendix = f"\n⚠️ PDF生成失败: {pdf_e}"

        return {
            "status": "success",
            "message": f"核对结果已成功保存到:\n{save_all_path}{msg_appendix}",
        }

    except Exception as e:
        return {
            "status": "error",
            "message": str(e),
            "errors": [traceback.format_exc()],
        }


@router.post("/export/{module}")
async def export_single_module(module: str, req: ComparisonRequest):
    try:
        summary = run_comparisons(req)

        if module == "ff":
            summary["ff"].Save_Check()
            from const import FINANCE_FINANCE_SAVE_PATH

            return {
                "status": "success",
                "message": f"财务对比单独导出成功:\n{FINANCE_FINANCE_SAVE_PATH}",
            }

        elif module == "nn":
            summary["nn"].Save_Notes_Notes_Comparison()
            from const import NOTES_NOTES_SAVE_PATH

            return {
                "status": "success",
                "message": f"Notes对比单独导出成功:\n{NOTES_NOTES_SAVE_PATH}",
            }

        elif module == "sfc":
            summary["sfc"].Save_SFC_SFC_Comparison()
            from const import SFC_SFC_SAVE_PATH

            return {
                "status": "success",
                "message": f"SFC对比单独导出成功:\n{SFC_SFC_SAVE_PATH}",
            }

        elif module == "cc":
            summary["cc"].Save_Customer_Customer_Comparison()
            from const import CUSTOMER_CUSTOMER_SAVE_PATH

            return {
                "status": "success",
                "message": f"客户对比单独导出成功:\n{CUSTOMER_CUSTOMER_SAVE_PATH}",
            }

        elif module == "fn":
            summary["fn"].Save_Finance_Notes_Comparison()
            from const import FINANCE_NOTES_SAVE_PATH

            return {
                "status": "success",
                "message": f"财务-Notes对比单独导出成功:\n{FINANCE_NOTES_SAVE_PATH}",
            }

        elif module == "ns":
            summary["ns"].Save_Notes_SFC_Comparison()
            from const import NOTES_SFC_SAVE_PATH

            return {
                "status": "success",
                "message": f"Notes-SFC对比单独导出成功:\n{NOTES_SFC_SAVE_PATH}",
            }

        elif module == "cn":
            summary["cn"].Save_Customer_Notes_Comparison()
            from const import CUSTOMER_NOTES_SAVE_PATH

            return {
                "status": "success",
                "message": f"客户-Notes对比单独导出成功:\n{CUSTOMER_NOTES_SAVE_PATH}",
            }
        else:
            return {"status": "error", "message": "未知的导出模块"}

    except Exception as e:
        return {
            "status": "error",
            "message": str(e),
            "errors": [traceback.format_exc()],
        }
