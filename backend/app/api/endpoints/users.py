from fastapi import APIRouter, Depends
from app.core.auth import get_current_user
from app.models.user import User

# This router will contain tools that don't need backend API calls but might need user info
router = APIRouter()

@router.get("/me")
def read_users_me(current_user: User = Depends(get_current_user)):
    """Get current user information."""
    return {"id": current_user.id, "username": current_user.username}
