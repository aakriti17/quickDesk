import React, {
  useState,
  useRef,
  useEffect
} from 'react';

import {
  Html5Qrcode
} from 'html5-qrcode';

import {
  connectToSession,
  BACKEND_URL
} from '../../services/api';


// ============================================================
// PARSE SCANNED QR CONTENT
// The QR now encodes a full URL like
// http://<ip>:3000/connect?session=X&token=Y so any camera app
// can open it directly. Still accept the older raw-JSON format
// too, in case an older QR image is scanned.
// ============================================================

function parseQrContent(decodedText) {

  try {

    const url = new URL(decodedText);

    const sessionId =
      url.searchParams.get('session');

    const token =
      url.searchParams.get('token');

    if (sessionId && token) {

      return {
        session_id: sessionId,
        token: token
      };

    }

  } catch (e) {
    // Not a URL - fall through to JSON parsing below.
  }

  const parsed = JSON.parse(decodedText);

  if (!parsed.session_id || !parsed.token) {
    return null;
  }

  return parsed;

}


function RemoteScanner() {

  // ============================================================
  // STATES
  // ============================================================

  const [scanResult, setScanResult] =
    useState(null);

  const [loading, setLoading] =
    useState(false);

  const [error, setError] =
    useState('');

  const [remoteUser, setRemoteUser] =
    useState('');

  const [connectionStatus, setConnectionStatus] =
    useState(null);

  const [isScanning, setIsScanning] =
    useState(false);

  const [isCameraReady, setIsCameraReady] =
    useState(false);

  const [isGalleryScanning, setIsGalleryScanning] =
    useState(false);

  const [remoteStream, setRemoteStream] =
    useState(null);

  const [screenConnected, setScreenConnected] =
    useState(false);

  const [mousePosition, setMousePosition] =
    useState({
      x: 0,
      y: 0
    });

  // ============================================================
  // QR SCANNER REFS
  // ============================================================

  const scannerRef =
    useRef(null);

  const scannerRunningRef =
    useRef(false);

  const scannerStartingRef =
    useRef(false);

  const scannerStoppingRef =
    useRef(false);

  // ============================================================
  // WEBRTC REFS
  // ============================================================

  const remoteWebSocketRef =
    useRef(null);

  const peerConnectionRef =
    useRef(null);

  const remoteVideoRef =
    useRef(null);

  // Hidden text input - focusing this is what makes mobile
  // browsers pop up their on-screen keyboard. A plain <div>
  // (even with tabIndex) does NOT trigger it - only real
  // <input>/<textarea> elements do.
  const mobileKeyboardInputRef =
    useRef(null);

  const pendingIceCandidatesRef =
    useRef([]);

  // ============================================================
  // AUTO-LOAD SESSION FROM URL
  // When the QR code is scanned with the phone's normal camera
  // app (not this component's built-in scanner), it opens
  // http://<host-ip>:3000/connect?session=...&token=... directly.
  // Read those params here so the page goes straight to the
  // "enter your name" step, no in-app scanning needed.
  // ============================================================

  useEffect(() => {

    const params =
      new URLSearchParams(
        window.location.search
      );

    const sessionId =
      params.get('session');

    const token =
      params.get('token');

    if (sessionId && token) {

      setScanResult({
        session_id: sessionId,
        token: token
      });

    }

  }, []);


  // ============================================================
  // ATTACH REMOTE STREAM TO VIDEO
  // ============================================================

  useEffect(() => {

    if (
      !remoteStream ||
      !remoteVideoRef.current
    ) {
      return;
    }

    const video =
      remoteVideoRef.current;

    console.log(
      '🎥 Attaching remote stream to video element:',
      remoteStream
    );

    video.srcObject =
      remoteStream;

    const playVideo = async () => {

      try {

        await video.play();

        console.log(
          '▶️ Remote video playing'
        );

      } catch (err) {

        console.error(
          '❌ Remote video play error:',
          err
        );

      }

    };

    playVideo();

  }, [remoteStream]);


  // ============================================================
  // CLEANUP
  // ============================================================

  useEffect(() => {

    return () => {

      if (
        scannerRef.current &&
        scannerRunningRef.current
      ) {

        scannerRef.current
          .stop()
          .catch(() => {});

      }

      if (
        remoteWebSocketRef.current
      ) {

        remoteWebSocketRef.current.close();

        remoteWebSocketRef.current =
          null;

      }

      if (
        peerConnectionRef.current
      ) {

        peerConnectionRef.current.close();

        peerConnectionRef.current =
          null;

      }

      if (remoteStream) {

        remoteStream
          .getTracks()
          .forEach(
            track =>
              track.stop()
          );

      }

    };

  }, []);


  // ============================================================
  // SCAN QR FROM GALLERY / IMAGE
  // ============================================================

  const handleGalleryUpload = async (
    event
  ) => {

    const file =
      event.target.files?.[0];

    if (!file) {
      return;
    }

    try {

      setError('');

      setIsGalleryScanning(
        true
      );

      // --------------------------------------------------------
      // STOP CAMERA IF RUNNING
      // --------------------------------------------------------

      if (
        scannerRef.current &&
        scannerRunningRef.current
      ) {

        await stopScanner();

      }

      // --------------------------------------------------------
      // CREATE SCANNER INSTANCE
      // --------------------------------------------------------

      if (!scannerRef.current) {

        scannerRef.current =
          new Html5Qrcode(
            'qr-scanner-container'
          );

      }

      console.log(
        '🖼️ Scanning QR from gallery:',
        file.name
      );

      // --------------------------------------------------------
      // SCAN IMAGE
      // --------------------------------------------------------

      const decodedText =
        await scannerRef.current.scanFile(
          file,
          true
        );

      console.log(
        '✅ Gallery QR decoded:',
        decodedText
      );

      // --------------------------------------------------------
      // PARSE QR DATA
      // --------------------------------------------------------

      try {

        const parsed =
          parseQrContent(
            decodedText
          );

        if (!parsed) {

          setError(
            'Invalid QR code. Session information is missing.'
          );

          return;

        }

        setScanResult(
          parsed
        );

        setError('');

        console.log(
          '✅ Gallery QR session loaded:',
          parsed
        );

      } catch (e) {

        console.error(
          'Invalid QR content:',
          e
        );

        setError(
          'Invalid QR code format.'
        );

      }

    } catch (err) {

      console.error(
        '❌ Gallery QR scan error:',
        err
      );

      setError(
        'Could not scan QR code from this image. Please upload a clear QR image.'
      );

    } finally {

      setIsGalleryScanning(
        false
      );

      // Allow same image to be selected again
      event.target.value =
        '';

    }

  };


  // ============================================================
  // START QR SCANNER
  // ============================================================

  const startScanner = async () => {

    const container =
      document.getElementById(
        'qr-scanner-container'
      );

    if (!container) {

      setError(
        'Scanner container not found'
      );

      return;

    }

    if (
      scannerRunningRef.current ||
      scannerStartingRef.current
    ) {

      return;

    }

    if (
      scannerStoppingRef.current
    ) {

      return;

    }

    try {

      scannerStartingRef.current =
        true;

      setError('');

      setIsCameraReady(
        false
      );

      if (!scannerRef.current) {

        scannerRef.current =
          new Html5Qrcode(
            'qr-scanner-container'
          );

      }

      await scannerRef.current.start(

        {
          facingMode:
            'environment'
        },

        {
          fps:
            10,

          qrbox: {
            width:
              250,

            height:
              250
          }

        },

        (decodedText) => {

          try {

            const parsed =
              parseQrContent(
                decodedText
              );

            if (!parsed) {

              setError(
                'Invalid QR code. Session information is missing.'
              );

              return;

            }

            setScanResult(
              parsed
            );

            setError('');

            stopScanner();

          } catch (e) {

            console.error(
              'QR parse error:',
              e
            );

            setError(
              'Invalid QR code format'
            );

          }

        },

        () => {}

      );

      scannerRunningRef.current =
        true;

      setIsScanning(
        true
      );

      setIsCameraReady(
        true
      );

      console.log(
        '📷 Camera scanner started'
      );

    } catch (err) {

      console.error(
        'Scanner error:',
        err
      );

      scannerRunningRef.current =
        false;

      setIsScanning(
        false
      );

      setIsCameraReady(
        false
      );

      setError(
        'Failed to start camera. Please check camera permissions.'
      );

    } finally {

      scannerStartingRef.current =
        false;

    }

  };


  // ============================================================
  // STOP QR SCANNER
  // ============================================================

  const stopScanner = async () => {

    if (
      !scannerRef.current
    ) {

      setIsScanning(
        false
      );

      setIsCameraReady(
        false
      );

      return;

    }

    if (
      !scannerRunningRef.current
    ) {

      setIsScanning(
        false
      );

      setIsCameraReady(
        false
      );

      return;

    }

    if (
      scannerStoppingRef.current
    ) {

      return;

    }

    try {

      scannerStoppingRef.current =
        true;

      await scannerRef.current.stop();

    } catch (err) {

      console.log(
        'Scanner stop:',
        err
      );

    } finally {

      scannerRunningRef.current =
        false;

      scannerStoppingRef.current =
        false;

      setIsScanning(
        false
      );

      setIsCameraReady(
        false
      );

    }

  };


  // ============================================================
  // CONNECT TO SESSION
  // ============================================================

  const handleConnect = async () => {

    if (
      !scanResult ||
      !remoteUser.trim()
    ) {

      return;

    }

    setLoading(
      true
    );

    setError('');

    try {

      const response =
        await connectToSession(

          scanResult.session_id,

          {
            remote_user:
              remoteUser.trim(),

            session_token:
              scanResult.token
          }

        );

      setConnectionStatus(
        response
      );

      connectRemoteWebSocket(
        scanResult.session_id,
        response.connection_id
      );

    } catch (err) {

      console.error(
        'Connection error:',
        err
      );

      setError(
        'Failed to connect: ' +
        (
          err.response?.data?.detail ||
          err.message
        )
      );

    } finally {

      setLoading(
        false
      );

    }

  };


  // ============================================================
  // REMOTE WEBSOCKET
  // ============================================================

  const connectRemoteWebSocket = (
    sessionId,
    connectionId
  ) => {

    if (
      !sessionId ||
      !connectionId
    ) {

      return;

    }

    const wsUrl =
      BACKEND_URL.replace(/^http/, 'ws') +
      `/ws/remote/${connectionId}`;

    console.log(
      '🔌 Connecting Remote WebSocket:',
      wsUrl
    );

    const ws =
      new WebSocket(
        wsUrl
      );

    remoteWebSocketRef.current =
      ws;

   ws.onopen = () => {

  console.log(
    '🟢🟢🟢 REMOTE WEBSOCKET OPEN',
    {
      connectionId,
      url: wsUrl
    }
  );

};

    ws.onmessage = async (
      event
    ) => {

      try {

        const message =
          JSON.parse(
            event.data
          );

        console.log(
          '📨 Remote WebSocket message:',
          message
        );

        // ------------------------------------------------------
        // CONNECTION STATUS
        // ------------------------------------------------------

        if (
          message.type ===
          'connection_status'
        ) {

          setConnectionStatus(
            prev => ({

              ...(prev || {}),

              status:
                message.status,

              connection_id:
                message.connection_id

            })
          );

        }

        // ------------------------------------------------------
        // APPROVED
        // ------------------------------------------------------

        else if (
          message.type ===
          'connection_approved'
        ) {

          setConnectionStatus(
            prev => ({

              ...(prev || {}),

              status:
                'approved',

              message:
                message.message,

              permissions:
                message.permissions,

              connection_id:
                message.connection_id

            })
          );

          console.log(
            '✅ Connection approved'
          );

        }

        // ------------------------------------------------------
        // REJECTED
        // ------------------------------------------------------

        else if (
          message.type ===
          'connection_rejected'
        ) {

          setConnectionStatus(
            prev => ({

              ...(prev || {}),

              status:
                'rejected',

              message:
                message.message

            })
          );

          stopRemoteScreen();

        }

        // ------------------------------------------------------
        // WEBRTC SIGNAL
        // ------------------------------------------------------

        else if (
          message.type ===
          'webrtc_signal'
        ) {

          await handleWebRTCSignal(
            message
          );

        }

        // ------------------------------------------------------
        // SCREEN SHARE STOPPED
        // ------------------------------------------------------

        else if (
          message.type ===
          'screen_share_stopped'
        ) {

          console.log(
            '🛑 Host stopped screen sharing'
          );

          stopRemoteScreen();

        }

        // ------------------------------------------------------
        // SESSION TERMINATED
        // ------------------------------------------------------

        else if (
          message.type ===
          'session_terminated'
        ) {

          stopRemoteScreen();

          setConnectionStatus(
            prev => ({

              ...(prev || {}),

              status:
                'terminated',

              message:
                'Host terminated the session.'

            })
          );

        }

      } catch (err) {

        console.error(
          'Remote WebSocket message error:',
          err
        );

      }

    };

    ws.onerror = (
      event
    ) => {

      console.error(
        '❌ Remote WebSocket error:',
        event
      );

    };

    ws.onclose = (event) => {

      console.error(
        '🔴🔴 REMOTE WEBSOCKET CLOSED',
        {
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean
        }
      );

      if (
        remoteWebSocketRef.current === ws
      ) {
        remoteWebSocketRef.current = null;
      }

    };

  };


  // ============================================================
  // SEND REMOTE INPUT
  // ============================================================

  const sendRemoteInput = (inputData) => {
  const ws = remoteWebSocketRef.current;

  console.log("🎮 SEND INPUT CALLED");
  console.log("WebSocket:", ws);
  console.log("WebSocket state:", ws?.readyState);
  console.log("Input:", inputData);
  console.log("Session:", scanResult?.session_id);
  console.log("Connection:", connectionStatus?.connection_id);

  if (!ws) {
    console.error("❌ WebSocket object missing");
    return;
  }

  if (ws.readyState !== WebSocket.OPEN) {
    console.error(
      "❌ WebSocket NOT OPEN. State:",
      ws.readyState
    );
    return;
  }

  if (!scanResult?.session_id) {
    console.error("❌ Session ID missing");
    return;
  }

  const message = {
    type: "remote_input",
    session_id: scanResult.session_id,
    connection_id: connectionStatus?.connection_id,
    data: inputData
  };

  console.log("🚀 SENDING REMOTE INPUT:", message);

  ws.send(JSON.stringify(message));

  console.log("✅ REMOTE INPUT SENT");
};


  // ============================================================
  // MOUSE MOVE
  // ============================================================

  const handleMouseMove = (
    event
  ) => {

    const video =
      remoteVideoRef.current;

    if (!video) {
      return;
    }

    const rect =
      video.getBoundingClientRect();

    if (
      rect.width <= 0 ||
      rect.height <= 0 ||
      !video.videoWidth ||
      !video.videoHeight
    ) {

      return;

    }

    // ----------------------------------------------------------
    // VIDEO ASPECT RATIO
    // ----------------------------------------------------------

    const videoAspect =
      video.videoWidth /
      video.videoHeight;

    const containerAspect =
      rect.width /
      rect.height;

    let displayedWidth;
    let displayedHeight;
    let offsetX;
    let offsetY;

    // ----------------------------------------------------------
    // OBJECT-FIT: CONTAIN
    // ----------------------------------------------------------

    if (
      containerAspect >
      videoAspect
    ) {

      // Black bars left/right

      displayedHeight =
        rect.height;

      displayedWidth =
        rect.height *
        videoAspect;

      offsetX =
        (
          rect.width -
          displayedWidth
        ) / 2;

      offsetY =
        0;

    } else {

      // Black bars top/bottom

      displayedWidth =
        rect.width;

      displayedHeight =
        rect.width /
        videoAspect;

      offsetX =
        0;

      offsetY =
        (
          rect.height -
          displayedHeight
        ) / 2;

    }

    // ----------------------------------------------------------
    // MOUSE POSITION INSIDE ACTUAL VIDEO
    // ----------------------------------------------------------

    const mouseX =
      event.clientX -
      rect.left -
      offsetX;

    const mouseY =
      event.clientY -
      rect.top -
      offsetY;

    // ----------------------------------------------------------
    // IGNORE BLACK BAR AREA
    // ----------------------------------------------------------

    if (
      mouseX < 0 ||
      mouseY < 0 ||
      mouseX > displayedWidth ||
      mouseY > displayedHeight
    ) {

      return;

    }

    // ----------------------------------------------------------
    // NORMALIZED COORDINATES
    // ----------------------------------------------------------

    const x =
      Math.max(
        0,
        Math.min(
          1,
          mouseX /
            displayedWidth
        )
      );

    const y =
      Math.max(
        0,
        Math.min(
          1,
          mouseY /
            displayedHeight
        )
      );

    // ----------------------------------------------------------
    // UPDATE LOCAL MOUSE ICON
    // ----------------------------------------------------------

    setMousePosition({
      x,
      y
    });

    // ----------------------------------------------------------
    // SEND TO HOST
    // ----------------------------------------------------------

    sendRemoteInput({

      device:
        'mouse',

      action:
        'move',

      x,
      y

    });

  };


  // ============================================================
  // MOBILE ON-SCREEN KEYBOARD INPUT
  // Virtual/on-screen keyboards on mobile (Android especially)
  // often fire keydown/keyup with key === "Unidentified", so the
  // physical-keyboard handlers above (handleKeyDown/handleKeyUp)
  // can't be used here. The 'input' event's own .data (the InputEvent
  // spec) reliably carries the actual character(s) typed, insertion
  // or deletion, regardless of keyboard/IME - use that instead.
  // ============================================================

  const sendSingleKey = (key) => {

    const ws = remoteWebSocketRef.current;

    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }

    sendRemoteInput({
      device: 'keyboard',
      action: 'key_down',
      key,
      code: '',
      ctrl: false,
      alt: false,
      shift: false,
      meta: false
    });

    sendRemoteInput({
      device: 'keyboard',
      action: 'key_up',
      key,
      code: '',
      ctrl: false,
      alt: false,
      shift: false,
      meta: false
    });

  };

  const MOBILE_CONTROL_KEYS = {
    Enter: 'Enter',
    Backspace: 'Backspace',
    Delete: 'Delete',
    Tab: 'Tab',
    Escape: 'Escape',
    ArrowUp: 'ArrowUp',
    ArrowDown: 'ArrowDown',
    ArrowLeft: 'ArrowLeft',
    ArrowRight: 'ArrowRight'
  };

  const handleMobileKeyboardKeyDown = (event) => {

    const key = MOBILE_CONTROL_KEYS[event.key];

    if (!key) {
      // Printable characters are handled by
      // handleMobileKeyboardInput (the 'input' event) instead,
      // since mobile virtual keyboards often report
      // event.key === "Unidentified" for those.
      return;
    }

    // Prevent the field's own default behavior (which would
    // also fire a competing 'input' event for some of these)
    // so each key press is only sent once.
    event.preventDefault();

    sendSingleKey(key);

  };

  const handleMobileKeyboardInput = (event) => {

    const nativeEvent = event.nativeEvent;
    const inputType = nativeEvent.inputType;
    const data = nativeEvent.data;

    // Always keep this field empty - we relay individual
    // characters immediately rather than accumulating text.
    event.target.value = '';

    // Enter/Backspace/Delete are handled in
    // handleMobileKeyboardKeyDown above (more reliable there -
    // keydown fires even when this field is already empty,
    // whereas these 'input' inputTypes may not fire at all in
    // that case). Skip them here to avoid sending twice.
    if (
      inputType === 'deleteContentBackward' ||
      inputType === 'deleteContentForward' ||
      inputType === 'insertLineBreak' ||
      inputType === 'insertParagraph'
    ) {
      return;
    }

    if (data) {
      // Predictive text / autocomplete can insert more than one
      // character at once (e.g. a whole suggested word) - send
      // them one at a time so the host types them all.
      for (const ch of data) {
        sendSingleKey(ch);
      }
    }

  };


  // ============================================================
  // MOUSE CLICK
  // ============================================================

 const handleMouseClick = (event) => {
  event.preventDefault();
  event.stopPropagation();

  // preventDefault() above stops the browser's normal
  // click-elsewhere-closes-the-keyboard behavior, so close it
  // here ourselves if it's currently open.
  if (
    mobileKeyboardInputRef.current &&
    document.activeElement === mobileKeyboardInputRef.current
  ) {
    mobileKeyboardInputRef.current.blur();
  }

  const video = remoteVideoRef.current;

  if (!video) {
    console.warn("⚠️ Remote video element not found");
    return;
  }

  const rect = video.getBoundingClientRect();

  if (rect.width <= 0 || rect.height <= 0) {
    console.warn("⚠️ Remote video has invalid dimensions");
    return;
  }

  /*
   * IMPORTANT: the video element is displayed with
   * object-fit: contain, so unless its aspect ratio exactly
   * matches the container's, there are black bars on either
   * the sides or top/bottom. handleMouseMove() already accounts
   * for this - handleMouseClick() must use the EXACT same math,
   * or clicks land in the wrong place relative to what the
   * cursor is visually over (this was the bug: clicks opening
   * the wrong app on the host).
   */

  let x;
  let y;

  if (video.videoWidth && video.videoHeight) {

    const videoAspect =
      video.videoWidth / video.videoHeight;

    const containerAspect =
      rect.width / rect.height;

    let displayedWidth;
    let displayedHeight;
    let offsetX;
    let offsetY;

    if (containerAspect > videoAspect) {

      // Black bars left/right
      displayedHeight = rect.height;
      displayedWidth = rect.height * videoAspect;
      offsetX = (rect.width - displayedWidth) / 2;
      offsetY = 0;

    } else {

      // Black bars top/bottom
      displayedWidth = rect.width;
      displayedHeight = rect.width / videoAspect;
      offsetX = 0;
      offsetY = (rect.height - displayedHeight) / 2;

    }

    const mouseX = event.clientX - rect.left - offsetX;
    const mouseY = event.clientY - rect.top - offsetY;

    // Click landed on a black bar, not the actual video - ignore it.
    if (
      mouseX < 0 ||
      mouseY < 0 ||
      mouseX > displayedWidth ||
      mouseY > displayedHeight
    ) {
      return;
    }

    x = mouseX / displayedWidth;
    y = mouseY / displayedHeight;

  } else {

    // videoWidth/videoHeight not available yet - fall back to
    // the old (less accurate) container-relative calculation
    // rather than failing the click entirely.
    x = (event.clientX - rect.left) / rect.width;
    y = (event.clientY - rect.top) / rect.height;

  }

  // Keep coordinates between 0 and 1
  x = Math.max(0, Math.min(1, x));
  y = Math.max(0, Math.min(1, y));

  let button = "left";

  if (event.button === 1) {
    button = "middle";
  } else if (event.button === 2) {
    button = "right";
  }

  setMousePosition({ x, y });

  console.log("🖱️🖱️ REMOTE CLICK", {
    button,
    x,
    y,
    clientX: event.clientX,
    clientY: event.clientY,
    videoRect: {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height
    }
  });

  sendRemoteInput({
    device: "mouse",
    action: "click",
    button,
    x,
    y
  });
};
  // ============================================================
  // MOUSE WHEEL / SCROLL
  // ============================================================

  const handleMouseWheel = (
    event
  ) => {

    event.preventDefault();

    const ws =
      remoteWebSocketRef.current;

    if (
      !ws ||
      ws.readyState !==
        WebSocket.OPEN
    ) {

      return;

    }

    console.log(
      '🖱️ Mouse scroll:',
      event.deltaX,
      event.deltaY
    );

    sendRemoteInput({

      device:
        'mouse',

      action:
        'scroll',

      deltaX:
        event.deltaX,

      deltaY:
        event.deltaY

    });

  };


  // ============================================================
  // KEYBOARD PRESS
  // ============================================================

  const handleKeyDown = (
    event
  ) => {

    /*
     * Keyboard support is prepared here,
     * but backend should only process it
     * when keyboard permission is enabled.
     */

    if (
      event.key === 'F5' ||
      (
        event.ctrlKey &&
        event.key.toLowerCase() === 'r'
      )
    ) {

      return;

    }

    event.preventDefault();

    sendRemoteInput({

      device:
        'keyboard',

      action:
        'key_down',

      key:
        event.key,

      code:
        event.code,

      ctrl:
        event.ctrlKey,

      alt:
        event.altKey,

      shift:
        event.shiftKey,

      meta:
        event.metaKey

    });

  };


  // ============================================================
  // KEYBOARD RELEASE
  // ============================================================

  const handleKeyUp = (
    event
  ) => {

    event.preventDefault();

    sendRemoteInput({

      device:
        'keyboard',

      action:
        'key_up',

      key:
        event.key,

      code:
        event.code,

      ctrl:
        event.ctrlKey,

      alt:
        event.altKey,

      shift:
        event.shiftKey,

      meta:
        event.metaKey

    });

  };


  // ============================================================
  // SEND WEBRTC SIGNAL
  // ============================================================

  const sendWebRTCSignal = (
    data
  ) => {

    const ws =
      remoteWebSocketRef.current;

    if (
      !ws ||
      ws.readyState !==
        WebSocket.OPEN
    ) {

      console.error(
        '❌ Remote WebSocket not connected'
      );

      return;

    }

    if (
      !scanResult?.session_id
    ) {

      console.error(
        '❌ Session ID is missing'
      );

      return;

    }

    ws.send(
      JSON.stringify({

        type:
          'webrtc_signal',

        session_id:
          scanResult.session_id,

        data:
          data

      })
    );

  };


  // ============================================================
  // CREATE REMOTE PEER CONNECTION
  // ============================================================

  const createRemotePeerConnection = () => {

    if (
      peerConnectionRef.current
    ) {

      return peerConnectionRef.current;

    }

    console.log(
      '🔗 Creating remote RTCPeerConnection'
    );

    const peerConnection =
      new RTCPeerConnection({

        iceServers: [

          {
            urls:
              'stun:stun.l.google.com:19302'
          },

          {
            urls:
              'stun:stun1.l.google.com:19302'
          }

        ]

      });


    // ----------------------------------------------------------
    // ICE CANDIDATE
    // ----------------------------------------------------------

    peerConnection.onicecandidate =
      (event) => {

        if (
          event.candidate
        ) {

          console.log(
            '🧊 Sending remote ICE candidate'
          );

          sendWebRTCSignal({

            candidate:
              event.candidate

          });

        }

      };


    // ----------------------------------------------------------
    // REMOTE TRACK
    // ----------------------------------------------------------

    peerConnection.ontrack =
      (event) => {

        console.log(
          '🖥️ Remote screen track received',
          event
        );

        let stream =
          event.streams?.[0];

        if (!stream) {

          stream =
            new MediaStream([
              event.track
            ]);

        }

        console.log(
          '🎥 Remote stream received:',
          stream
        );

        console.log(
          '🎥 Remote video tracks:',
          stream.getVideoTracks()
        );

        setRemoteStream(
          stream
        );

        setScreenConnected(
          true
        );

      };


    // ----------------------------------------------------------
    // CONNECTION STATE
    // ----------------------------------------------------------

    peerConnection.onconnectionstatechange =
      () => {

        console.log(
          '🔗 WebRTC connection state:',
          peerConnection.connectionState
        );

        if (
          peerConnection.connectionState ===
          'connected'
        ) {

          console.log(
            '✅ WebRTC peer connection established'
          );

        }

        if (
          [
            'failed',
            'closed'
          ].includes(
            peerConnection.connectionState
          )
        ) {

          setScreenConnected(
            false
          );

        }

      };


    // ----------------------------------------------------------
    // ICE CONNECTION STATE
    // ----------------------------------------------------------

    peerConnection.oniceconnectionstatechange =
      () => {

        console.log(
          '🧊 ICE connection state:',
          peerConnection.iceConnectionState
        );

        if (
          peerConnection.iceConnectionState ===
          'failed'
        ) {

          console.error(
            '❌ ICE connection failed'
          );

          setError(
            'WebRTC ICE connection failed.'
          );

        }

      };


    // ----------------------------------------------------------
    // SIGNALING STATE
    // ----------------------------------------------------------

    peerConnection.onsignalingstatechange =
      () => {

        console.log(
          '📡 WebRTC signaling state:',
          peerConnection.signalingState
        );

      };


    peerConnectionRef.current =
      peerConnection;

    return peerConnection;

  };


  // ============================================================
  // HANDLE WEBRTC SIGNAL
  // ============================================================

  const handleWebRTCSignal = async (
    message
  ) => {

    const data =
      message.data;

    if (!data) {

      console.error(
        '❌ WebRTC signal has no data'
      );

      return;

    }

    const peerConnection =
      createRemotePeerConnection();


    // ----------------------------------------------------------
    // OFFER FROM HOST
    // ----------------------------------------------------------

    if (
      data.type ===
      'offer'
    ) {

      try {

        console.log(
          '📩 WebRTC offer received from host'
        );

        await peerConnection.setRemoteDescription({

          type:
            'offer',

          sdp:
            data.sdp

        });

        console.log(
          '✅ Remote description set'
        );


        if (
          pendingIceCandidatesRef.current.length
        ) {

          console.log(
            '🧊 Adding pending ICE candidates:',
            pendingIceCandidatesRef.current.length
          );

          for (
            const candidate
            of pendingIceCandidatesRef.current
          ) {

            try {

              await peerConnection.addIceCandidate(
                candidate
              );

            } catch (err) {

              console.error(
                '❌ Pending ICE candidate error:',
                err
              );

            }

          }

          pendingIceCandidatesRef.current =
            [];

        }


        const answer =
          await peerConnection.createAnswer();

        await peerConnection.setLocalDescription(
          answer
        );

        console.log(
          '📤 Sending WebRTC answer'
        );

        sendWebRTCSignal({

          type:
            'answer',

          sdp:
            answer.sdp

        });

        console.log(
          '✅ WebRTC answer sent to host'
        );

      } catch (err) {

        console.error(
          '❌ Error handling WebRTC offer:',
          err
        );

        setError(
          'Failed to establish screen connection: ' +
          err.message
        );

      }

      return;

    }


    // ----------------------------------------------------------
    // ICE CANDIDATE FROM HOST
    // ----------------------------------------------------------

    if (
      data.candidate
    ) {

      try {

        if (
          !peerConnection.remoteDescription
        ) {

          console.log(
            '🧊 Buffering ICE candidate'
          );

          pendingIceCandidatesRef.current.push(
            data.candidate
          );

          return;

        }

        await peerConnection.addIceCandidate(
          data.candidate
        );

        console.log(
          '🧊 Remote ICE candidate added'
        );

      } catch (err) {

        console.error(
          '❌ ICE candidate error:',
          err
        );

      }

    }

  };


  // ============================================================
  // STOP REMOTE SCREEN
  // ============================================================

  const stopRemoteScreen = () => {

    console.log(
      '🛑 Stopping remote screen'
    );

    if (
      remoteVideoRef.current
    ) {

      remoteVideoRef.current.pause();

      remoteVideoRef.current.srcObject =
        null;

    }

    if (
      remoteStream
    ) {

      remoteStream
        .getTracks()
        .forEach(
          track =>
            track.stop()
        );

    }

    if (
      peerConnectionRef.current
    ) {

      peerConnectionRef.current.close();

      peerConnectionRef.current =
        null;

    }

    pendingIceCandidatesRef.current =
      [];

    setRemoteStream(
      null
    );

    setScreenConnected(
      false
    );

    setMousePosition({
      x: 0,
      y: 0
    });

  };


  // ============================================================
  // RESCAN
  // ============================================================

  const handleRescan = async () => {

    await stopScanner();

    stopRemoteScreen();

    if (
      remoteWebSocketRef.current
    ) {

      remoteWebSocketRef.current.close();

      remoteWebSocketRef.current =
        null;

    }

    setScanResult(
      null
    );

    setConnectionStatus(
      null
    );

    setError('');

    setRemoteUser('');

    setMousePosition({
      x: 0,
      y: 0
    });

    setTimeout(
      () => {

        startScanner();

      },
      500
    );

  };


  // ============================================================
  // STYLES
  // ============================================================

  const inputStyle = {

    width:
      '100%',

    padding:
      '10px',

    margin:
      '10px 0',

    border:
      '1px solid #ddd',

    borderRadius:
      '5px',

    fontSize:
      '16px',

    boxSizing:
      'border-box'

  };


  const statusStyle = {

    marginTop:
      '20px',

    padding:
      '15px',

    background:
      '#f8f9fa',

    borderRadius:
      '8px'

  };


  // ============================================================
  // UI
  // ============================================================

  return (

    <div className="remote-scanner">

      <div className="card">

        <h2>
          📱 Connect to Support Session
        </h2>

        <p>
          Scan the QR code from the host's screen
        </p>


        {/* ================================================== */}
        {/* SCREEN VIEWER + REMOTE CONTROL */}
        {/* ================================================== */}

        {screenConnected ? (

          <div
            style={{
              marginTop:
                '20px',

              padding:
                '15px',

              background:
                '#111',

              borderRadius:
                '10px'
            }}
          >

            <h3
              style={{
                color:
                  'white',

                marginTop:
                  '0'
              }}
            >
              🖥️ Live Host Screen
            </h3>


            {/* ------------------------------------------------ */}
            {/* REMOTE SCREEN AREA */}
            {/* ------------------------------------------------ */}

            <div
  tabIndex={0}
  style={{
    width: '100%',
    position: 'relative',
    outline: 'none',
    cursor: 'crosshair',
    background: 'red'
  }}
onMouseDown={handleMouseClick}
onMouseMove={handleMouseMove}
onWheel={handleMouseWheel}
onKeyDown={handleKeyDown}
onKeyUp={handleKeyUp}>
              <video
                ref={
                  remoteVideoRef
                }

                autoPlay

                playsInline

                muted

                onLoadedMetadata={() => {

                  console.log(
                    '🎬 Remote video metadata loaded'
                  );

                  if (
                    remoteVideoRef.current
                  ) {

                    remoteVideoRef.current
                      .play()
                      .catch(
                        err =>
                          console.error(
                            'Video play error:',
                            err
                          )
                      );

                  }

                }}

                onPlaying={() => {

                  console.log(
                    '▶️ Remote video playing'
                  );

                }}

                onError={(event) => {

                  console.error(
                    '❌ Remote video element error:',
                    event
                  );

                }}

                style={{
                  width:
                    '100%',

                  height:
                    'auto',

                  minHeight:
                    '300px',

                  maxHeight:
                    '70vh',

                  background:
                    '#000',

                  borderRadius:
                    '8px',

                  display:
                    'block',

                  objectFit:
                    'contain',

                  pointerEvents:
                    'none'
                }}

              />

              {/* ---------------------------------------------- */}
              {/* Custom cursor overlay removed - the host's own
                  real cursor is already visible in the shared
                  screen, so a second floating icon was just
                  visual clutter. */}

            </div>


            {/* ------------------------------------------------ */}
            {/* HIDDEN INPUT - focusing this triggers the phone's */}
            {/* own on-screen keyboard. A plain div can't do this */}
            {/* on mobile, only a real <input>/<textarea> can.    */}
            {/* ------------------------------------------------ */}

            <input
              ref={mobileKeyboardInputRef}
              type="text"
              inputMode="text"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck="false"
              onInput={handleMobileKeyboardInput}
              onKeyDown={handleMobileKeyboardKeyDown}
              style={{
                position: 'absolute',
                opacity: 0,
                height: '1px',
                width: '1px',
                border: 'none',
                padding: 0,
                margin: 0,
                pointerEvents: 'none'
              }}
            />

            {/* ------------------------------------------------ */}
            {/* KEYBOARD TOGGLE BUTTON - opens the phone's own    */}
            {/* keyboard only when tapped, not on every click on  */}
            {/* the remote screen.                                */}
            {/* ------------------------------------------------ */}

            <button
              type="button"
              onClick={() => {

                const input = mobileKeyboardInputRef.current;

                if (!input) {
                  return;
                }

                if (document.activeElement === input) {
                  // Already open - close it.
                  input.blur();
                } else {
                  input.focus();
                }

              }}
              style={{
                marginTop: '10px',
                padding: '8px 16px',
                background: '#374151',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                fontSize: '14px',
                cursor: 'pointer'
              }}
            >
              ⌨️ Show/Hide Keyboard
            </button>


            <p
              style={{
                color:
                  '#2ecc71',

                marginBottom:
                  '0'
              }}
            >
              🟢 Connected to host screen
            </p>

          </div>

        ) : !scanResult ? (

          // ====================================================
          // QR SCANNER SCREEN
          // ====================================================

          <div>

            {/* ------------------------------------------------ */}
            {/* QR CAMERA CONTAINER */}
            {/* ------------------------------------------------ */}

            <div
              id="qr-scanner-container"

              style={{
                width:
                  '100%',

                maxWidth:
                  '400px',

                margin:
                  '0 auto',

                minHeight:
                  '300px',

                background:
                  '#000',

                borderRadius:
                  '8px',

                overflow:
                  'hidden',

                position:
                  'relative'
              }}
            />


            {/* ------------------------------------------------ */}
            {/* START CAMERA */}
            {/* ------------------------------------------------ */}

            {!isScanning && (

              <button
                className="btn-primary"

                onClick={
                  startScanner
                }

                disabled={
                  isGalleryScanning
                }

                style={{
                  marginTop:
                    '10px'
                }}
              >
                📷 Start Camera
              </button>

            )}


            {/* ------------------------------------------------ */}
            {/* CAMERA ACTIVE */}
            {/* ------------------------------------------------ */}

            {isScanning && (

              <div>

                <p
                  style={{
                    color:
                      '#2ecc71',

                    marginTop:
                      '10px'
                  }}
                >
                  {isCameraReady
                    ? '📷 Camera active - scanning for QR code...'
                    : '⏳ Starting camera...'}
                </p>


                <button
                  className="btn-danger"

                  onClick={
                    stopScanner
                  }

                  disabled={
                    !isScanning
                  }
                >
                  ⏹ Stop Scanning
                </button>

              </div>

            )}


            {/* ------------------------------------------------ */}
            {/* GALLERY QR UPLOAD */}
            {/* ------------------------------------------------ */}

            {!isScanning && (

              <div
                style={{
                  marginTop:
                    '15px',

                  textAlign:
                    'center'
                }}
              >

                <div
                  style={{
                    marginBottom:
                      '10px',

                    color:
                      '#888'
                  }}
                >
                  ───── OR ─────
                </div>


                <label
                  className="btn-primary"

                  style={{
                    display:
                      'inline-block',

                    cursor:
                      isGalleryScanning
                        ? 'not-allowed'
                        : 'pointer',

                    opacity:
                      isGalleryScanning
                        ? 0.6
                        : 1
                  }}
                >

                  🖼️ Upload QR from Gallery

                  <input
                    type="file"

                    accept="image/*"

                    onChange={
                      handleGalleryUpload
                    }

                    style={{
                      display:
                        'none'
                    }}

                    disabled={
                      isGalleryScanning
                    }

                  />

                </label>


                {isGalleryScanning && (

                  <p
                    style={{
                      color:
                        '#3498db',

                      marginTop:
                        '10px'
                    }}
                  >
                    🔍 Scanning QR from image...
                  </p>

                )}

              </div>

            )}

          </div>

        ) : (

          // ====================================================
          // SESSION INFORMATION
          // ====================================================

          <div>

            {/* ------------------------------------------------ */}
            {/* SESSION INFO */}
            {/* ------------------------------------------------ */}

            <div
              className="session-info"
            >

              <p>

                <strong>
                  Session:
                </strong>{' '}

                {
                  scanResult.session_id
                }

              </p>


              <p>

                <strong>
                  Expires:
                </strong>{' '}

                {scanResult.expires_at
                  ? new Date(
                      scanResult.expires_at
                    ).toLocaleString()
                  : 'N/A'}

              </p>

            </div>


            {/* ------------------------------------------------ */}
            {/* USER NAME */}
            {/* ------------------------------------------------ */}

            <input
              type="text"

              placeholder="Enter your name"

              value={
                remoteUser
              }

              onChange={
                e =>
                  setRemoteUser(
                    e.target.value
                  )
              }

              style={
                inputStyle
              }
            />


            {/* ------------------------------------------------ */}
            {/* CONNECT BUTTON */}
            {/* ------------------------------------------------ */}

            <button
              className="btn-primary"

              onClick={
                handleConnect
              }

              disabled={
                loading ||
                !remoteUser.trim() ||
                connectionStatus?.status ===
                  'approved'
              }
            >
              {loading

                ? 'Connecting...'

                : connectionStatus?.status ===
                    'approved'

                  ? '✅ Connected'

                  : '🔗 Connect'

              }
            </button>


            {/* ------------------------------------------------ */}
            {/* RESCAN BUTTON */}
            {/* ------------------------------------------------ */}

            <button
              className="btn-danger"

              onClick={
                handleRescan
              }

              style={{
                marginLeft:
                  '10px'
              }}

              disabled={
                loading
              }
            >
              🔄 Rescan
            </button>


            {/* ------------------------------------------------ */}
            {/* CONNECTION STATUS */}
            {/* ------------------------------------------------ */}

            {connectionStatus && (

              <div
                style={
                  statusStyle
                }
              >

                <h3>
                  Status:{' '}

                  {
                    connectionStatus.status
                  }

                </h3>


                <p>
                  {
                    connectionStatus.message
                  }
                </p>


                {/* PENDING */}

                {connectionStatus.status ===
                  'pending' && (

                  <p
                    style={{
                      color:
                        '#f39c12'
                    }}
                  >
                    ⏳ Waiting for host
                    to approve...
                  </p>

                )}


                {/* APPROVED */}

                {connectionStatus.status ===
                  'approved' && (

                  <div>

                    <p
                      style={{
                        color:
                          '#2ecc71'
                      }}
                    >
                      ✅ Connection approved!
                    </p>


                    {!screenConnected && (

                      <p>
                        🖥️ Waiting for the host
                        to start screen sharing...
                      </p>

                    )}

                  </div>

                )}


                {/* REJECTED */}

                {connectionStatus.status ===
                  'rejected' && (

                  <p
                    style={{
                      color:
                        '#e74c3c'
                    }}
                  >
                    ❌ Connection rejected
                    by host.
                  </p>

                )}


                {/* TERMINATED */}

                {connectionStatus.status ===
                  'terminated' && (

                  <p
                    style={{
                      color:
                        '#e74c3c'
                    }}
                  >
                    🛑 Host terminated
                    the session.
                  </p>

                )}

              </div>

            )}

          </div>

        )}


        {/* ================================================== */}
        {/* ERROR */}
        {/* ================================================== */}

        {error && (

          <div
            style={{
              color:
                '#e74c3c',

              marginTop:
                '10px',

              padding:
                '10px',

              background:
                '#fee',

              borderRadius:
                '5px'
            }}
          >
            ❌ {error}
          </div>

        )}

      </div>

    </div>

  );

}


export default RemoteScanner;