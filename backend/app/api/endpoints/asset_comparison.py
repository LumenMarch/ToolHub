import os
import shutil
import tempfile
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from typing import List

from dateutil.relativedelta import relativedelta
from fastapi import APIRouter, File, UploadFile
from openpyxl import load_workbook
from openpyxl.styles import Alignment, PatternFill
from openpyxl.utils import get_column_letter
from pydantic import BaseModel

from app.services.asset_engine.Customer_Customer import Customer_Customer
from app.services.asset_engine.Customer_Notes import Customer_Notes
from app.services.asset_engine.Finance_Finance import Finance_Finance
from app.services.asset_engine.Finance_Notes import Finance_Notes
from app.services.asset_engine.Notes_Notes import Notes_Notes
from app.services.asset_engine.Notes_SFC import Notes_SFC
from app.services.asset_engine.SFC_SFC import SFC_SFC

try:
    from app.services.asset_engine.mod import create_excel_template
except ImportError:
    pass
try:
    from app.services.asset_engine.pdf_generator import excel_sheet_to_pdf
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


@router.get("/resolve-folder")
async def resolve_folder(name: str = ""):
    """前端选文件夹后只能拿到文件夹名，用 find 搜索定位绝对路径"""
    import subprocess

    if not name or not name.strip():
        return {"status": "error", "message": "请提供文件夹名"}

    search_dirs = [
        str(Path.home() / "Desktop"),
        str(Path.home() / "Downloads"),
        str(Path.home() / "Documents"),
    ]
    found_paths = []

    for search_dir in search_dirs:
        if not os.path.isdir(search_dir):
            continue
        try:
            result = subprocess.run(
                ["find", search_dir, "-maxdepth", "3", "-type", "d", "-name", name.strip()],
                capture_output=True, text=True, timeout=5
            )
            for line in result.stdout.strip().split("\n"):
                line = line.strip()
                if line:
                    found_paths.append(line)
        except Exception:
            continue

    if found_paths:
        # 如果有多个匹配，优先选文件数量最多的那个
        best_path = ""
        best_count = 0
        for p in found_paths:
            try:
                cnt = len([f for f in os.listdir(p) if os.path.isfile(os.path.join(p, f)) and not f.startswith("~")])
            except Exception:
                cnt = 0
            if cnt > best_count:
                best_count = cnt
                best_path = p
        return {"status": "success", "path": best_path, "file_count": best_count, "candidates": found_paths}
    else:
        return {"status": "not_found", "message": f"未在 Desktop/Downloads/Documents 下找到名为 '{name}' 的文件夹"}


def _build_match_rules(this_month_str: str, last_month_str: str) -> dict:
    """构建文件名匹配规则"""
    return {
        "thisFinance": ("财务资产", "monthly", this_month_str),
        "lastFinance": ("财务资产", "monthly", last_month_str),
        "thisSFC": ("SFC资产", "monthly", this_month_str),
        "lastSFC": ("SFC资产", "monthly", last_month_str),
        "thisNotes": ("Notes资产", "monthly", this_month_str),
        "lastNotes": ("Notes资产", "monthly", last_month_str),
        "thisCustomer": ("客户资产", "monthly", this_month_str),
        "lastCustomer": ("客户资产", "monthly", last_month_str),
        "custodianData": ("财务保管人", "fixed", ""),
        "departmentData": ("财务保管部门", "fixed", ""),
        "driData": ("客户系统DRI", "fixed", ""),
    }


def _scan_and_match(folder: Path, match_rules: dict) -> tuple:
    """扫描文件夹中的文件并匹配，返回 (result_dict, found_files, matched_log)"""
    result = {k: "" for k in match_rules}
    found_files = []
    matched_log = []

    if folder.exists() and folder.is_dir():
        for f in folder.iterdir():
            if f.is_file() and not f.name.startswith("~"):
                found_files.append(f.name)
                stem = f.stem
                stem_clean = stem.replace(" ", "").replace("_", "").replace("-", "")
                for k, (keyword, rule_type, expected_date) in match_rules.items():
                    kw_clean = keyword.replace(" ", "")
                    if rule_type == "fixed":
                        if stem_clean == kw_clean:
                            result[k] = str(f)
                            matched_log.append(f"✓ {f.name} → {k}")
                    elif rule_type == "monthly":
                        if kw_clean in stem_clean and expected_date in stem_clean:
                            result[k] = str(f)
                            matched_log.append(f"✓ {f.name} → {k}")
    else:
        found_files.append("⚠️ 文件夹不存在或不是目录")

    return result, found_files, matched_log


@router.post("/upload-and-scan")
async def upload_and_scan(files: List[UploadFile] = File(...)):
    """接收前端上传的数据文件，存入服务器临时目录，扫描匹配后返回路径"""
    session_id = uuid.uuid4().hex[:8]
    temp_dir = Path(tempfile.gettempdir()) / "asset-compare" / session_id
    temp_dir.mkdir(parents=True, exist_ok=True)

    saved_files = []
    for file in files:
        safe_name = Path(file.filename).name  # 去除路径，只保留文件名
        if not safe_name or safe_name.startswith("~"):
            continue
        file_path = temp_dir / safe_name
        content = await file.read()
        file_path.write_bytes(content)
        saved_files.append(safe_name)

    current_date = datetime.now()
    this_month_str = current_date.strftime("%Y%m")
    last_month_date = current_date - relativedelta(months=1)
    last_month_str = last_month_date.strftime("%Y%m")

    match_rules = _build_match_rules(this_month_str, last_month_str)
    result, found_files, matched_log = _scan_and_match(temp_dir, match_rules)

    return {
        "status": "success",
        "data": result,
        "session_id": session_id,
        "temp_dir": str(temp_dir),
        "debug": {
            "folder": str(temp_dir),
            "found_files": found_files,
            "matched": matched_log,
        },
    }


@router.get("/auto-paths")
async def get_auto_paths(folder: str = ""):
    current_date = datetime.now()
    this_month_str = current_date.strftime("%Y%m")
    last_month_date = current_date - relativedelta(months=1)
    last_month_str = last_month_date.strftime("%Y%m")

    if folder:
        all_data_path = Path(folder)
    else:
        all_data_path = Path.home() / "Desktop" / "对比数据"

    match_rules = _build_match_rules(this_month_str, last_month_str)
    result, found_files, matched_log = _scan_and_match(all_data_path, match_rules)

    return {
        "status": "success",
        "data": result,
        "debug": {
            "folder": str(all_data_path),
            "found_files": found_files,
            "matched": matched_log,
        },
    }


def _safe_len(d):
    if d is None:
        return 0
    try:
        return len(d)
    except Exception:
        return 0


def task_ff(req: ComparisonRequest):
    ff = Finance_Finance(None)
    ff.this_Finance_path = req.thisFinance
    ff.last_Finance_path = req.lastFinance
    ff.Custodian_path = req.custodianData
    ff.Department_path = req.departmentData
    info = None
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
            # 依保管人 & 依部门 子维度明细
            cust_new = _safe_len(ff.new_Custodian_assets)
            cust_rm = _safe_len(ff.removed_Custodian_assets)
            cust_anomaly = _safe_len(ff.check_Custodian)
            dept_new = _safe_len(ff.new_Department_assets)
            dept_rm = _safe_len(ff.removed_Department_assets)
            dept_anomaly = _safe_len(ff.check_Department)
            info = {
                "key": "ff",
                "label": "【财务-财务】",
                "has_diff": diff_count > 0,
                "msg": f"保管人异常 {cust_anomaly} | 部门异常 {dept_anomaly}",
                "sub_groups": [
                    {
                        "label": "依保管人差异",
                        "new_count": cust_new,
                        "removed_count": cust_rm,
                        "anomaly_count": cust_anomaly,
                        "has_diff": (cust_new + cust_rm + cust_anomaly) > 0,
                    },
                    {
                        "label": "依部门差异",
                        "new_count": dept_new,
                        "removed_count": dept_rm,
                        "anomaly_count": dept_anomaly,
                        "has_diff": (dept_new + dept_rm + dept_anomaly) > 0,
                    },
                ],
            }
        except Exception as e:
            info = {
                "key": "ff",
                "label": "【财务-财务】",
                "has_diff": False,
                "msg": f"异常: {e}",
            }
    return "ff", ff, info


def task_sfc(req: ComparisonRequest):
    sfc = SFC_SFC(None)
    sfc.This_data_Path = req.thisSFC
    sfc.Last_data_path = req.lastSFC
    info = None
    if req.thisSFC and req.lastSFC:
        try:
            sfc.This_SFC_date()
            sfc.Last_SFC_date()
            sfc.SFC_SFC_Comparison()
            diff_count = _safe_len(sfc.new_assets) + _safe_len(sfc.removed_assets)
            info = {
                "key": "sfc",
                "label": "【SFC-SFC】",
                "has_diff": diff_count > 0,
                "msg": f"新增: {_safe_len(sfc.new_assets)}, 减少: {_safe_len(sfc.removed_assets)}",
            }
        except Exception as e:
            info = {
                "key": "sfc",
                "label": "【SFC-SFC】",
                "has_diff": False,
                "msg": f"异常: {e}",
            }
    return "sfc", sfc, info


def task_nn(req: ComparisonRequest):
    nn = Notes_Notes(None)
    nn.This_Notes_path = req.thisNotes
    nn.Last_Notes_path = req.lastNotes
    info = None
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
            info = {
                "key": "nn",
                "label": "【Notes-Notes】",
                "has_diff": diff_count > 0,
                "msg": f"有资产新增: {_safe_len(nn.new_assets)}, 有资产减少: {_safe_len(nn.removed_assets)} | 无资产总差异: {abs(_safe_len(nn.new_No_assets) - _safe_len(nn.removed_No_assets))}",
            }
        except Exception as e:
            info = {
                "key": "nn",
                "label": "【Notes-Notes】",
                "has_diff": False,
                "msg": f"异常: {e}",
            }
    return "nn", nn, info


def task_cc(req: ComparisonRequest):
    cc = Customer_Customer(None)
    cc.this_Customer_path = req.thisCustomer
    cc.last_Customer_path = req.lastCustomer
    cc.Custodian_DRI_path = req.driData
    info = None
    if req.thisCustomer and req.lastCustomer and req.driData:
        try:
            cc.get_Customer_DRI()
            cc.read_this_Customer_data()
            cc.read_last_Customer_data()
            cc.Customer_Customer_Comparison()
            diff_count = _safe_len(cc.new_Customer_assets) + _safe_len(
                cc.removed_Customer_assets
            )
            info = {
                "key": "cc",
                "label": "【客户-客户】",
                "has_diff": diff_count > 0,
                "msg": f"新增: {_safe_len(cc.new_Customer_assets)}, 减少: {_safe_len(cc.removed_Customer_assets)}",
            }
        except Exception as e:
            info = {
                "key": "cc",
                "label": "【客户-客户】",
                "has_diff": False,
                "msg": f"异常: {e}",
            }
    return "cc", cc, info


def task_fn(req: ComparisonRequest):
    fn = Finance_Notes(None)
    fn.Finance_path = req.thisFinance
    fn.Notes_path = req.thisNotes
    fn.Custodian_path = req.custodianData
    info = None
    if req.thisFinance and req.thisNotes and req.custodianData:
        try:
            fn.read_Custodian_data()
            fn.read_Finance_data()
            fn.read_Notes_data()
            fn.Finance_Notes_Comparison()
            diff_count = _safe_len(fn.removed_assets) + _safe_len(fn.new_assets)
            info = {
                "key": "fn",
                "label": "【财务比Notes】",
                "has_diff": diff_count > 0,
                "msg": f"财务比Notes新增: {_safe_len(fn.removed_assets)}, 财务比Notes减少: {_safe_len(fn.new_assets)}",
            }
        except Exception as e:
            info = {
                "key": "fn",
                "label": "【财务比Notes】",
                "has_diff": False,
                "msg": f"异常: {e}",
            }
    return "fn", fn, info


def task_ns(req: ComparisonRequest):
    ns = Notes_SFC(None)
    ns.this_Notes_path = req.thisNotes
    ns.this_SFC_path = req.thisSFC
    info = None
    if req.thisNotes and req.thisSFC:
        try:
            ns.This_Notes_date()
            ns.This_SFC_date()
            ns.Notes_SFC_Comparison()
            diff_count = _safe_len(ns.Notes_new_assets) + _safe_len(
                ns.Notes_removed_assets
            )
            info = {
                "key": "ns",
                "label": "【Notes比SFC】",
                "has_diff": diff_count > 0,
                "msg": f"Notes比SFC新增: {_safe_len(ns.Notes_new_assets)}, Notes比SFC减少: {_safe_len(ns.Notes_removed_assets)}",
            }
        except Exception as e:
            info = {
                "key": "ns",
                "label": "【Notes比SFC】",
                "has_diff": False,
                "msg": f"异常: {e}",
            }
    return "ns", ns, info


def task_cn(req: ComparisonRequest):
    cn = Customer_Notes(None)
    cn.this_Customer_path = req.thisCustomer
    cn.this_Notes_path = req.thisNotes
    cn.this_Customer_DRI_path = req.driData
    info = None
    if req.thisCustomer and req.thisNotes and req.driData:
        try:
            cn.read_Customer_DRI()
            cn.read_this_Customer_data()
            cn.read_this_Notes_data()
            cn.Customer_Notes_Comparison()
            diff_count = _safe_len(cn.remove_assets) + _safe_len(cn.new_assets)
            info = {
                "key": "cn",
                "label": "【客户比Notes】",
                "has_diff": diff_count > 0,
                "msg": f"客户比Notes新增: {_safe_len(cn.remove_assets)}, 客户比Notes减少: {_safe_len(cn.new_assets)}",
            }
        except Exception as e:
            info = {
                "key": "cn",
                "label": "【客户比Notes】",
                "has_diff": False,
                "msg": f"异常: {e}",
            }
    return "cn", cn, info


def run_comparisons(req: ComparisonRequest):
    summary = {}
    results_info = []

    # 使用普通线程池并发执行 7 个比对任务
    with ThreadPoolExecutor(max_workers=7) as executor:
        futures = [
            executor.submit(task_ff, req),
            executor.submit(task_sfc, req),
            executor.submit(task_nn, req),
            executor.submit(task_cc, req),
            executor.submit(task_fn, req),
            executor.submit(task_ns, req),
            executor.submit(task_cn, req),
        ]
        for future in futures:
            key, instance, info = future.result()
            summary[key] = instance
            if info:
                results_info.append(info)

    # 排序以保持输出顺序稳定
    order = ["ff", "sfc", "nn", "cc", "fn", "ns", "cn"]
    results_info.sort(key=lambda x: order.index(x["key"]) if x["key"] in order else 99)

    summary["results_info"] = results_info
    return summary


def apply_review_colors(ws, req_reviews):
    """根据前端的选择，给对应单元格涂色"""
    color_mapping = {
        "差異確認OK": "71D0F1",
        "待跟进": "FFEE00",
        "異常": "EC4337",
    }

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


def estimate_width_by_font(value, font_size=12):
    value_str = str(value)
    width = 0
    for ch in value_str:
        if "\u4e00" <= ch <= "\u9fff":
            width += 2.1
        elif ch.isupper():
            width += 1.5
        else:
            width += 1
    return width * (font_size / 11)


def auto_adjust_row_height(ws, row, col, content, font_size=11, max_chars_per_line=50):
    lines_by_newline = content.split("\n")
    total_lines = 0
    for line in lines_by_newline:
        if len(line) == 0:
            total_lines += 1
        else:
            total_lines += (len(line) // max_chars_per_line) + 1
    ws.row_dimensions[row].height = max(20, total_lines * 15)


def write_comparison_to_sheet(diff_dict, comment: str, ws):
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    from openpyxl.utils import get_column_letter

    start_col = 3
    row = 1
    font = Font(name="Arial", size=12)
    align_center = Alignment(horizontal="center", vertical="center", wrap_text=False)
    border = Border(
        left=Side(style="thin"),
        right=Side(style="thin"),
        top=Side(style="thin"),
        bottom=Side("thin"),
    )
    fill_title_bg = PatternFill(fill_type="solid", fgColor="D9E1F2")

    max_col_widths = dict()
    categories = list(diff_dict.keys())

    for idx, category in enumerate(categories):
        df = diff_dict[category]
        if df is None or df.empty:
            continue

        title_text = f"【{category}】（{len(df)}笔）"
        end_col = start_col + len(df.columns)
        ws.merge_cells(
            start_row=row, start_column=start_col, end_row=row, end_column=end_col
        )
        cell = ws.cell(row=row, column=start_col, value=title_text)
        cell.font = font
        cell.alignment = align_center
        cell.border = border
        cell.fill = fill_title_bg
        for col in range(start_col + 1, end_col + 1):
            ws.cell(row=row, column=col).border = border
            ws.cell(row=row, column=col).fill = fill_title_bg
        max_col_widths[start_col] = max(
            max_col_widths.get(start_col, 0),
            estimate_width_by_font(title_text, font.size),
        )
        ws.row_dimensions[row].height = 25
        row += 1

        if comment.strip():
            remark_bg_fill = PatternFill(
                start_color="DEDEDE", end_color="DEDEDE", fill_type="solid"
            )
            remark_cell = ws.cell(row=row, column=start_col, value="備註：")
            remark_cell.border = border
            remark_cell.font = font
            remark_cell.alignment = align_center
            remark_cell.fill = remark_bg_fill
            max_col_widths[start_col] = max(
                max_col_widths.get(start_col, 0),
                estimate_width_by_font("備註：", font.size),
            )

            ws.merge_cells(
                start_row=row,
                start_column=start_col + 1,
                end_row=row,
                end_column=start_col + 3,
            )
            cell = ws.cell(row=row, column=start_col + 1, value=comment.strip())
            cell.font = font
            cell.alignment = Alignment(
                horizontal="center", vertical="center", wrap_text=True
            )
            cell.border = border
            cell.fill = remark_bg_fill

            for col in range(start_col + 1, start_col + 4):
                cell = ws.cell(row=row, column=col)
                cell.border = border
                cell.fill = remark_bg_fill
                max_col_widths[col] = max(
                    max_col_widths.get(col, 0),
                    estimate_width_by_font(comment.strip(), font.size),
                )

            auto_adjust_row_height(ws, row, start_col + 1, comment.strip())
            row += 1

        ws.cell(row=row, column=start_col, value="No.").font = font
        ws.cell(row=row, column=start_col).alignment = align_center
        ws.cell(row=row, column=start_col).border = border
        max_col_widths[start_col] = max(
            max_col_widths.get(start_col, 0), estimate_width_by_font("No.", font.size)
        )

        for col_idx, col_name in enumerate(df.columns, start=start_col + 1):
            cell = ws.cell(row=row, column=col_idx, value=col_name)
            cell.font = font
            cell.alignment = align_center
            cell.border = border
            max_col_widths[col_idx] = max(
                max_col_widths.get(col_idx, 0),
                estimate_width_by_font(col_name, font.size),
            )
        row += 1

        for i, (_, row_series) in enumerate(df.iterrows(), start=1):
            cell = ws.cell(row=row, column=start_col, value=i)
            cell.font = font
            cell.alignment = align_center
            cell.border = border
            max_col_widths[start_col] = max(
                max_col_widths.get(start_col, 0),
                estimate_width_by_font(str(i), font.size),
            )

            for col_idx, value in enumerate(row_series, start=start_col + 1):
                value_str = str(value)
                cell = ws.cell(row=row, column=col_idx, value=value_str)
                cell.font = font
                cell.alignment = align_center
                cell.border = border
                max_col_widths[col_idx] = max(
                    max_col_widths.get(col_idx, 0),
                    estimate_width_by_font(value_str, font.size),
                )
            row += 1

        if (
            category == "本月新增"
            and idx + 1 < len(categories)
            and categories[idx + 1] == "本月减少"
        ):
            row += 3
        else:
            row += 1

    for col_idx, width in max_col_widths.items():
        col_letter = get_column_letter(col_idx)
        adjusted_width = min(width * 1.2, 50)
        ws.column_dimensions[col_letter].width = adjusted_width


@router.post("/save")
async def save_results(req: ComparisonRequest):
    try:
        summary = run_comparisons(req)
        ff = summary.get("ff")
        nn = summary.get("nn")
        sfc = summary.get("sfc")
        cc = summary.get("cc")
        fn = summary.get("fn")
        ns = summary.get("ns")
        cn = summary.get("cn")

        from app.services.asset_engine.const import SAVE_CHECK_PATH

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

        comparisons = []

        # 1-财务 VS 财务
        if ff:
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
        if nn:
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
        if sfc:
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
        if cc:
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
        if fn:
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
        if ns:
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
        if cn:
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
                write_comparison_to_sheet(excel_diff_dict, comment, ws_comp)
            else:
                write_comparison_to_sheet(diff_dict, comment, ws_comp)

        wb.save(save_all_path)

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
        from app.services.asset_engine.const import (
            CUSTOMER_CUSTOMER_SAVE_PATH,
            CUSTOMER_NOTES_SAVE_PATH,
            FINANCE_FINANCE_SAVE_PATH,
            FINANCE_NOTES_SAVE_PATH,
            NOTES_NOTES_SAVE_PATH,
            NOTES_SFC_SAVE_PATH,
            SFC_SFC_SAVE_PATH,
        )

        if module == "ff":
            summary["ff"].Save_Check()
            return {
                "status": "success",
                "message": f"财务对比单独导出成功:\n{FINANCE_FINANCE_SAVE_PATH}",
            }

        elif module == "nn":
            summary["nn"].Save_Notes_Notes_Comparison()
            return {
                "status": "success",
                "message": f"Notes对比单独导出成功:\n{NOTES_NOTES_SAVE_PATH}",
            }

        elif module == "sfc":
            summary["sfc"].Save_SFC_SFC_Comparison()
            return {
                "status": "success",
                "message": f"SFC对比单独导出成功:\n{SFC_SFC_SAVE_PATH}",
            }

        elif module == "cc":
            summary["cc"].Save_Customer_Customer_Comparison()
            return {
                "status": "success",
                "message": f"客户对比单独导出成功:\n{CUSTOMER_CUSTOMER_SAVE_PATH}",
            }

        elif module == "fn":
            summary["fn"].Save_Finance_Notes_Comparison()
            return {
                "status": "success",
                "message": f"财务-Notes对比单独导出成功:\n{FINANCE_NOTES_SAVE_PATH}",
            }

        elif module == "ns":
            summary["ns"].Save_Notes_SFC_Comparison()
            return {
                "status": "success",
                "message": f"Notes-SFC对比单独导出成功:\n{NOTES_SFC_SAVE_PATH}",
            }

        elif module == "cn":
            summary["cn"].Save_Customer_Notes_Comparison()
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
