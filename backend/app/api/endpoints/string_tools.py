import base64

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.core.auth import require_permission, require_tool_enabled
from app.models.user import User

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
        encoded_bytes = base64.b64encode(request.text.encode("utf-8"))
        return {"result": encoded_bytes.decode("utf-8")}

    elif request.action == "decode_base64":
        try:
            decoded_bytes = base64.b64decode(request.text.encode("utf-8"))
            return {"result": decoded_bytes.decode("utf-8")}
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid Base64 string")

    elif request.action == "analyze":
        return {
            "result": {
                "length": len(request.text),
                "words": len(request.text.split()),
                "lines": len(request.text.splitlines()),
            }
        }
    else:
        raise HTTPException(status_code=400, detail="Unknown action")
