from fastapi import WebSocket
from typing import Dict, Optional, List
import json
import asyncio

class WebSocketManager:
    """Manages WebSocket connections for hosts and remote users"""
    
    def __init__(self):
        self.host_connections: Dict[str, WebSocket] = {}
        self.remote_connections: Dict[str, WebSocket] = {}
        self.session_to_host: Dict[str, str] = {}
        self.connection_to_remote: Dict[str, str] = {}
    
    async def register_host(self, session_id: str, websocket: WebSocket):
        """Register host WebSocket connection"""
        self.host_connections[session_id] = websocket
        self.session_to_host[session_id] = session_id
        print(f"✅ Host connected for session: {session_id}")
    
    async def unregister_host(self, session_id: str):
        """Unregister host WebSocket connection"""
        if session_id in self.host_connections:
            del self.host_connections[session_id]
            if session_id in self.session_to_host:
                del self.session_to_host[session_id]
            print(f"❌ Host disconnected from session: {session_id}")
    
    async def register_remote(self, connection_id: str, websocket: WebSocket):
        """Register remote user WebSocket connection"""
        self.remote_connections[connection_id] = websocket
        self.connection_to_remote[connection_id] = connection_id
        print(f"✅ Remote user connected: {connection_id}")
    
    async def unregister_remote(self, connection_id: str):
        """Unregister remote user WebSocket connection"""
        if connection_id in self.remote_connections:
            del self.remote_connections[connection_id]
            if connection_id in self.connection_to_remote:
                del self.connection_to_remote[connection_id]
            print(f"❌ Remote user disconnected: {connection_id}")
    
    async def notify_host(self, session_id: str, message: dict):
        """Send notification to host"""
        if session_id in self.host_connections:
            try:
                await self.host_connections[session_id].send_text(json.dumps(message))
                return True
            except Exception as e:
                print(f"Error notifying host: {e}")
                await self.unregister_host(session_id)
        return False
    
    async def notify_remote_user(self, connection_id: str, message: dict):
        """Send notification to remote user"""
        if connection_id in self.remote_connections:
            try:
                await self.remote_connections[connection_id].send_text(json.dumps(message))
                return True
            except Exception as e:
                print(f"Error notifying remote user: {e}")
                await self.unregister_remote(connection_id)
        return False
    
    async def send_to_host(self, session_id: str, message: dict):
        """Send message to host"""
        return await self.notify_host(session_id, message)
    
    async def send_to_remote(self, connection_id: str, message: dict):
        """Send message to remote user"""
        return await self.notify_remote_user(connection_id, message)
    
    async def notify_session_end(self, session_id: str):
        """Notify all participants that session ended"""
        await self.notify_host(session_id, {
            "type": "session_ended",
            "session_id": session_id
        })
        
        for connection_id, websocket in self.remote_connections.items():
            try:
                await websocket.send_text(json.dumps({
                    "type": "session_ended",
                    "session_id": session_id
                }))
            except:
                pass
    
    async def broadcast_to_session(self, session_id: str, message: dict, exclude: list = []):
        """Broadcast message to all participants in a session"""
        await self.notify_host(session_id, message)
        
        for connection_id, websocket in self.remote_connections.items():
            if connection_id not in exclude:
                try:
                    await websocket.send_text(json.dumps(message))
                except:
                    pass