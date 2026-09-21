# QuickDesk API Reference

Comprehensive specification of all REST endpoints and WebSocket message schemas for **QuickDesk**.

---

## Base URL
```text
http://localhost:9000
http://<host-lan-ip>:9000
https://<custom-tunnel-domain>
```

---

## 1. REST API Endpoints

### 1.1 Health Check
Check backend server status and connectivity.

- **Method**: `GET`
- **Path**: `/api/health`
- **Response**: `200 OK`
```json
{
  "service": "QuickDesk API",
  "version": "1.0.0",
  "status": "running",
  "message": "QuickDesk backend is running successfully!"
}
```

---

### 1.2 Create Session
Generates a new host session with unique credentials, QR code, and permissions.

- **Method**: `POST`
- **Path**: `/api/sessions/create`
- **Request Headers**: `Content-Type: application/json`
- **Request Body**:
```json
{
  "host_id": "host_workstation_1",
  "expiry_minutes": 5,
  "session_name": "Support Session #104",
  "permissions": {
    "screen_sharing": true,
    "mouse_control": true,
    "keyboard_control": true,
    "clipboard_access": false,
    "file_transfer": false
  }
}
```
- **Response**: `200 OK`
```json
{
  "success": true,
  "session_id": "qds_9e4a8b1c2d3e",
  "token": "cWRzXzllNGE4YjFjMmQzZToyMDI2LTA5LTIxVDEw...",
  "qr_code": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg...",
  "expires_at": "2026-09-21T11:45:00.000000",
  "connection_url": "http://192.168.1.10:9000/connect?session=qds_9e4a8b1c2d3e&token=...",
  "session_name": "Support Session #104"
}
```

---

### 1.3 Connect to Session
Initiates a remote client connection to an existing session.

- **Method**: `POST`
- **Path**: `/api/sessions/{session_id}/connect`
- **Request Body**:
```json
{
  "remote_user": "Mobile Client",
  "session_token": "cWRzXzllNGE4YjFjMmQzZToyMDI2LTA5LTIxVDEw..."
}
```
- **Response**: `200 OK`
```json
{
  "success": true,
  "connection_id": "9f62a4b2-4d2c-47ea-9c76-5832049d5a10",
  "status": "approved",
  "message": "Connected"
}
```

---

### 1.4 Approve or Reject Connection
Manually change the status of an incoming connection request (used if manual approval mode is enabled).

- **Method**: `POST`
- **Path**: `/api/sessions/{session_id}/approve`
- **Query Parameters**:
  - `connection_id` (string, required): ID of the connection.
  - `approved` (boolean, required): `true` to approve, `false` to reject.
- **Response**: `200 OK`
```json
{
  "success": true,
  "connection_id": "9f62a4b2-4d2c-47ea-9c76-5832049d5a10",
  "status": "approved"
}
```

---

### 1.5 Get Session Status
Retrieve details and active participant states for a session.

- **Method**: `GET`
- **Path**: `/api/sessions/{session_id}/status`
- **Response**: `200 OK`
```json
{
  "success": true,
  "session": {
    "session_id": "qds_9e4a8b1c2d3e",
    "token": "...",
    "created_at": "2026-09-21T11:40:00.000000",
    "expires_at": "2026-09-21T11:45:00.000000",
    "status": "active",
    "host_id": "host_workstation_1",
    "permissions": {
      "screen_sharing": true,
      "mouse_control": true,
      "keyboard_control": true,
      "clipboard_access": false,
      "file_transfer": false
    },
    "session_name": "Support Session #104",
    "connections": [
      {
        "connection_id": "9f62a4b2-4d2c-47ea-9c76-5832049d5a10",
        "remote_user": "Mobile Client",
        "status": "approved",
        "requested_at": "2026-09-21T11:40:15.000000"
      }
    ]
  }
}
```

---

### 1.6 Terminate Session
Instantly closes a session and disconnects all connected remote clients.

- **Method**: `POST`
- **Path**: `/api/sessions/{session_id}/terminate`
- **Response**: `200 OK`
```json
{
  "success": true,
  "session_id": "qds_9e4a8b1c2d3e",
  "status": "terminated"
}
```

---

### 1.7 List Active Sessions
Returns all non-expired, non-terminated sessions.

- **Method**: `GET`
- **Path**: `/api/sessions/list`
- **Response**: `200 OK`
```json
{
  "success": true,
  "sessions": [
    "qds_9e4a8b1c2d3e"
  ],
  "total": 1
}
```

---

## 2. WebSocket Protocols

### 2.1 Host WebSocket
- **URL**: `ws://<host>:9000/ws/host/{session_id}`
- **Purpose**: Host signaling channel for receiving connection requests, exchanging WebRTC SDP/ICE with remotes, and executing remote OS control inputs.

### 2.2 Remote WebSocket
- **URL**: `ws://<host>:9000/ws/remote/{connection_id}`
- **Purpose**: Remote user signaling channel for sending WebRTC answers/ICE candidates and streaming input events (mouse clicks, trackpad moves, keyboard strokes).

---

## 3. WebSocket Message Schemas

### 3.1 WebRTC Signaling (`webrtc_signal`)
Used by both Host and Remote to exchange SDP offers, answers, and ICE candidates.

**Host sending Offer to Remote**:
```json
{
  "type": "webrtc_signal",
  "connection_id": "9f62a4b2-4d2c-47ea-9c76-5832049d5a10",
  "signal": {
    "type": "offer",
    "sdp": "v=0\r\no=- 461173... IN IP4 0.0.0.0\r\ns=-\r\nt=0 0\r\n..."
  }
}
```

**Remote sending Answer to Host**:
```json
{
  "type": "webrtc_signal",
  "signal": {
    "type": "answer",
    "sdp": "v=0\r\no=- 891234... IN IP4 0.0.0.0\r\ns=-\r\nt=0 0\r\n..."
  }
}
```

**Exchanging ICE Candidates**:
```json
{
  "type": "webrtc_signal",
  "signal": {
    "type": "candidate",
    "candidate": {
      "candidate": "candidate:842163049 1 udp 1677729535 192.168.1.10 54123 typ host ...",
      "sdpMid": "0",
      "sdpMLineIndex": 0
    }
  }
}
```

---

### 3.2 Remote Input Commands (`remote_input`)
Sent from Remote Client to Host for OS automation.

#### Mouse Move
```json
{
  "type": "remote_input",
  "data": {
    "type": "mouse",
    "action": "move",
    "x": 0.542,
    "y": 0.318
  }
}
```
*(x and y are normalized ratios between 0.0 and 1.0)*

#### Mouse Click
```json
{
  "type": "remote_input",
  "data": {
    "type": "mouse",
    "action": "click",
    "button": "left"
  }
}
```
*(button can be "left", "right", or "middle")*

#### Mouse Drag (Down / Up)
```json
{
  "type": "remote_input",
  "data": {
    "type": "mouse",
    "action": "mousedown",
    "button": "left"
  }
}
```

#### Mouse Scroll
```json
{
  "type": "remote_input",
  "data": {
    "type": "mouse",
    "action": "scroll",
    "delta_y": -120,
    "delta_x": 0
  }
}
```

#### Keyboard Key Press
```json
{
  "type": "remote_input",
  "data": {
    "type": "keyboard",
    "action": "keydown",
    "key": "Enter"
  }
}
```
*(Special keys supported: "Enter", "Backspace", "Escape", "Tab", "ArrowUp", "ArrowDown", "Meta", "Control", etc.)*
