import base64
import os
import struct
import tempfile
import threading
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field, StringConstraints, model_validator
from sqlalchemy.orm import Session

from app.api import deps
from app.core.auth import require_tool_permission
from app.core.config import settings
from app.models.user import User
from app.services.audit import log_action
from app.services.cpk_charts import parser as opp_parser
from app.services.upload.store import (
    UploadNotCompleteError,
    UploadNotFoundError,
    UploadOwnershipError,
    UploadStore,
)

router = APIRouter()

UPLOAD_STORE = UploadStore()
OPP_CACHE_DIR = Path(settings.TASK_ARTIFACT_ROOT) / "cpk_charts"
# 同一上传只解析一次：并发请求排队，其余命中缓存
_PARSE_LOCKS: dict[str, threading.Lock] = {}
_PARSE_LOCKS_GUARD = threading.Lock()


def _parse_lock(upload_id: str) -> threading.Lock:
    with _PARSE_LOCKS_GUARD:
        return _PARSE_LOCKS.setdefault(upload_id, threading.Lock())


class OppParseRequest(BaseModel):
    upload_id: str = Field(min_length=1, max_length=64)


class OppColumnMeta(BaseModel):
    name: str
    unit: str
    upper: str
    lower: str


class OppParseResponse(BaseModel):
    upload_id: str
    title: str
    records: int
    columns: list[OppColumnMeta]
    all_columns: list[str]
    skipped_columns: list[str]
    has_fail_records: bool
    # 状态掩码（base64，1 = PASS/空），无状态列时为 null
    status_pass: str | None
    header_row_index: int
    data_start_row: int
    sn_column: int | None
    start_time_column: int | None
    end_time_column: int | None
    lower_limit_row: int | None
    upper_limit_row: int | None
    unit_row: int | None


def _owned_upload(upload_id: str, user_id: int) -> dict:
    """校验上传标识与归属，失败时返回明确 HTTP 状态。"""
    if not opp_parser.UPLOAD_ID_RE.fullmatch(upload_id):
        raise HTTPException(status_code=400, detail="非法上传标识")
    try:
        return UPLOAD_STORE.get_owned_info(upload_id, user_id)
    except UploadOwnershipError as exc:
        raise HTTPException(status_code=403, detail="无权访问此上传") from exc
    except UploadNotFoundError as exc:
        raise HTTPException(status_code=404, detail="上传不存在") from exc
    except UploadNotCompleteError as exc:
        raise HTTPException(status_code=409, detail="上传尚未完成") from exc


@router.post("/parse", response_model=OppParseResponse)
def parse_opp_dataset(
    req: OppParseRequest,
    request: Request,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(require_tool_permission("cpk-charts")),
) -> OppParseResponse:
    """解析 tus 上传的 CSV/Excel 为 OPP 数据集（首次解析后落盘缓存）。"""
    info = _owned_upload(req.upload_id, current_user.id)
    meta = opp_parser.read_meta(OPP_CACHE_DIR, req.upload_id)
    if meta is None:
        lock = _parse_lock(req.upload_id)
        with lock:
            meta = opp_parser.read_meta(OPP_CACHE_DIR, req.upload_id)
            if meta is None:
                path = UPLOAD_STORE.get_owned_file_path(req.upload_id, current_user.id)
                try:
                    dataset = opp_parser.parse_file(path, info.get("filename", ""))
                except opp_parser.OppParseError as exc:
                    raise HTTPException(status_code=400, detail=str(exc)) from exc
                opp_parser.write_cache(OPP_CACHE_DIR, req.upload_id, dataset)
                meta = dataset.meta()
        log_action(
            db,
            request=request,
            user=current_user,
            action="tool.cpk_charts.parse",
            target_type="tool",
            target_id="cpk-charts",
            detail={"ok": True, "records": meta.get("records", 0)},
        )
    status = opp_parser.read_status(OPP_CACHE_DIR, req.upload_id)
    return OppParseResponse(
        upload_id=req.upload_id,
        status_pass=base64.b64encode(status).decode("ascii") if status else None,
        **meta,
    )


@router.get("/column/{upload_id}/{index}")
def get_opp_column(
    upload_id: str,
    index: int,
    current_user: User = Depends(require_tool_permission("cpk-charts")),
) -> Response:
    """返回一列原始数值：``[u32 n][f64 × n][u8 × n]``。

    数值里的 NaN 表示该单元没有可解析数值；u8 标记 1 = 非空（非 NA）单元，
    前端据此还原 Data Count / NA Count 语义。
    """
    _owned_upload(upload_id, current_user.id)
    data = opp_parser.read_column(OPP_CACHE_DIR, upload_id, index)
    if data is None:
        raise HTTPException(status_code=404, detail="数据集未解析或列不存在")
    values, flags = data
    body = struct.pack("<I", len(flags)) + values + flags
    return Response(
        content=body,
        media_type="application/octet-stream",
        headers={"Cache-Control": "private, max-age=3600"},
    )


MAX_ITEM_CHARS = 200
MAX_TOTAL_ITEM_CHARS = 50_000
MAX_IMAGE_B64_CHARS = 8 * 1024 * 1024

ItemName = Annotated[str, StringConstraints(max_length=MAX_ITEM_CHARS)]
ImageB64 = Annotated[str, StringConstraints(max_length=MAX_IMAGE_B64_CHARS)]


class _UnlinkingFileResponse(FileResponse):
    """响应发送结束后删除临时文件，包括 Starlette 提前返回的 400/416 路径。"""

    def __init__(self, *args, cleanup_path: Path, **kwargs):
        super().__init__(*args, **kwargs)
        self._cleanup_path = cleanup_path

    async def __call__(self, scope, receive, send) -> None:
        try:
            await super().__call__(scope, receive, send)
        finally:
            self._cleanup_path.unlink(missing_ok=True)


# 行列常量（行号与原报告一致，宽高改为自适应计算）
HEADER_ROW = 1
DATA_START_ROW = 2

# 自适应布局：基于内容计算最优列宽与行高
ITEM_FONT_SIZE = 15.0
HEADER_FONT_SIZE = 20.0
# 图表期望宽高比（原图 1000x300）
CHART_ASPECT = 1000 / 300  # 3.333


def _estimate_text_width(
    text: str, font_size: float, stop_at: float | None = None
) -> float:
    """估算文本宽度（points），中文按 0.95*fontSize，ASCII 按 0.6*fontSize。"""
    w = 0.0
    for ch in text:
        if "\u4e00" <= ch <= "\u9fff" or "\u3400" <= ch <= "\u4dbf":
            w += font_size * 0.9
        elif ch == " ":
            w += font_size * 0.35
        else:
            w += font_size * 0.58
        if stop_at is not None and w > stop_at:
            return w
    return w


def _compute_adaptive_layout(
    items: list[str],
    header_a: str,
    header_b: str,
    extra_headers: list[str] | None = None,
):
    """计算自适应最优列宽与行高。

    返回 (col_widths, header_row_height, row_heights)；没有数据 B 时 C 列整列省略，
    列宽数为 (2 或 3) + len(extra_headers)。
    """
    extra_headers = extra_headers or []
    has_b = bool(header_b)
    # --- 列宽 ---
    # Item 列：基于所有 Item 名称 + 表头 "Item" 在 15pt 下的宽度，留 24pt 内边距
    max_item_w = _estimate_text_width("Item", ITEM_FONT_SIZE)
    for name in items:
        w = _estimate_text_width(name, ITEM_FONT_SIZE, stop_at=520)
        if w > max_item_w:
            max_item_w = w
    # 文本换行时仍需可读，Item 列允许换行，故按单行宽度 + 边距后 clamp
    col0 = max_item_w + 24
    # 限制区间：过窄会挤压换行过多，过宽则 B/C 列被挤压
    col0 = max(300, min(col0, 520))

    # B/C 列：固定为 710（按图片 1000×300 比例 3.333 精确计算：213*3.333≈710，确保 630 时 X 轴被裁剪的问题完全解决，图片等比填满无拉伸）
    col1 = 710
    col2 = 710

    # 累加列（New_limitsN）与 A/B 列同宽，保证图表等比填满；无 B 数据时省略 B 列
    col_widths = [col0, col1, *([col2] if has_b else []), *([710] * len(extra_headers))]

    # --- 行高 ---
    # 表头行：仍按文件名换行自适应，但限制在 28-64
    def _header_lines(text: str, col_w: float) -> int:
        if not text:
            return 1
        tw = _estimate_text_width(text, HEADER_FONT_SIZE)
        usable = max(col_w - 16, 80)
        return max(1, int((tw + usable - 1) // usable))

    header_line_counts = [
        _header_lines("Item", col0),
        _header_lines(header_a, col1),
        *([_header_lines(header_b, col2)] if has_b else []),
        *[_header_lines(text, 710) for text in extra_headers],
    ]
    header_lines = max(*header_line_counts, 1)
    header_h = header_lines * HEADER_FONT_SIZE * 1.35 + 16
    header_h = max(28, min(header_h, 64))

    # 数据行：固定为 213（用户要求），确保 630 宽的图表完整显示无裁剪
    # 630/1000*300 ≈189 高，213 留 24pt 上下留白，完全容纳
    row_heights: list[float] = [213.0] * len(items)

    return col_widths, header_h, row_heights


class ItemCheckReportRequest(BaseModel):
    items: list[ItemName] = Field(
        ..., min_length=1, max_length=500, description="勾选的测试项名称，按展示顺序"
    )
    fileNameA: str = Field(
        ..., max_length=255, description="数据 A 文件名，用于表头 B 列"
    )
    fileNameB: str | None = Field(
        default=None, max_length=255, description="数据 B 文件名，用于表头 C 列"
    )
    imagesA: list[ImageB64] = Field(
        ...,
        description="数据 A 的 PNG 图，base64 编码，与 items 一一对应，空字符串表示无图",
    )
    imagesB: list[ImageB64] | None = Field(
        default=None, description="数据 B 的 PNG 图，base64 编码，与 items 一一对应"
    )
    extraHeaders: list[ItemName] = Field(
        default_factory=list,
        max_length=20,
        description="累加模式追加列的表头，如 New_limits1/New_limits2",
    )
    imagesExtra: list[list[ImageB64]] | None = Field(
        default=None,
        description="累加模式图片矩阵：行与 items 对应，列与 extraHeaders 对应，空字符串表示该格留空",
    )

    @model_validator(mode="after")
    def _bound_total_items(self) -> "ItemCheckReportRequest":
        if sum(len(s) for s in self.items) > MAX_TOTAL_ITEM_CHARS:
            raise ValueError("items 总长度超过限制")
        return self


def _decode_b64_maybe_empty(s: str) -> bytes | None:
    if not s or not s.strip():
        return None
    # 兼容 data:image/png;base64, 前缀
    b64 = s.split(",")[-1].strip()
    # 去除空白
    b64 = "".join(b64.split())
    if not b64:
        return None
    try:
        data = base64.b64decode(b64, validate=True)
    except Exception:
        # 尝试宽松解码
        try:
            data = base64.b64decode(b64)
        except Exception as exc:
            raise HTTPException(
                status_code=400, detail=f"图片 base64 解码失败: {exc}"
            ) from exc
    # 简单校验 PNG 魔数
    if len(data) < 8 or data[:8] != b"\x89PNG\r\n\x1a\n":
        raise HTTPException(status_code=400, detail="图片不是有效的 PNG")
    if len(data) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="单张图片超过 5MB 限制")
    return data


@router.post("/item-check-report")
def create_item_check_report(
    request: Request,
    body: ItemCheckReportRequest,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(require_tool_permission("cpk-charts")),
):
    items = body.items
    file_name_a = (body.fileNameA or "").strip() or "数据 A"
    file_name_b = (body.fileNameB or "").strip() or ""

    images_a = body.imagesA
    images_b = body.imagesB or []
    extra_headers = body.extraHeaders or []
    images_extra = body.imagesExtra or []
    # 没有数据 B（文件名与图片都为空）时，报告只保留 A 列，不输出空的“数据 B”列
    has_b = bool((body.fileNameB or "").strip()) or any(cell for cell in images_b)

    if len(images_a) != len(items):
        raise HTTPException(
            status_code=400,
            detail=f"imagesA 数量({len(images_a)})与 items({len(items)})不一致",
        )
    if images_b and len(images_b) != len(items):
        raise HTTPException(
            status_code=400,
            detail=f"imagesB 数量({len(images_b)})与 items({len(items)})不一致",
        )
    if images_extra:
        if len(images_extra) != len(items):
            raise HTTPException(
                status_code=400,
                detail=f"imagesExtra 行数({len(images_extra)})与 items({len(items)})不一致",
            )
        for row_index, row in enumerate(images_extra):
            if len(row) != len(extra_headers):
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"imagesExtra 第 {row_index + 1} 行有 {len(row)} 张图，"
                        f"与 extraHeaders({len(extra_headers)}) 不一致"
                    ),
                )

    # 限制总大小，避免超大请求拖垮服务
    total_b64_len = (
        sum(len(s) for s in images_a)
        + sum(len(s) for s in images_b)
        + sum(len(cell) for row in images_extra for cell in row)
    )
    if total_b64_len > 80 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="图片总大小超过限制（80MB base64）")

    try:
        from numbers_parser import Alignment, BackgroundImage, Document
    except ImportError as exc:
        raise HTTPException(
            status_code=500, detail="服务端未安装 numbers-parser"
        ) from exc

    # 文件名过长时截断，避免单元格溢出
    header_a = file_name_a[:200] if len(file_name_a) > 200 else file_name_a
    header_b = file_name_b[:200] if len(file_name_b) > 200 else file_name_b

    # 计算自适应最优列宽与行高（字体：Item 15 / 表头 20，均不加粗、居中）
    # 无 B 数据时 header_b 置空，布局与表头都按两列处理
    layout_header_b = header_b if has_b else ""
    col_widths, header_h, row_heights = _compute_adaptive_layout(
        items, header_a, layout_header_b, extra_headers
    )

    doc = Document()
    table = doc.sheets[0].tables[0]

    need_rows = len(items) + 2  # R0 空行 + R1 表头 + 数据行
    if table.num_rows < need_rows:
        table.add_row(need_rows - table.num_rows)
    # 裁剪/补齐到 3 列
    if table.num_cols > 3:
        table.delete_column(table.num_cols - 3, start_col=3)
    elif table.num_cols < 3:
        table.add_column(3 - table.num_cols)

    for c, w in enumerate(col_widths):
        table.col_width(c, w)
    # R0 空行保持紧凑，R1 表头与数据行采用自适应高度
    table.row_height(0, 12)
    table.row_height(HEADER_ROW, header_h)
    for idx, rh in enumerate(row_heights):
        r = DATA_START_ROW + idx
        table.row_height(r, rh)

    # 样式：表头 20 不加粗居中，Item 15 不加粗居中，均允许换行
    header_style = doc.add_style(
        name="header_style",
        font_size=HEADER_FONT_SIZE,
        bold=False,
        alignment=Alignment(horizontal="center", vertical="middle"),
        text_wrap=True,
        font_name="Helvetica Neue",
    )
    item_style = doc.add_style(
        name="item_style",
        font_size=ITEM_FONT_SIZE,
        bold=False,
        alignment=Alignment(horizontal="center", vertical="middle"),
        text_wrap=True,
        font_name="Helvetica Neue",
    )

    # 表头：A 列固定“Item”，B 列文件名（仅有 B 数据时），其后是累加列（New_limitsN）
    base_cols = 3 if has_b else 2
    table.write(HEADER_ROW, 0, "Item", style=header_style)
    table.write(HEADER_ROW, 1, header_a, style=header_style)
    if has_b:
        table.write(HEADER_ROW, 2, header_b, style=header_style)
    for col_index, header in enumerate(extra_headers):
        table.write(HEADER_ROW, base_cols + col_index, header, style=header_style)

    for i, name in enumerate(items):
        r = DATA_START_ROW + i
        # A 列：Item 名称（保留原始全称，不做 shortName），15pt 居中不加粗
        table.write(r, 0, name, style=item_style)

        # B 列：数据 A 图
        png_a = _decode_b64_maybe_empty(images_a[i]) if i < len(images_a) else None
        if png_a is not None:
            bg_a = doc.add_style(
                name=f"img_{r}_1",
                bg_image=BackgroundImage(png_a, f"A_{i:03d}.png"),
            )
            table.write(r, 1, "", style=bg_a)

        # C 列：数据 B 图（仅存在 B 数据时）
        if has_b:
            png_b = None
            if images_b and i < len(images_b):
                png_b = _decode_b64_maybe_empty(images_b[i])
            if png_b is not None:
                bg_b = doc.add_style(
                    name=f"img_{r}_2",
                    bg_image=BackgroundImage(png_b, f"B_{i:03d}.png"),
                )
                table.write(r, 2, "", style=bg_b)

        # 累加列：该测试项没有对应组合时保持空白
        if i < len(images_extra):
            for col_index, cell in enumerate(images_extra[i]):
                png_extra = _decode_b64_maybe_empty(cell)
                if png_extra is None:
                    continue
                bg_extra = doc.add_style(
                    name=f"img_{r}_{base_cols + col_index}",
                    bg_image=BackgroundImage(png_extra, f"L{col_index}_{i:03d}.png"),
                )
                table.write(r, base_cols + col_index, "", style=bg_extra)

    tmp = tempfile.NamedTemporaryFile(suffix=".numbers", delete=False)
    tmp_path = Path(tmp.name)
    tmp.close()
    try:
        doc.save(str(tmp_path))
    except Exception:
        os.unlink(tmp_path)
        raise

    # 文件名：基于文件 A 名（去除非法字符与控制字符），与现有 zip 导出一致
    safe_base = "".join(
        "_" if (c in r'\/:*?"<>|' or ord(c) < 32 or ord(c) == 127) else c
        for c in file_name_a
    )
    safe_base = safe_base.strip().rstrip(".")[:120] or "Item_Check"
    # 去掉扩展名
    if "." in safe_base:
        safe_base = safe_base.rsplit(".", 1)[0]
    out_name = f"{safe_base}_Item_Check.numbers"

    log_action(
        db,
        request=request,
        user=current_user,
        action="tool.cpk.item_check_report",
        target_type="tool",
        target_id="cpk-charts",
        detail={
            "item_count": len(items),
            "has_b": bool(header_b),
            "extra_columns": len(extra_headers),
        },
    )

    return _UnlinkingFileResponse(
        path=str(tmp_path),
        cleanup_path=tmp_path,
        media_type="application/vnd.apple.numbers",
        filename=out_name,
    )
