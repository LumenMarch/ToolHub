from pydantic import BaseModel


class ToolResponse(BaseModel):
    id: str
    name: str
    description: str
    category: str
    status: str
