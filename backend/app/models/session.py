from pydantic import BaseModel, Field
from typing import Optional, Dict, List
from datetime import datetime
from enum import Enum

class SessionStatus(str, Enum):
    WAITING = "waiting"
    ACTIVE = "active"
    PAUSED = "paused"
    TERMINATED = "terminated"
    EXPIRED = "expired"

class PermissionModel(BaseModel):
    screen_sharing: bool = True
    mouse_control: bool = False
    keyboard_control: bool = False
    clipboard_access: bool = False
    file_transfer: bool = False

class SessionCreate(BaseModel):
    host_id: Optional[str] = None
    expiry_minutes: int = Field(default=5, ge=1, le=60)
    session_name: Optional[str] = None
    permissions: Optional[PermissionModel] = None

class SessionResponse(BaseModel):
    session_id: str
    token: str
    qr_code: str
    expires_at: str
    connection_url: str
    status: str
    session_name: str