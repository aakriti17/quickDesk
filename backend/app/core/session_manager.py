import asyncio
import json
from datetime import datetime, timedelta
from typing import Dict, Optional, List, Any

class SessionManager:
    """Manages session lifecycle, storage, and state"""
    
    def __init__(self):
        self.sessions: Dict[str, Dict] = {}
        self.connection_requests: Dict[str, Dict] = {}
    
    async def create_session(self, session_data: Dict) -> bool:
        """Create a new session"""
        session_id = session_data["session_id"]
        self.sessions[session_id] = session_data
        return True
    
    async def get_session(self, session_id: str) -> Optional[Dict]:
        """Get session by ID"""
        if session_id in self.sessions:
            session = self.sessions[session_id]
            # Check if expired
            expires_at = datetime.fromisoformat(session["expires_at"])
            if expires_at < datetime.utcnow():
                await self.terminate_session(session_id)
                return None
            return session
        return None
    
    async def update_session_status(self, session_id: str, status: str):
        """Update session status"""
        session = await self.get_session(session_id)
        if session:
            session["status"] = status
            self.sessions[session_id] = session
    
    async def terminate_session(self, session_id: str):
        """Terminate a session"""
        if session_id in self.sessions:
            self.sessions[session_id]["status"] = "terminated"
    
    async def pause_session(self, session_id: str):
        """Pause a session"""
        await self.update_session_status(session_id, "paused")
    
    async def resume_session(self, session_id: str):
        """Resume a paused session"""
        await self.update_session_status(session_id, "active")
    
    async def add_connection_request(self, connection_data: Dict):
        """Add a connection request"""
        connection_id = connection_data["connection_id"]
        self.connection_requests[connection_id] = connection_data
    
    async def update_connection_status(self, connection_id: str, status: str):
        """Update connection request status"""
        if connection_id in self.connection_requests:
            self.connection_requests[connection_id]["status"] = status
    
    async def cleanup_expired_sessions(self):
        """Clean up expired sessions"""
        current_time = datetime.utcnow()
        expired = []
        
        for session_id, session in self.sessions.items():
            if session["status"] != "terminated":
                expires_at = datetime.fromisoformat(session["expires_at"])
                if expires_at < current_time:
                    expired.append(session_id)
        
        for session_id in expired:
            await self.terminate_session(session_id)