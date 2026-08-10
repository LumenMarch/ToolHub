from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api import deps
from app.core.auth import require_tool_permission
from app.models.user import User
from app.services.audit import log_action
from app.services.string_tools.service import (
    analyze_string,
    brotli_decode,
    brotli_encode,
    decode_base64,
    deflate_decode,
    deflate_encode,
    encode_base64,
    gzip_decode,
    gzip_encode,
    hash_md5,
    hash_sha1,
    hash_sha256,
    hash_sha512,
    url_decode,
    url_encode,
)

router = APIRouter()

# 输入长度上限（1MB），防止超大文本导致压缩/哈希计算消耗过多资源
MAX_TEXT_LENGTH = 1024 * 1024


class StringProcessRequest(BaseModel):
    text: str
    action: str  # 'encode_base64', 'decode_base64', 'analyze', hash/url/gzip/deflate/brotli 系列


@router.post("/process")
def process_string(
    request: Request,
    req: StringProcessRequest,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(require_tool_permission("string-analyzer")),
):
    """Process a string based on the requested action. Requires authentication."""
    if not req.text:
        raise HTTPException(status_code=400, detail="Text cannot be empty")

    if len(req.text.encode("utf-8")) > MAX_TEXT_LENGTH:
        raise HTTPException(status_code=400, detail="Text exceeds the 1MB length limit")

    if req.action == "encode_base64":
        result = encode_base64(req.text)
    elif req.action == "decode_base64":
        try:
            result = decode_base64(req.text)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid Base64 string")
    elif req.action == "analyze":
        result = analyze_string(req.text)
    elif req.action == "hash_md5":
        result = hash_md5(req.text)
    elif req.action == "hash_sha1":
        result = hash_sha1(req.text)
    elif req.action == "hash_sha256":
        result = hash_sha256(req.text)
    elif req.action == "hash_sha512":
        result = hash_sha512(req.text)
    elif req.action == "url_encode":
        result = url_encode(req.text)
    elif req.action == "url_decode":
        result = url_decode(req.text)
    elif req.action == "gzip_encode":
        result = gzip_encode(req.text)
    elif req.action == "gzip_decode":
        try:
            result = gzip_decode(req.text)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid gzip data")
    elif req.action == "deflate_encode":
        result = deflate_encode(req.text)
    elif req.action == "deflate_decode":
        try:
            result = deflate_decode(req.text)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid deflate data")
    elif req.action == "brotli_encode":
        result = brotli_encode(req.text)
    elif req.action == "brotli_decode":
        try:
            result = brotli_decode(req.text)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid brotli data")
    else:
        raise HTTPException(status_code=400, detail="Unknown action")

    log_action(
        db,
        request=request,
        user=current_user,
        action="tool.string.analyze",
        target_type="tool",
        target_id="string-analyzer",
        # 摘要记录输入规模，不落全量文本（可能含敏感内容）
        detail={"action": req.action, "text_length": len(req.text)},
    )
    return {"result": result}
