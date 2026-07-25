from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=128)
    password: str = Field(min_length=1, max_length=256)


class UserResponse(BaseModel):
    username: str


class ToolResponse(BaseModel):
    id: str
    name: str
    description: str
    category: str
    status: str
