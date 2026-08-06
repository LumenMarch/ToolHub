from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.core.auth import require_permission, require_tool_enabled
from app.models.user import User
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
    request: StringProcessRequest,
    current_user: User = Depends(require_permission("tool:use")),
    __: None = Depends(require_tool_enabled("string-analyzer")),
):
    """Process a string based on the requested action. Requires authentication."""
    if not request.text:
        raise HTTPException(status_code=400, detail="Text cannot be empty")

    if len(request.text.encode("utf-8")) > MAX_TEXT_LENGTH:
        raise HTTPException(status_code=400, detail="Text exceeds the 1MB length limit")

    if request.action == "encode_base64":
        return {"result": encode_base64(request.text)}
    elif request.action == "decode_base64":
        try:
            return {"result": decode_base64(request.text)}
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid Base64 string")
    elif request.action == "analyze":
        return {"result": analyze_string(request.text)}
    elif request.action == "hash_md5":
        return {"result": hash_md5(request.text)}
    elif request.action == "hash_sha1":
        return {"result": hash_sha1(request.text)}
    elif request.action == "hash_sha256":
        return {"result": hash_sha256(request.text)}
    elif request.action == "hash_sha512":
        return {"result": hash_sha512(request.text)}
    elif request.action == "url_encode":
        return {"result": url_encode(request.text)}
    elif request.action == "url_decode":
        return {"result": url_decode(request.text)}
    elif request.action == "gzip_encode":
        return {"result": gzip_encode(request.text)}
    elif request.action == "gzip_decode":
        try:
            return {"result": gzip_decode(request.text)}
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid gzip data")
    elif request.action == "deflate_encode":
        return {"result": deflate_encode(request.text)}
    elif request.action == "deflate_decode":
        try:
            return {"result": deflate_decode(request.text)}
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid deflate data")
    elif request.action == "brotli_encode":
        return {"result": brotli_encode(request.text)}
    elif request.action == "brotli_decode":
        try:
            return {"result": brotli_decode(request.text)}
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid brotli data")
    else:
        raise HTTPException(status_code=400, detail="Unknown action")
