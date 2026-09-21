import sys
import httpx
import asyncio
import json

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

async def test_quickdesk():
    """Test QuickDesk API endpoints"""
    base_url = "http://localhost:9000"
    
    async with httpx.AsyncClient() as client:
        # 1. Test health endpoint
        response = await client.get(f"{base_url}/api/health")
        print(f"Health check: {response.json()}")
        
        # 2. Create a session
        session_data = {
            "host_id": "test_host_001",
            "expiry_minutes": 5,
            "session_name": "Test Support Session",
            "permissions": {
                "screen_sharing": True,
                "mouse_control": True,
                "keyboard_control": True,
                "clipboard_access": True,
                "file_transfer": False
            }
        }
        
        response = await client.post(
            f"{base_url}/api/sessions/create",
            json=session_data
        )
        
        if response.status_code == 200:
            data = response.json()
            print(f"\n✅ Session Created:")
            print(f"Session ID: {data['session_id']}")
            print(f"Token: {data['token'][:20]}...")
            print(f"Expires: {data['expires_at']}")
            print(f"QR Code: {data['qr_code'][:50]}...")
            
            session_id = data['session_id']
            
            # 3. Test session status
            response = await client.get(
                f"{base_url}/api/sessions/{session_id}/status"
            )
            print(f"\nSession Status: {response.json()}")
            
            # 4. Test connection request (simulated)
            connection_data = {
                "remote_user": "test_remote_user",
                "session_token": data['token']
            }
            
            response = await client.post(
                f"{base_url}/api/sessions/{session_id}/connect",
                json=connection_data
            )
            print(f"\nConnection Request: {response.json()}")
            
        else:
            print(f"Error: {response.status_code} - {response.text}")

if __name__ == "__main__":
    asyncio.run(test_quickdesk())