import secrets
import hashlib
import base64
import uuid
from datetime import datetime, timedelta
from typing import Tuple

def create_session_id() -> str:
    """Create a unique session ID"""
    return f"qds_{uuid.uuid4().hex[:12]}"

def generate_token(session_id: str) -> str:
    """Generate a secure token for session (simplified)"""
    # Create a simple but secure token using session_id and timestamp
    timestamp = datetime.utcnow().isoformat()
    raw = f"{session_id}:{timestamp}:{secrets.token_hex(16)}"
    # Encode to base64 for easier handling
    token = base64.urlsafe_b64encode(raw.encode()).decode()
    return token

def verify_token(token: str) -> dict:
    """Verify and decode token (simplified)"""
    try:
        decoded = base64.urlsafe_b64decode(token.encode()).decode()
        parts = decoded.split(':')
        if len(parts) >= 2:
            return {
                "session_id": parts[0],
                "timestamp": parts[1] if len(parts) > 1 else None
            }
        raise ValueError("Invalid token format")
    except Exception:
        raise ValueError("Invalid token")

def hash_password(password: str) -> str:
    """Hash a password using SHA256 (simplified)"""
    salt = secrets.token_hex(16)
    hash_obj = hashlib.sha256()
    hash_obj.update((salt + password).encode())
    return f"{salt}:{hash_obj.hexdigest()}"

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a password against its hash (simplified)"""
    try:
        salt, hash_value = hashed_password.split(':')
        hash_obj = hashlib.sha256()
        hash_obj.update((salt + plain_password).encode())
        return hash_obj.hexdigest() == hash_value
    except Exception:
        return False

def generate_secure_key() -> str:
    """Generate a secure random key"""
    return secrets.token_urlsafe(32)

def mask_sensitive_data(data: str) -> str:
    """Mask sensitive data for logging"""
    if len(data) <= 8:
        return "***"
    return f"{data[:4]}...{data[-4:]}"