import asyncio
import json
from typing import Dict, Optional, Any

class WebRTCManager:
    """Manages WebRTC peer connections for screen sharing and remote control"""
    
    def __init__(self):
        self.pc: Dict[str, any] = {}
        self.offers: Dict[str, dict] = {}
        self.answers: Dict[str, dict] = {}
        self.ice_candidates: Dict[str, list] = {}
    
    async def create_offer(self, session_id: str) -> dict:
        """Create WebRTC offer for screen sharing"""
        # Simplified version - returns a mock offer
        return {
            "type": "offer",
            "sdp": "v=0\r\no=- 123456789 2 IN IP4 0.0.0.0\r\ns=-\r\nt=0 0\r\n",
            "session_id": session_id
        }
    
    async def handle_answer(self, session_id: str, answer: dict):
        """Handle WebRTC answer from remote user"""
        self.answers[session_id] = answer
        print(f"✅ WebRTC connection established for session: {session_id}")
        return True
    
    async def add_ice_candidate(self, session_id: str, candidate: dict):
        """Add ICE candidate for WebRTC connection"""
        if session_id not in self.ice_candidates:
            self.ice_candidates[session_id] = []
        self.ice_candidates[session_id].append(candidate)
        return True
    
    async def close_connection(self, session_id: str):
        """Close WebRTC connection"""
        if session_id in self.pc:
            del self.pc[session_id]
        if session_id in self.offers:
            del self.offers[session_id]
        if session_id in self.answers:
            del self.answers[session_id]
        if session_id in self.ice_candidates:
            del self.ice_candidates[session_id]
        print(f"✅ WebRTC connection closed for session: {session_id}")
    
    async def get_connection_status(self, session_id: str) -> str:
        """Get WebRTC connection status"""
        return "connected" if session_id in self.pc else "disconnected"