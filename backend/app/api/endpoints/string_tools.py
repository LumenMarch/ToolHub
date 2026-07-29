from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.core.auth import require_permission, require_tool_enabled
from app.models.user import User
from app.services.string_tools.service import (
    analyze_string,
    decode_base64,
    encode_base64,
)

router = APIRouter()


class StringProcessRequest(BaseModel):
    text: str
    action: str  # 'encode_base64', 'decode_base64', 'analyze'


@router.post("/process")
def process_string(
    request: StringProcessRequest,
    current_user: User = Depends(require_permission("tool:use")),
    __: None = Depends(require_tool_enabled("string-analyzer")),
):
    """Process a string based on the requested action. Requires authentication."""
    if not request.text:
        raise HTTPException(status_code=400, detail="Text cannot be empty")

    if request.action == "encode_base64":
        return {"result": encode_base64(request.text)}
    elif request.action == "decode_base64":
        try:
            return {"result": decode_base64(request.text)}
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid Base64 string")
    elif request.action == "analyze":
        return {"result": analyze_string(request.text)}
    else:
        raise HTTPException(status_code=400, detail="Unknown action")
