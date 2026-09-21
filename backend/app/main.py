import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager

from pathlib import Path

import json
import os
import socket
import uuid
import pyautogui

from datetime import datetime, timedelta
from typing import Dict, Optional

import qrcode
from io import BytesIO
import base64

from app.models.session import SessionCreate
from app.models.connection import ConnectionRequest
from app.utils.security import generate_token, create_session_id


# ============================================================
# KEYBOARD KEY MAPPING
# Browser (event.key) -> PyAutoGUI key names.
# Anything not listed here just falls back to key.lower(),
# which already covers plain letters/digits/punctuation since
# the browser already applies Shift for us (e.g. Shift+3 -> "#").
# ============================================================

JS_KEY_TO_PYAUTOGUI = {
    "escape": "esc",
    "arrowup": "up",
    "arrowdown": "down",
    "arrowleft": "left",
    "arrowright": "right",
    "control": "ctrl",
    "meta": "win",
    "contextmenu": "apps",
    "pageup": "pageup",
    "pagedown": "pagedown",
    " ": "space",
}


def map_js_key_to_pyautogui(js_key: str):
    """
    Convert a JS KeyboardEvent.key value into a name
    PyAutoGUI understands. Returns None if we can't
    confidently map it (better to drop the key than
    send garbage to pyautogui and crash the handler).
    """

    if js_key is None:
        return None

    lowered = js_key.lower()

    if lowered in JS_KEY_TO_PYAUTOGUI:
        return JS_KEY_TO_PYAUTOGUI[lowered]

    # Single printable character (letters, digits, punctuation) -
    # check this BEFORE the generic pyautogui.KEYBOARD_KEYS
    # lookup below, and return it EXACTLY as received. pyautogui
    # accepts exact-case letters directly ('A' vs 'a' are both
    # valid, distinct keys to it) - lowercasing here was silently
    # turning every Shift+letter into a lowercase letter.
    if len(js_key) == 1:
        return js_key

    if lowered in pyautogui.KEYBOARD_KEYS:
        return lowered

    return None


# ============================================================
# AUTO-DETECT HOST LAN IP
# So the QR code always points to an address reachable from
# other devices on the network, without anyone typing an IP.
# ============================================================

def get_local_ip() -> str:
    """
    Finds this machine's LAN IP (e.g. 192.168.x.x) the reliable
    way: open a UDP "connection" to a public address (no data is
    actually sent) and read back which local interface/IP the OS
    picked to reach it. Falls back to 127.0.0.1 if that fails
    (e.g. no network at all).
    """

    sock = socket.socket(
        socket.AF_INET,
        socket.SOCK_DGRAM
    )

    try:

        sock.connect(("8.8.8.8", 80))

        return sock.getsockname()[0]

    except Exception:

        return "127.0.0.1"

    finally:

        sock.close()


LOCAL_IP = get_local_ip()

# The FastAPI backend now also serves the built React frontend
# (see the static-file mount near the bottom of this file), so
# there is only ONE port/URL for everything - important because
# ngrok's free plan only allows one tunnel/static domain at a
# time. Normal LAN mode: QR links to http://<lan-ip>:9000
# (auto-detected above). ngrok / cloud mode: set PUBLIC_APP_URL
# to the single public URL instead, e.g.:
#   PUBLIC_APP_URL=https://your-app.ngrok-free.dev
PUBLIC_APP_URL = os.environ.get(
    "PUBLIC_APP_URL",
    f"http://{LOCAL_IP}:9000"
)


# ============================================================
# APPLICATION
# ============================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    print("🚀 QuickDesk Backend Starting...")
    yield
    print("👋 QuickDesk Backend Shutting Down...")


app = FastAPI(
    title="QuickDesk API",
    description="Secure Remote Support Platform",
    version="1.0.0",
    lifespan=lifespan
)


# ============================================================
# CORS
# ============================================================

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================
# IN-MEMORY DATABASE
# ============================================================

sessions_db: Dict[str, dict] = {}

connection_requests_db: Dict[str, dict] = {}


# ============================================================
# WEBSOCKET CONNECTION MANAGER
# ============================================================

class QuickDeskWebSocketManager:

    def __init__(self):
        self.host_connections: Dict[str, WebSocket] = {}
        self.remote_connections: Dict[str, WebSocket] = {}

        # Messages meant for a remote connection_id whose
        # WebSocket hasn't registered yet - flushed as soon as
        # it does. Needed now that the host can send its WebRTC
        # offer almost instantly after auto-approval, which can
        # otherwise race ahead of the remote's own socket setup.
        self.pending_remote_messages: Dict[str, list] = {}

    # --------------------------------------------------------
    # HOST
    # --------------------------------------------------------

    async def register_host(
        self,
        session_id: str,
        websocket: WebSocket
    ):
        self.host_connections[session_id] = websocket

        print(
            f"🟢 Host WebSocket registered: {session_id}"
        )

    async def unregister_host(
        self,
        session_id: str
    ):
        self.host_connections.pop(
            session_id,
            None
        )

        print(
            f"🔴 Host WebSocket removed: {session_id}"
        )

    # --------------------------------------------------------
    # REMOTE
    # --------------------------------------------------------

    async def register_remote(
        self,
        connection_id: str,
        websocket: WebSocket
    ):
        self.remote_connections[connection_id] = websocket

        print(
            f"🟢 Remote WebSocket registered: "
            f"{connection_id}"
        )

        # Deliver anything that arrived before this socket was
        # ready (e.g. the host's WebRTC offer, sent immediately
        # after auto-approval).
        queued = self.pending_remote_messages.pop(
            connection_id,
            []
        )

        for message in queued:

            try:

                await websocket.send_text(
                    json.dumps(message)
                )

            except Exception as e:

                print(
                    f"❌ Error flushing queued message to "
                    f"remote {connection_id}: {e}"
                )

    async def unregister_remote(
        self,
        connection_id: str
    ):
        self.remote_connections.pop(
            connection_id,
            None
        )

        self.pending_remote_messages.pop(
            connection_id,
            None
        )

        print(
            f"🔴 Remote WebSocket removed: "
            f"{connection_id}"
        )

    # --------------------------------------------------------
    # SEND TO HOST
    # --------------------------------------------------------

    async def send_to_host(
        self,
        session_id: str,
        message: dict
    ) -> bool:

        websocket = self.host_connections.get(
            session_id
        )

        if not websocket:

            print(
                f"⚠️ Host WebSocket not found: "
                f"{session_id}"
            )

            return False

        try:

            await websocket.send_text(
                json.dumps(message)
            )

            return True

        except Exception as e:

            print(
                f"❌ Error sending to host: {e}"
            )

            return False

    # --------------------------------------------------------
    # SEND TO REMOTE
    # --------------------------------------------------------

    async def send_to_remote(
        self,
        connection_id: str,
        message: dict
    ) -> bool:

        websocket = self.remote_connections.get(
            connection_id
        )

        if not websocket:

            print(
                f"⏳ Remote WebSocket not ready yet, queueing "
                f"message for: {connection_id}"
            )

            self.pending_remote_messages.setdefault(
                connection_id,
                []
            ).append(
                message
            )

            return False

        try:

            await websocket.send_text(
                json.dumps(message)
            )

            return True

        except Exception as e:

            print(
                f"❌ Error sending to remote: {e}"
            )

            return False


websocket_manager = QuickDeskWebSocketManager()


# ============================================================
# ROOT
# ============================================================

@app.get("/api/health")
async def root():

    return {
        "service": "QuickDesk API",
        "version": "1.0.0",
        "status": "running",
        "message": "QuickDesk backend is running successfully!"
    }


# ============================================================
# CREATE SESSION
# ============================================================

@app.post("/api/sessions/create")
async def create_session(
    request: SessionCreate
):

    try:

        session_id = create_session_id()

        token = generate_token(
            session_id
        )

        expiry_minutes = (
            request.expiry_minutes
            or 5
        )

        session_data = {

            "session_id":
                session_id,

            "token":
                token,

            "created_at":
                datetime.utcnow().isoformat(),

            "expires_at":
                (
                    datetime.utcnow()
                    + timedelta(
                        minutes=expiry_minutes
                    )
                ).isoformat(),

            "status":
                "waiting",

            "host_id":
                request.host_id
                or "unknown",

            "permissions":
                (
                    request.permissions.dict()
                    if request.permissions
                    else {
                        "screen_sharing": True,
                        "mouse_control": False,
                        "keyboard_control": False,
                        "clipboard_access": False,
                        "file_transfer": False
                    }
                ),

            "session_name":
                request.session_name
                or f"Session-{session_id[:8]}",

            "connections":
                []
        }

        sessions_db[
            session_id
        ] = session_data

        # ----------------------------------------------------
        # QR CODE
        # A real, directly-openable URL - host IP and port are
        # filled in automatically (see get_local_ip() above), so
        # scanning it with ANY camera app just opens the connect
        # page. No one has to type an IP address anywhere.
        # ----------------------------------------------------

        connect_url = (
            f"{PUBLIC_APP_URL}"
            f"/connect?session={session_id}&token={token}"
        )

        qr_image = qrcode.make(
            connect_url
        )

        buffered = BytesIO()

        qr_image.save(
            buffered,
            format="PNG"
        )

        qr_base64 = base64.b64encode(
            buffered.getvalue()
        ).decode()

        return JSONResponse({

            "success":
                True,

            "session_id":
                session_id,

            "token":
                token,

            "qr_code":
                f"data:image/png;base64,{qr_base64}",

            "expires_at":
                session_data["expires_at"],

            "connection_url":
                connect_url,

            "session_name":
                session_data["session_name"]

        })

    except Exception as e:

        raise HTTPException(
            status_code=500,
            detail=str(e)
        )


# ============================================================
# CONNECT TO SESSION
# ============================================================

@app.post(
    "/api/sessions/{session_id}/connect"
)
async def connect_to_session(
    session_id: str,
    request: ConnectionRequest
):

    try:

        if session_id not in sessions_db:

            raise HTTPException(
                status_code=404,
                detail="Session not found"
            )

        session = sessions_db[
            session_id
        ]

        # ----------------------------------------------------
        # CHECK EXPIRATION
        # ----------------------------------------------------

        expires_at = datetime.fromisoformat(
            session["expires_at"]
        )

        if expires_at < datetime.utcnow():

            session["status"] = "expired"

            raise HTTPException(
                status_code=400,
                detail="Session has expired"
            )

        # ----------------------------------------------------
        # ONLY WAITING / ACTIVE SESSION
        # ----------------------------------------------------

        if session["status"] not in [
            "waiting",
            "active"
        ]:

            raise HTTPException(
                status_code=400,
                detail="Session not available"
            )

        # ----------------------------------------------------
        # CREATE CONNECTION
        # ----------------------------------------------------

        connection_id = str(
            uuid.uuid4()
        )

        connection_data = {

            "connection_id":
                connection_id,

            "session_id":
                session_id,

            "remote_user":
                request.remote_user
                or "anonymous",

            "requested_at":
                datetime.utcnow().isoformat(),

            # Auto-approved: no host confirmation step. The
            # scanning device connects and gets access
            # immediately, matching a "scan and go" flow.
            "status":
                "approved"

        }

        connection_requests_db[
            connection_id
        ] = connection_data

        session[
            "connections"
        ].append(
            connection_data
        )

        # ----------------------------------------------------
        # NOTIFY HOST
        # ----------------------------------------------------

        await websocket_manager.send_to_host(

            session_id,

            {
                "type":
                    "connection_request",

                "data":
                    connection_data
            }

        )

        return JSONResponse({

            "success":
                True,

            "connection_id":
                connection_id,

            "status":
                "approved",

            "message":
                "Connected"

        })

    except HTTPException:

        raise

    except Exception as e:

        raise HTTPException(
            status_code=500,
            detail=str(e)
        )


# ============================================================
# APPROVE / REJECT CONNECTION
# ============================================================

@app.post(
    "/api/sessions/{session_id}/approve"
)
async def approve_connection(
    session_id: str,
    approved: bool = True,
    connection_id: Optional[str] = None
):

    try:

        if session_id not in sessions_db:

            raise HTTPException(
                status_code=404,
                detail="Session not found"
            )

        session = sessions_db[
            session_id
        ]

        # ----------------------------------------------------
        # FIND PENDING CONNECTION
        # ----------------------------------------------------

        if not connection_id:

            pending_connections = [

                c

                for c in session.get(
                    "connections",
                    []
                )

                if c.get("status")
                == "pending"

            ]

            if not pending_connections:

                raise HTTPException(
                    status_code=400,
                    detail=
                        "No pending connection requests"
                )

            connection_id = (
                pending_connections[0]
                ["connection_id"]
            )

        # ----------------------------------------------------
        # CHECK CONNECTION
        # ----------------------------------------------------

        if connection_id not in connection_requests_db:

            raise HTTPException(
                status_code=404,
                detail=
                    "Connection request not found"
            )

        connection = (
            connection_requests_db[
                connection_id
            ]
        )

        # ----------------------------------------------------
        # APPROVE
        # ----------------------------------------------------

        if approved:

            session["status"] = "active"

            connection["status"] = "approved"

            connection[
                "approved_at"
            ] = datetime.utcnow().isoformat()

            for conn in session.get(
                "connections",
                []
            ):

                if (
                    conn["connection_id"]
                    == connection_id
                ):

                    conn["status"] = "approved"

                    conn[
                        "approved_at"
                    ] = connection[
                        "approved_at"
                    ]

                    break

            # ------------------------------------------------
            # NOTIFY REMOTE
            # ------------------------------------------------

            await websocket_manager.send_to_remote(

                connection_id,

                {
                    "type":
                        "connection_approved",

                    "session_id":
                        session_id,

                    "connection_id":
                        connection_id,

                    "permissions":
                        session[
                            "permissions"
                        ],

                    "message":
                        "Connection approved by host"
                }

            )

            return JSONResponse({

                "success":
                    True,

                "status":
                    "approved",

                "connection_id":
                    connection_id,

                "message":
                    "Connection approved",

                "permissions":
                    session[
                        "permissions"
                    ]

            })

        # ----------------------------------------------------
        # REJECT
        # ----------------------------------------------------

        connection["status"] = "rejected"

        for conn in session.get(
            "connections",
            []
        ):

            if (
                conn["connection_id"]
                == connection_id
            ):

                conn["status"] = "rejected"

                break

        # ----------------------------------------------------
        # NOTIFY REMOTE
        # ----------------------------------------------------

        await websocket_manager.send_to_remote(

            connection_id,

            {
                "type":
                    "connection_rejected",

                "session_id":
                    session_id,

                "connection_id":
                    connection_id,

                "message":
                    "Connection rejected by host"
            }

        )

        return JSONResponse({

            "success":
                True,

            "status":
                "rejected",

            "connection_id":
                connection_id,

            "message":
                "Connection rejected"

        })

    except HTTPException:

        raise

    except Exception as e:

        raise HTTPException(
            status_code=500,
            detail=str(e)
        )


# ============================================================
# TERMINATE SESSION
# ============================================================

@app.post(
    "/api/sessions/{session_id}/terminate"
)
async def terminate_session(
    session_id: str
):

    try:

        if session_id not in sessions_db:

            raise HTTPException(
                status_code=404,
                detail="Session not found"
            )

        sessions_db[
            session_id
        ]["status"] = "terminated"

        # ----------------------------------------------------
        # NOTIFY HOST
        # ----------------------------------------------------

        await websocket_manager.send_to_host(

            session_id,

            {
                "type":
                    "session_terminated",

                "session_id":
                    session_id
            }

        )

        # ----------------------------------------------------
        # NOTIFY ALL REMOTES
        # ----------------------------------------------------

        session = sessions_db[
            session_id
        ]

        for connection in session.get(
            "connections",
            []
        ):

            connection_id = (
                connection[
                    "connection_id"
                ]
            )

            await websocket_manager.send_to_remote(

                connection_id,

                {
                    "type":
                        "session_terminated",

                    "session_id":
                        session_id
                }

            )

        return JSONResponse({

            "success":
                True,

            "message":
                "Session terminated"

        })

    except HTTPException:

        raise

    except Exception as e:

        raise HTTPException(
            status_code=500,
            detail=str(e)
        )


# ============================================================
# SESSION STATUS
# ============================================================

@app.get(
    "/api/sessions/{session_id}/status"
)
async def get_session_status(
    session_id: str
):

    try:

        if session_id not in sessions_db:

            raise HTTPException(
                status_code=404,
                detail="Session not found"
            )

        session = sessions_db[
            session_id
        ]

        # ----------------------------------------------------
        # CHECK EXPIRATION
        # ----------------------------------------------------

        expires_at = datetime.fromisoformat(
            session["expires_at"]
        )

        if (
            expires_at
            < datetime.utcnow()
            and session["status"]
            not in [
                "terminated",
                "expired"
            ]
        ):

            session["status"] = "expired"

        return JSONResponse({

            "success":
                True,

            "session":
                session

        })

    except HTTPException:

        raise

    except Exception as e:

        raise HTTPException(
            status_code=500,
            detail=str(e)
        )


# ============================================================
# LIST SESSIONS
# ============================================================

@app.get(
    "/api/sessions/list"
)
async def list_sessions():

    active_sessions = [

        session_id

        for session_id, session
        in sessions_db.items()

        if session.get("status")
        not in [
            "terminated",
            "expired"
        ]

    ]

    return JSONResponse({

        "success":
            True,

        "sessions":
            active_sessions,

        "total":
            len(active_sessions)

    })


# ============================================================
# WEB SOCKET — HOST
# ============================================================

@app.websocket(
    "/ws/host/{session_id}"
)
async def websocket_host_endpoint(
    websocket: WebSocket,
    session_id: str
):

    await websocket.accept()

    # --------------------------------------------------------
    # SESSION CHECK
    # --------------------------------------------------------

    if session_id not in sessions_db:

        await websocket.send_text(
            json.dumps({

                "type":
                    "error",

                "message":
                    "Session not found"

            })
        )

        await websocket.close()

        return

    await websocket_manager.register_host(
        session_id,
        websocket
    )

    try:

        while True:

            raw_data = (
                await websocket.receive_text()
            )

            try:

                message = json.loads(
                    raw_data
                )

            except json.JSONDecodeError:

                await websocket.send_text(
                    json.dumps({

                        "type":
                            "error",

                        "message":
                            "Invalid JSON"

                    })
                )

                continue

            message_type = (
                message.get("type")
            )

            # =================================================
            # WEBRTC SIGNAL
            # =================================================

            if message_type == "webrtc_signal":

                connection_id = (
                    message.get(
                        "connection_id"
                    )
                )

                signal_data = (
                    message.get(
                        "data"
                    )
                )

                if not connection_id:
                    continue

                await websocket_manager.send_to_remote(

                    connection_id,

                    {
                        "type":
                            "webrtc_signal",

                        "session_id":
                            session_id,

                        "connection_id":
                            connection_id,

                        "data":
                            signal_data
                    }

                )

            # =================================================
            # SCREEN SHARE STARTED
            # =================================================

            elif (
                message_type
                == "screen_share_started"
            ):

                connection_id = (
                    message.get(
                        "connection_id"
                    )
                )

                if connection_id:

                    await websocket_manager.send_to_remote(

                        connection_id,

                        {
                            "type":
                                "screen_share_started",

                            "session_id":
                                session_id,

                            "connection_id":
                                connection_id
                        }

                    )

            # =================================================
            # SCREEN SHARE STOPPED
            # =================================================

            elif (
                message_type
                == "screen_share_stopped"
            ):

                connection_id = (
                    message.get(
                        "connection_id"
                    )
                )

                if connection_id:

                    await websocket_manager.send_to_remote(

                        connection_id,

                        {
                            "type":
                                "screen_share_stopped",

                            "session_id":
                                session_id,

                            "connection_id":
                                connection_id
                        }

                    )

            # =================================================
            # REMOTE INPUT
            # MOUSE MOVE / CLICK / SCROLL
            # =================================================

            elif message_type == "remote_input":

                connection_id = message.get(
                    "connection_id"
                )

                input_data = message.get(
                    "data"
                )

                # ------------------------------------------------
                # BASIC VALIDATION
                # ------------------------------------------------

                if not connection_id:
                    continue

                if not input_data:
                    continue

                # ------------------------------------------------
                # CHECK CONNECTION
                # ------------------------------------------------

                connection = (
                    connection_requests_db.get(
                        connection_id
                    )
                )

                if not connection:

                    print(
                        "⚠️ Connection not found:",
                        connection_id
                    )

                    continue

                # ------------------------------------------------
                # ONLY APPROVED CONNECTION
                # ------------------------------------------------

                if connection.get(
                    "status"
                ) != "approved":

                    print(
                        "⚠️ Remote input rejected: "
                        "connection not approved"
                    )

                    continue

                # ------------------------------------------------
                # CHECK SESSION
                # ------------------------------------------------

                session = sessions_db.get(
                    session_id
                )

                if not session:
                    continue

                # ------------------------------------------------
                # CHECK MOUSE PERMISSION
                # ------------------------------------------------

                permissions = session.get(
                    "permissions",
                    {}
                )

                if not permissions.get(
                    "mouse_control",
                    False
                ):

                    print(
                        "⚠️ Mouse control permission "
                        "is disabled"
                    )

                    continue

                # ------------------------------------------------
                # ONLY MOUSE DEVICE
                # ------------------------------------------------

                if input_data.get(
                    "device"
                ) != "mouse":

                    continue

                action = input_data.get(
                    "action"
                )

                # =================================================
                # MOUSE MOVE
                # =================================================

                if action == "move":

                    x = input_data.get(
                        "x"
                    )

                    y = input_data.get(
                        "y"
                    )

                    if x is None or y is None:
                        continue

                    try:

                        x = float(x)
                        y = float(y)

                        x = max(
                            0.0,
                            min(1.0, x)
                        )

                        y = max(
                            0.0,
                            min(1.0, y)
                        )

                        screen_width, screen_height = (
                            pyautogui.size()
                        )

                        screen_x = int(
                            x * (screen_width - 1)
                        )

                        screen_y = int(
                            y * (screen_height - 1)
                        )

                        pyautogui.moveTo(
                            screen_x,
                            screen_y,
                            duration=0
                        )

                        print(
                            f"🖱️ Mouse moved: "
                            f"{screen_x}, {screen_y}"
                        )

                    except Exception as e:

                        print(
                            f"❌ Mouse move error: {e}"
                        )

                # =================================================
                # MOUSE CLICK
                # =================================================

                elif action == "click":

                    button = input_data.get(
                        "button",
                        "left"
                    )

                    if button not in [
                        "left",
                        "middle",
                        "right"
                    ]:

                        print(
                            "⚠️ Invalid mouse button:",
                            button
                        )

                        continue

                    try:

                        # -----------------------------------------
                        # GET CLICK COORDINATES
                        # -----------------------------------------

                        x = input_data.get("x")
                        y = input_data.get("y")

                        if x is not None and y is not None:

                            x = float(x)
                            y = float(y)

                            # Keep coordinates between 0 and 1
                            x = max(
                                0.0,
                                min(1.0, x)
                            )

                            y = max(
                                0.0,
                                min(1.0, y)
                            )

                            # -------------------------------------
                            # GET HOST SCREEN SIZE
                            # -------------------------------------

                            screen_width, screen_height = (
                                pyautogui.size()
                            )

                            # -------------------------------------
                            # CONVERT NORMALIZED COORDINATES
                            # -------------------------------------

                            screen_x = int(
                                x * (screen_width - 1)
                            )

                            screen_y = int(
                                y * (screen_height - 1)
                            )

                            print(
                                f"🖱️ Click position: "
                                f"{screen_x}, {screen_y}"
                            )

                            # -------------------------------------
                            # MOVE TO CLICK POSITION
                            # -------------------------------------

                            pyautogui.moveTo(
                                screen_x,
                                screen_y,
                                duration=0
                            )

                        # -----------------------------------------
                        # PERFORM CLICK
                        # -----------------------------------------

                        pyautogui.click(
                            button=button
                        )

                        print(
                            f"🖱️ Mouse {button} click"
                        )

                    except Exception as e:

                        print(
                            f"❌ Mouse click error: {e}"
                        )

                # =================================================
                # MOUSE SCROLL
                # =================================================

                elif action == "scroll":

                    try:

                        delta_y = float(
                            input_data.get(
                                "deltaY",
                                0
                            )
                        )

                        delta_x = float(
                            input_data.get(
                                "deltaX",
                                0
                            )
                        )

                        # Convert browser wheel movement
                        # into PyAutoGUI units.
                        scroll_y = int(
                            -delta_y / 100
                        )

                        scroll_x = int(
                            -delta_x / 100
                        )

                        # Make very small wheel
                        # movements still register.
                        if (
                            scroll_y == 0
                            and delta_y != 0
                        ):

                            scroll_y = (
                                -1
                                if delta_y > 0
                                else 1
                            )

                        if (
                            scroll_x == 0
                            and delta_x != 0
                        ):

                            scroll_x = (
                                -1
                                if delta_x > 0
                                else 1
                            )

                        if scroll_y != 0:

                            pyautogui.scroll(
                                scroll_y
                            )

                        if scroll_x != 0:

                            pyautogui.hscroll(
                                scroll_x
                            )

                        print(
                            f"🖱️ Mouse scroll: "
                            f"X={scroll_x}, "
                            f"Y={scroll_y}"
                        )

                    except Exception as e:

                        print(
                            f"❌ Mouse scroll error: "
                            f"{e}"
                        )

                # =================================================
                # UNKNOWN ACTION
                # =================================================

                else:

                    print(
                        f"⚠️ Unsupported mouse action: "
                        f"{action}"
                    )

            # =================================================
            # SESSION CONTROL
            # =================================================

            elif (
                message_type
                == "session_control"
            ):

                action = (
                    message.get(
                        "action"
                    )
                )

                if action == "pause":

                    sessions_db[
                        session_id
                    ]["status"] = "paused"

                    await websocket.send_text(
                        json.dumps({

                            "type":
                                "session_paused",

                            "session_id":
                                session_id

                        })
                    )

                elif action == "resume":

                    sessions_db[
                        session_id
                    ]["status"] = "active"

                    await websocket.send_text(
                        json.dumps({

                            "type":
                                "session_resumed",

                            "session_id":
                                session_id

                        })
                    )

                elif action == "terminate":

                    await terminate_session(
                        session_id
                    )

                    break

    except WebSocketDisconnect:

        print(
            f"❌ Host disconnected: "
            f"{session_id}"
        )

    except Exception as e:

        print(
            f"❌ Host WebSocket error: {e}"
        )

    finally:

        await websocket_manager.unregister_host(
            session_id
        )


# ============================================================
# WEB SOCKET — REMOTE
# ============================================================

@app.websocket(
    "/ws/remote/{connection_id}"
)
async def websocket_remote_endpoint(
    websocket: WebSocket,
    connection_id: str
):

    await websocket.accept()

    # --------------------------------------------------------
    # CONNECTION CHECK
    # --------------------------------------------------------

    if connection_id not in connection_requests_db:

        await websocket.send_text(
            json.dumps({

                "type":
                    "error",

                "message":
                    "Connection not found"

            })
        )

        await websocket.close()

        return

    await websocket_manager.register_remote(
        connection_id,
        websocket
    )

    connection = (
        connection_requests_db[
            connection_id
        ]
    )

    session_id = (
        connection[
            "session_id"
        ]
    )

    try:

        # ----------------------------------------------------
        # SEND CURRENT CONNECTION STATUS
        # ----------------------------------------------------

        await websocket.send_text(
            json.dumps({

                "type":
                    "connection_status",

                "status":
                    connection[
                        "status"
                    ],

                "connection_id":
                    connection_id,

                "session_id":
                    session_id

            })
        )

        while True:

            raw_data = (
                await websocket.receive_text()
            )

            try:

                message = json.loads(
                    raw_data
                )

            except json.JSONDecodeError:

                continue

            message_type = (
                message.get("type")
            )

            # =================================================
            # WEBRTC SIGNAL
            # =================================================

            if message_type == "webrtc_signal":

                signal_data = (
                    message.get(
                        "data"
                    )
                )

                await websocket_manager.send_to_host(

                    session_id,

                    {
                        "type":
                            "webrtc_signal",

                        "session_id":
                            session_id,

                        "connection_id":
                            connection_id,

                        "data":
                            signal_data
                    }

                )

            # =================================================
            # SCREEN SHARE REQUEST
            # =================================================

            elif (
                message_type
                == "start_screen_share"
            ):

                await websocket_manager.send_to_host(

                    session_id,

                    {
                        "type":
                            "screen_share_request",

                        "session_id":
                            session_id,

                        "connection_id":
                            connection_id
                    }

                )

            # =================================================
            # SCREEN SHARE STOP
            # =================================================

            elif (
                message_type
                == "stop_screen_share"
            ):

                await websocket_manager.send_to_host(

                    session_id,

                    {
                        "type":
                            "stop_screen_share",

                        "session_id":
                            session_id,

                        "connection_id":
                            connection_id
                    }

                )

            # =================================================
            # REMOTE INPUT
            # EXECUTED DIRECTLY ON HOST MACHINE VIA PYAUTOGUI
            # (backend process runs on the host PC, so it can
            # drive the real mouse itself - no need to bounce
            # this through the host browser tab, which never
            # had a handler for it anyway)
            # =================================================

            elif (
                message_type
                == "remote_input"
            ):

                input_data = message.get(
                    "data"
                )

                if not input_data:
                    continue

                # ------------------------------------------------
                # ONLY APPROVED CONNECTION
                # (re-read from the DB - the "connection" var
                # captured at socket-open time is stale once the
                # host approves the request later on)
                # ------------------------------------------------

                current_connection = (
                    connection_requests_db.get(
                        connection_id
                    )
                )

                if not current_connection or current_connection.get(
                    "status"
                ) != "approved":

                    print(
                        "⚠️ Remote input rejected: "
                        "connection not approved"
                    )

                    continue

                # ------------------------------------------------
                # CHECK SESSION
                # ------------------------------------------------

                session = sessions_db.get(
                    session_id
                )

                if not session:
                    continue

                permissions = session.get(
                    "permissions",
                    {}
                )

                device = input_data.get(
                    "device"
                )

                # ------------------------------------------------
                # PERMISSION CHECK (SEPARATE FOR EACH DEVICE)
                # ------------------------------------------------

                if device == "mouse":

                    if not permissions.get(
                        "mouse_control",
                        False
                    ):

                        print(
                            "⚠️ Mouse control permission "
                            "is disabled"
                        )

                        continue

                elif device == "keyboard":

                    if not permissions.get(
                        "keyboard_control",
                        False
                    ):

                        print(
                            "⚠️ Keyboard control permission "
                            "is disabled"
                        )

                        continue

                else:

                    # Unknown device - ignore
                    continue

                action = input_data.get(
                    "action"
                )

                # =====================================================
                # MOUSE DEVICE
                # =====================================================

                if device == "mouse":

                    # =================================================
                    # MOUSE MOVE
                    # =================================================

                    if action == "move":

                        x = input_data.get("x")
                        y = input_data.get("y")

                        if x is None or y is None:
                            continue

                        try:

                            x = float(x)
                            y = float(y)

                            x = max(0.0, min(1.0, x))
                            y = max(0.0, min(1.0, y))

                            screen_width, screen_height = (
                                pyautogui.size()
                            )

                            screen_x = int(
                                x * (screen_width - 1)
                            )

                            screen_y = int(
                                y * (screen_height - 1)
                            )

                            pyautogui.moveTo(
                                screen_x,
                                screen_y,
                                duration=0
                            )

                            print(
                                f"🖱️ Mouse moved: "
                                f"{screen_x}, {screen_y}"
                            )

                        except Exception as e:

                            print(
                                f"❌ Mouse move error: {e}"
                            )

                    # =================================================
                    # MOUSE CLICK
                    # =================================================

                    elif action == "click":

                        button = input_data.get(
                            "button",
                            "left"
                        )

                        if button not in [
                            "left",
                            "middle",
                            "right"
                        ]:

                            print(
                                "⚠️ Invalid mouse button:",
                                button
                            )

                            continue

                        try:

                            x = input_data.get("x")
                            y = input_data.get("y")

                            if x is not None and y is not None:

                                x = float(x)
                                y = float(y)

                                x = max(0.0, min(1.0, x))
                                y = max(0.0, min(1.0, y))

                                screen_width, screen_height = (
                                    pyautogui.size()
                                )

                                screen_x = int(
                                    x * (screen_width - 1)
                                )

                                screen_y = int(
                                    y * (screen_height - 1)
                                )

                                print(
                                    f"🖱️ Click position: "
                                    f"{screen_x}, {screen_y}"
                                )

                                pyautogui.moveTo(
                                    screen_x,
                                    screen_y,
                                    duration=0
                                )

                            pyautogui.click(
                                button=button
                            )

                            print(
                                f"🖱️ Mouse {button} click"
                            )

                        except Exception as e:

                            print(
                                f"❌ Mouse click error: {e}"
                            )

                    # =================================================
                    # MOUSE SCROLL
                    # =================================================

                    elif action == "scroll":

                        try:

                            delta_y = float(
                                input_data.get("deltaY", 0)
                            )

                            delta_x = float(
                                input_data.get("deltaX", 0)
                            )

                            scroll_y = int(-delta_y / 100)
                            scroll_x = int(-delta_x / 100)

                            if (
                                scroll_y == 0
                                and delta_y != 0
                            ):

                                scroll_y = (
                                    -1 if delta_y > 0 else 1
                                )

                            if (
                                scroll_x == 0
                                and delta_x != 0
                            ):

                                scroll_x = (
                                    -1 if delta_x > 0 else 1
                                )

                            if scroll_y != 0:
                                pyautogui.scroll(scroll_y)

                            if scroll_x != 0:
                                pyautogui.hscroll(scroll_x)

                            print(
                                f"🖱️ Mouse scroll: "
                                f"X={scroll_x}, Y={scroll_y}"
                            )

                        except Exception as e:

                            print(
                                f"❌ Mouse scroll error: {e}"
                            )

                    else:

                        print(
                            f"⚠️ Unsupported mouse action: "
                            f"{action}"
                        )

                # =====================================================
                # KEYBOARD DEVICE
                # =====================================================

                elif device == "keyboard":

                    js_key = input_data.get("key")

                    if not js_key:
                        continue

                    pyautogui_key = map_js_key_to_pyautogui(
                        js_key
                    )

                    if not pyautogui_key:

                        print(
                            f"⚠️ Unmapped keyboard key: "
                            f"{js_key}"
                        )

                        continue

                    # -------------------------------------------------
                    # KEY DOWN
                    # -------------------------------------------------

                    if action == "key_down":

                        try:

                            pyautogui.keyDown(
                                pyautogui_key
                            )

                            print(
                                f"⌨️ Key down: {pyautogui_key}"
                            )

                        except Exception as e:

                            print(
                                f"❌ Key down error: {e}"
                            )

                    # -------------------------------------------------
                    # KEY UP
                    # -------------------------------------------------

                    elif action == "key_up":

                        try:

                            pyautogui.keyUp(
                                pyautogui_key
                            )

                            print(
                                f"⌨️ Key up: {pyautogui_key}"
                            )

                        except Exception as e:

                            print(
                                f"❌ Key up error: {e}"
                            )

                    else:

                        print(
                            f"⚠️ Unsupported keyboard action: "
                            f"{action}"
                        )

    except WebSocketDisconnect:

        print(
            f"❌ Remote disconnected: "
            f"{connection_id}"
        )

    except Exception as e:

        print(
            f"❌ Remote WebSocket error: {e}"
        )

    finally:

        await websocket_manager.unregister_remote(
            connection_id
        )


# ============================================================
# SERVE THE BUILT REACT FRONTEND
# Both frontend and backend now live on the SAME port (9000).
# This matters most for ngrok's free plan, which only allows
# one tunnel/static domain at a time - with everything on one
# port, only one tunnel is needed.
#
# Run `npm run build` inside frontend/ first to generate the
# frontend/build folder this looks for. If that folder doesn't
# exist yet (e.g. still using `npm start` for local dev), this
# is skipped entirely and nothing changes.
# ============================================================

FRONTEND_BUILD_DIR = (
    Path(__file__).resolve().parent.parent.parent
    / "frontend" / "build"
)

if FRONTEND_BUILD_DIR.exists():

    app.mount(
        "/static",
        StaticFiles(
            directory=FRONTEND_BUILD_DIR / "static"
        ),
        name="frontend-static"
    )

    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):

        # Real files referenced by the build (favicon.ico,
        # manifest.json, etc) - serve directly if present.
        candidate = FRONTEND_BUILD_DIR / full_path

        if full_path and candidate.is_file():

            return FileResponse(candidate)

        # Everything else (including /connect) is a React route -
        # hand back index.html and let the React app's own code
        # (App.js) decide what to render based on the URL.
        return FileResponse(
            FRONTEND_BUILD_DIR / "index.html"
        )

else:

    print(
        "⚠️  frontend/build not found - run `npm run build` "
        "inside frontend/ to serve the frontend from this "
        "same backend/port. Until then, only the API/WebSocket "
        "routes above are available on this port."
    )