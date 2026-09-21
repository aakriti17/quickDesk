from pydantic import BaseModel
from typing import Optional

class ConnectionRequest(BaseModel):
    remote_user: Optional[str] = None
    session_token: Optional[str] = None

class ConnectionResponse(BaseModel):
    connection_id: str
    approved: bool
    reason: Optional[str] = None