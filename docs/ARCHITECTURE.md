# QuickDesk Architecture & Internal Design

This document details the internal architecture, network signaling, peer-to-peer streaming pipeline, and desktop automation engine of **QuickDesk**.

---

## 1. High-Level System Architecture

QuickDesk connects two endpoints: a **Host** (the desktop whose screen is shared and controlled) and a **Remote User** (mobile phone, tablet, or another browser) through a lightweight **FastAPI Signaling Server**.

```mermaid
flowchart TB
    subgraph Host_Machine["🖥️ Host Machine (Desktop)"]
        HostBrowser["Host Web App (React)"]
        FastAPIServer["FastAPI Backend (Port 9000)"]
        PyAutoGUI["PyAutoGUI OS Automation Engine"]
        Display["Host Display / OS Window Server"]
    end

    subgraph Signaling["📡 Signaling & Unified Gateway"]
        REST["REST API (/api/sessions)"]
        WS_Host["WebSocket /ws/host/{session_id}"]
        WS_Remote["WebSocket /ws/remote/{connection_id}"]
        StaticMount["Static File Server (/static, index.html)"]
    end

    subgraph Remote_Device["📱 Remote Client (Mobile / Tablet / PC)"]
        RemoteBrowser["Remote Web App (React)"]
        TouchControls["Virtual Trackpad & Gestures"]
        KeyControls["Virtual / Physical Keyboard"]
    end

    %% Signaling flows
    HostBrowser -->|"1. Create Session & Get QR"| REST
    RemoteBrowser -->|"2. Scan QR / Direct Connect"| REST
    HostBrowser <-->|"3. Host WebSocket"| WS_Host
    RemoteBrowser <-->|"4. Remote WebSocket"| WS_Remote
    WS_Host <-->|"5. SDP Offer/Answer & ICE"| WS_Remote

    %% WebRTC Peer-to-Peer
    HostBrowser ==="6. P2P WebRTC Video Stream (Screen Capture)"===> RemoteBrowser

    %% Control feedback loop
    TouchControls -->|"7. remote_input (coords, clicks)"| WS_Remote
    WS_Remote -->|"8. Forward Input"| WS_Host
    WS_Host -->|"9. Execute Input Action"| PyAutoGUI
    PyAutoGUI -->|"10. OS Mouse/Key Events"| Display
    Display -.->|"11. Screen Updates Captured"| HostBrowser
```

---

## 2. Key Components

### 2.1 Host Client (`frontend/src/components/Host/HostDashboard.js`)
- **Screen Capture Initiation**: Prompts browser screen sharing permissions (`navigator.mediaDevices.getDisplayMedia`) during session creation so future remote viewers connect without requiring repeated host prompts.
- **WebSocket Signaling Listener**: Subscribes to `/ws/host/{session_id}`.
- **WebRTC Peer Manager**: Creates and maintains an `RTCPeerConnection` for each approved remote viewer, injecting the desktop's `MediaStreamTrack`.
- **Session State & Permissions**: Configures whether remote clients have mouse, keyboard, or clipboard access.

### 2.2 FastAPI Signaling & Unified Server (`backend/app/main.py`)
- **Unified Single-Port Hosting**: Serves REST APIs (`/api/*`), WebSocket connections (`/ws/*`), and the pre-built React frontend bundle (`frontend/build`) on port `9000`.
- **WebSocket Manager (`QuickDeskWebSocketManager`)**:
  - Maintains active host and remote sockets.
  - Features a **pending message queue** (`pending_remote_messages`) to prevent race conditions when the host sends WebRTC offers before the remote socket finishes handshaking.
- **LAN IP Auto-Discovery**: Probes local network interfaces using zero-packet UDP routing (`8.8.8.8:80`) to automatically bind and encode the host's LAN IP into QR codes.

### 2.3 WebRTC Peer-to-Peer Pipeline
- **Video Transport**: Direct peer-to-peer RTP/SRTP transmission of the host display stream with low latency (<50ms on LAN).
- **STUN Configuration**: Uses standard public STUN servers (Google STUN) for NAT traversal across different subnets.
- **Codec Negotiation**: Prefers VP8 / VP9 / H.264 video profiles supported across mobile WebKit (iOS Safari) and Chromium (Android Chrome).

### 2.4 Remote Client (`frontend/src/components/Remote/RemoteScanner.js`)
- **QR Code Scanner**: Integrated `html5-qrcode` library supporting both live camera scanning and file-based QR upload from photo galleries.
- **Deep Link Handler**: Directly parses `/connect?session={id}&token={token}` parameters, bypassing manual entry.
- **Coordinate Normalization**: Translates viewport / canvas / video click coordinates into normalized relative percentages `(0.0 - 1.0)` to accommodate any remote screen size or aspect ratio.
- **Mobile Trackpad & Input Controls**:
  - Drag-to-move virtual cursor.
  - Tap-to-click, two-finger right click, scroll wheels.
  - Virtual keys (Escape, Windows Key, Enter, Backspace, Arrow keys).

### 2.5 Native OS Automation Engine (`pyautogui`)
- **Normalized Coordinate Remapping**: Multiplies normalized `(x_ratio, y_ratio)` by `pyautogui.size()` to accurately target host display pixels regardless of client resolution.
- **Keyboard Translation (`JS_KEY_TO_PYAUTOGUI`)**: Maps browser `event.key` strings to native operating system key codes.
- **Permission Enforcement**: Validates that the active session permits `mouse_control` or `keyboard_control` before executing any PyAutoGUI call.

---

## 3. Session & Connection Lifecycle

```mermaid
sequenceDiagram
    autonumber
    actor Host as 🖥️ Host User
    participant HB as Host Browser
    participant SVR as FastAPI Server (Port 9000)
    participant RB as Remote Browser
    actor Remote as 📱 Remote User

    Host->>HB: Click "Create Session"
    HB->>HB: Prompt getDisplayMedia (Screen Share)
    HB->>SVR: POST /api/sessions/create (permissions, ttl)
    SVR-->>HB: session_id, token, QR Code (Base64)
    HB->>SVR: Connect WebSocket /ws/host/{session_id}

    Remote->>RB: Scan QR Code with Phone Camera
    RB->>RB: Navigate to /connect?session=...&token=...
    RB->>SVR: POST /api/sessions/{session_id}/connect
    SVR-->>HB: WS event: connection_request (auto-approved)
    SVR-->>RB: connection_id, status: approved

    RB->>SVR: Connect WebSocket /ws/remote/{connection_id}
    
    rect rgb(240, 248, 255)
        note over HB,RB: WebRTC Signaling Handshake
        HB->>SVR: WS: webrtc_signal (SDP Offer)
        SVR->>RB: WS: Forward SDP Offer
        RB->>SVR: WS: webrtc_signal (SDP Answer)
        SVR->>HB: WS: Forward SDP Answer
        HB->>SVR: WS: webrtc_signal (ICE Candidates)
        SVR->>RB: WS: Forward ICE Candidates
    end

    rect rgb(230, 255, 230)
        note over HB,RB: Direct Peer-to-Peer Stream & Control
        HB==>>RB: Direct WebRTC Video Stream (Screen MediaStream)
        Remote->>RB: Touch trackpad / Click / Keystroke
        RB->>SVR: WS: remote_input (type, coordinates, key)
        SVR->>SVR: Validate session permissions
        SVR->>SVR: pyautogui.moveTo() / click() / write()
    end

    Host->>HB: Click "Terminate Session"
    HB->>SVR: POST /api/sessions/{session_id}/terminate
    SVR-->>RB: WS event: session_ended
    HB->>HB: Close PeerConnections & Screen Tracks
    RB->>RB: Teardown Video Stream & Return to Home
```

---

## 4. Input Mapping Details

### Mouse Actions
| Action Type | Remote Payload | Backend OS Action |
| ----------- | -------------- | ----------------- |
| `move` | `{ x_ratio: 0.5, y_ratio: 0.5 }` | `pyautogui.moveTo(x, y)` |
| `click` | `{ button: 'left' \| 'right' }` | `pyautogui.click(button=...)` |
| `mousedown` | `{ button: 'left' }` | `pyautogui.mouseDown()` |
| `mouseup` | `{ button: 'left' }` | `pyautogui.mouseUp()` |
| `dblclick` | `{ button: 'left' }` | `pyautogui.doubleClick()` |
| `scroll` | `{ delta_x: 0, delta_y: -120 }` | `pyautogui.scroll(delta_y)` |

### Keyboard Keys
Browser key events are normalized via `map_js_key_to_pyautogui`:
- Special keys: `Escape` -> `esc`, `ArrowUp` -> `up`, `Meta` -> `win`, `Control` -> `ctrl`.
- Printable characters: Sent preserving case (`'A'` vs `'a'`).
- Hotkeys: Combined sequences supported.

---

## 5. Security Architecture

1. **Ephemeral Tokens**: Each session is bound to a high-entropy secret token (`secrets.token_hex(16)`) generated server-side.
2. **Session Expiry**: Sessions automatically expire and terminate after the host-configured TTL (default 5 minutes, configurable up to 60 minutes).
3. **Hardware Fail-Safe**: PyAutoGUI's `FAILSAFE = True` is active; pushing the mouse into any screen corner immediately halts automation.
4. **Zero Persisted Data**: In-memory database mode ensures no keystrokes, screenshots, or credentials ever touch the host disk.
