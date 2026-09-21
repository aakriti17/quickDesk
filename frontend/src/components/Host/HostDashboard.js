import React, { useEffect, useRef, useState } from 'react';
import SessionCreator from './SessionCreator';
import SessionControls from './SessionControls';

import {
  createSession,
  terminateSession,
  getSessionStatus,
  BACKEND_URL,
} from '../../services/api';


function HostDashboard() {

  const [session, setSession] = useState(null);
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [sharingConnectionId, setSharingConnectionId] = useState(null);
  const [screenSharing, setScreenSharing] = useState(false);

  // WebSocket
  const websocketRef = useRef(null);

  // WebRTC peer connections
  const peerConnectionsRef = useRef(new Map());

  // Screen stream
  const screenStreamRef = useRef(null);


  // ============================================================
  // CREATE SESSION
  // ============================================================

  const handleCreateSession = async (sessionData) => {

    setLoading(true);
    setError('');

    try {

      // Ask for screen-share permission as part of this SAME
      // click (browsers require a direct user gesture for
      // getDisplayMedia). Doing it here, once, means no future
      // connecting viewer needs the host to click anything -
      // the captured stream is just reused for each of them.
      try {

        await captureScreen();

      } catch (captureErr) {

        console.warn(
          'Screen capture was not granted at session ' +
          'creation - a manual "Start Screen Sharing" ' +
          'button will be available instead.',
          captureErr
        );

      }

      const response = await createSession(
        sessionData
      );

      setSession(response);
      setConnections([]);

    } catch (err) {

      console.error(
        'Create session error:',
        err
      );

      setError(
        'Failed to create session: ' +
        (
          err.response?.data?.detail ||
          err.message
        )
      );

    } finally {

      setLoading(false);

    }
  };


  // ============================================================
  // HOST WEBSOCKET
  // ============================================================

  useEffect(() => {

    if (!session?.session_id) {
      return;
    }

    const wsUrl =
      BACKEND_URL.replace(/^http/, 'ws') +
      `/ws/host/${session.session_id}`;

    console.log(
      '🔌 Connecting Host WebSocket:',
      wsUrl
    );

    const ws = new WebSocket(wsUrl);

    websocketRef.current = ws;


    ws.onopen = () => {

      console.log(
        '✅ Host WebSocket connected'
      );

    };


    ws.onmessage = async (event) => {

      try {

        const message =
          JSON.parse(event.data);

        console.log(
          '📨 Host WebSocket message:',
          message
        );


        // --------------------------------------------------------
        // NEW CONNECTION REQUEST
        // --------------------------------------------------------

        if (
          message.type ===
          'connection_request'
        ) {

          const newConnection =
            message.data;

          setConnections(prev => {

            const exists =
              prev.some(
                c =>
                  c.connection_id ===
                  newConnection.connection_id
              );

            if (exists) {
              return prev;
            }

            return [
              ...prev,
              newConnection
            ];

          });

          // Connection is already auto-approved on the backend.
          // If we already have a captured screen stream, share
          // it immediately - no host click needed. (If no
          // stream is captured yet, the host sees a fallback
          // "Start Screen Sharing" button in the UI below.)
          if (screenStreamRef.current) {

            shareStreamWithConnection(
              newConnection.connection_id
            );

          }

        }


        // --------------------------------------------------------
        // WEBRTC SIGNAL
        // --------------------------------------------------------

        else if (
          message.type ===
          'webrtc_signal'
        ) {

          await handleWebRTCSignal(
            message
          );

        }


        // --------------------------------------------------------
        // SCREEN SHARE REQUEST
        // --------------------------------------------------------

        else if (
          message.type ===
          'screen_share_request'
        ) {

          console.log(
            '🖥️ Screen sharing requested by remote'
          );

        }


        // --------------------------------------------------------
        // REMOTE DISCONNECTED
        // --------------------------------------------------------

        else if (
          message.type ===
          'remote_disconnected'
        ) {

          const connectionId =
            message.connection_id;

          closePeerConnection(
            connectionId
          );

        }

      } catch (err) {

        console.error(
          'Host WebSocket message error:',
          err
        );

      }

    };


    ws.onerror = (event) => {

      console.error(
        '❌ Host WebSocket error:',
        event
      );

    };


    ws.onclose = () => {

      console.log(
        '🔴 Host WebSocket disconnected'
      );

    };


    return () => {

      if (
        websocketRef.current
      ) {

        websocketRef.current.close();

        websocketRef.current =
          null;

      }

    };

  }, [session?.session_id]);


  // ============================================================
  // POLL CONNECTIONS
  // ============================================================

  useEffect(() => {

    if (!session?.session_id) {
      return;
    }

    const fetchConnections =
      async () => {

        try {

          const response =
            await getSessionStatus(
              session.session_id
            );

          const backendSession =
            response.session;

          if (
            backendSession
            ?.connections
          ) {

            setConnections(
              backendSession.connections
            );

            setSession(prev => ({
              ...prev,
              status:
                backendSession.status
            }));

          }

        } catch (err) {

          console.error(
            'Connection polling error:',
            err
          );

        }

      };


    fetchConnections();

    const interval =
      setInterval(
        fetchConnections,
        2000
      );


    return () => {

      clearInterval(
        interval
      );

    };

  }, [session?.session_id]);


  // ============================================================
  // WEBRTC SIGNAL SENDER
  // ============================================================

  const sendWebRTCSignal = (
    connectionId,
    data
  ) => {

    if (
      !websocketRef.current ||
      websocketRef.current.readyState !==
      WebSocket.OPEN
    ) {

      console.error(
        '❌ Host WebSocket is not connected'
      );

      return;

    }


    websocketRef.current.send(
      JSON.stringify({

        type:
          'webrtc_signal',

        connection_id:
          connectionId,

        data:
          data

      })
    );

  };


  // ============================================================
  // CREATE WEBRTC CONNECTION
  // ============================================================

  const createPeerConnection = (
    connectionId
  ) => {

    const existing =
      peerConnectionsRef.current.get(
        connectionId
      );

    if (existing) {

      return existing;

    }


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
    // ICE candidate
    // ----------------------------------------------------------

    peerConnection.onicecandidate =
      (event) => {

        if (
          event.candidate
        ) {

          sendWebRTCSignal(
            connectionId,
            {
              candidate:
                event.candidate
            }
          );

        }

      };


    // ----------------------------------------------------------
    // Connection state
    // ----------------------------------------------------------

    peerConnection.onconnectionstatechange =
      () => {

        console.log(
          `WebRTC state ${connectionId}:`,
          peerConnection.connectionState
        );


        if (
          [
            'failed',
            'closed',
            'disconnected'
          ].includes(
            peerConnection.connectionState
          )
        ) {

          closePeerConnection(
            connectionId
          );

        }

      };


    peerConnectionsRef.current.set(
      connectionId,
      peerConnection
    );


    return peerConnection;

  };


  // ============================================================
  // CAPTURE SCREEN (asks the browser ONCE)
  // ============================================================

  const captureScreen = async () => {

    const stream =
      await navigator.mediaDevices.getDisplayMedia({

        video: {
          cursor: 'always'
        },

        audio: false

      });

    screenStreamRef.current =
      stream;

    setScreenSharing(
      true
    );

    // Browser's own "Stop sharing" control was used - clean up
    // so we know to re-capture before the next connection.
    stream
      .getVideoTracks()[0]
      .addEventListener(
        'ended',
        () => {

          screenStreamRef.current =
            null;

          setScreenSharing(
            false
          );

          setSharingConnectionId(
            null
          );

        }
      );

    return stream;

  };


  // ============================================================
  // SHARE THE ALREADY-CAPTURED STREAM WITH A CONNECTION
  // No new browser prompt - reuses screenStreamRef.current, so
  // this can run automatically for every new (auto-approved)
  // connection without any host click.
  // ============================================================

  const shareStreamWithConnection = async (
    connectionId
  ) => {

    const stream =
      screenStreamRef.current;

    if (!stream) {
      return;
    }

    setSharingConnectionId(
      connectionId
    );

    const peerConnection =
      createPeerConnection(
        connectionId
      );

    stream
      .getTracks()
      .forEach(track => {

        peerConnection.addTrack(
          track,
          stream
        );

      });

    const offer =
      await peerConnection.createOffer({

        offerToReceiveVideo:
          false

      });

    await peerConnection.setLocalDescription(
      offer
    );

    sendWebRTCSignal(
      connectionId,
      {
        type:
          'offer',

        sdp:
          offer.sdp
      }
    );

    console.log(
      '🖥️ Sharing existing screen stream with',
      connectionId
    );

  };


  // ============================================================
  // START SCREEN SHARING (manual fallback button - captures +
  // shares in one go, for when no stream is active yet)
  // ============================================================

  const startScreenSharing = async (
    connectionId
  ) => {

    try {

      setError('');

      if (!screenStreamRef.current) {
        await captureScreen();
      }

      if (connectionId) {
        await shareStreamWithConnection(connectionId);
      }

      console.log(
        '🖥️ Screen sharing started'
      );

    } catch (err) {

      console.error(
        'Screen sharing error:',
        err
      );

      setError(
        'Screen sharing failed: ' +
        err.message
      );

      setScreenSharing(
        false
      );

    }

  };


  // ============================================================
  // WEBRTC SIGNAL HANDLER
  // ============================================================

  const handleWebRTCSignal = async (
    message
  ) => {

    const connectionId =
      message.connection_id;

    const data =
      message.data;


    if (!connectionId || !data) {
      return;
    }


    const peerConnection =
      createPeerConnection(
        connectionId
      );


    // ----------------------------------------------------------
    // ANSWER FROM REMOTE
    // ----------------------------------------------------------

    if (
      data.type ===
      'answer'
    ) {

      await peerConnection.setRemoteDescription({

        type:
          'answer',

        sdp:
          data.sdp

      });

      console.log(
        '✅ Remote answer received'
      );

    }


    // ----------------------------------------------------------
    // ICE CANDIDATE FROM REMOTE
    // ----------------------------------------------------------

    else if (
      data.candidate
    ) {

      try {

        await peerConnection.addIceCandidate(
          data.candidate
        );

      } catch (err) {

        console.error(
          'ICE candidate error:',
          err
        );

      }

    }

  };


  // ============================================================
  // STOP SCREEN SHARING
  // ============================================================

  const stopScreenSharing = (
    connectionId
  ) => {

    const stream =
      screenStreamRef.current;


    if (stream) {

      stream
        .getTracks()
        .forEach(track => {

          track.stop();

        });

      screenStreamRef.current =
        null;

    }


    const peerConnection =
      peerConnectionsRef.current.get(
        connectionId
      );


    if (peerConnection) {

      peerConnection.close();

      peerConnectionsRef.current.delete(
        connectionId
      );

    }


    if (
      websocketRef.current &&
      websocketRef.current.readyState ===
      WebSocket.OPEN
    ) {

      websocketRef.current.send(
        JSON.stringify({

          type:
            'screen_share_stopped',

          connection_id:
            connectionId

        })
      );

    }


    setScreenSharing(
      false
    );

    setSharingConnectionId(
      null
    );


    console.log(
      '🛑 Screen sharing stopped'
    );

  };


  // ============================================================
  // CLOSE PEER CONNECTION
  // ============================================================

  const closePeerConnection = (
    connectionId
  ) => {

    const peerConnection =
      peerConnectionsRef.current.get(
        connectionId
      );


    if (peerConnection) {

      peerConnection.close();

      peerConnectionsRef.current.delete(
        connectionId
      );

    }


    if (
      sharingConnectionId ===
      connectionId
    ) {

      stopScreenSharing(
        connectionId
      );

    }

  };


  // ============================================================
  // TERMINATE SESSION
  // ============================================================

  const handleTerminateSession =
    async () => {

      if (!session) {
        return;
      }


      setLoading(true);

      try {

        // Stop sharing first

        if (
          screenSharing &&
          sharingConnectionId
        ) {

          stopScreenSharing(
            sharingConnectionId
          );

        }


        // Close all peers

        peerConnectionsRef.current
          .forEach(
            (_, connectionId) => {

              closePeerConnection(
                connectionId
              );

            }
          );


        await terminateSession(
          session.session_id
        );


        setSession(
          null
        );

        setConnections(
          []
        );


      } catch (err) {

        setError(
          'Failed to terminate session: ' +
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
  // CONNECTION UPDATE
  // ============================================================

  const handleConnectionUpdate = (
    connectionData
  ) => {

    if (
      Array.isArray(connectionData)
    ) {

      setConnections(
        connectionData
      );

      return;

    }


    setConnections(prev => {

      const index =
        prev.findIndex(
          c =>
            c.connection_id ===
            connectionData.connection_id
        );


      if (index === -1) {

        return [
          ...prev,
          connectionData
        ];

      }


      const updated =
        [...prev];

      updated[index] = {
        ...updated[index],
        ...connectionData
      };

      return updated;

    });

  };


  // ============================================================
  // CLEANUP
  // ============================================================

  useEffect(() => {

    return () => {

      if (
        screenStreamRef.current
      ) {

        screenStreamRef.current
          .getTracks()
          .forEach(
            track =>
              track.stop()
          );

      }


      peerConnectionsRef.current
        .forEach(
          peer =>
            peer.close()
        );

      peerConnectionsRef.current.clear();

    };

  }, []);


  // ============================================================
  // UI
  // ============================================================

  return (

    <div className="host-dashboard">

      <div className="grid-2">

        {/* ================================================== */}
        {/* SESSION CREATOR */}
        {/* ================================================== */}

        <div className="card">

          <SessionCreator
            onCreateSession={
              handleCreateSession
            }
            loading={
              loading
            }
          />

        </div>


        {/* ================================================== */}
        {/* SESSION STATUS */}
        {/* ================================================== */}

        <div className="card">

          <h2>
            📊 Session Status
          </h2>


          {session ? (

            <div>

              <div className="session-info">

                <p>
                  <strong>
                    Session ID:
                  </strong>{' '}

                  {session.session_id}

                </p>


                <p>
                  <strong>
                    Name:
                  </strong>{' '}

                  {session.session_name}

                </p>


                <p>
                  <strong>
                    Status:
                  </strong>{' '}

                  <span
                    className={
                      `status ${session.status}`
                    }
                  >
                    {session.status}
                  </span>

                </p>


                <p>
                  <strong>
                    Expires:
                  </strong>{' '}

                  {
                    new Date(
                      session.expires_at
                    ).toLocaleString()
                  }

                </p>

              </div>


              {/* QR CODE */}

              {session.qr_code && (

                <div className="qr-container">

                  <h3>
                    📱 Scan to Connect
                  </h3>


                  <img
                    src={
                      session.qr_code
                    }
                    alt="QR Code"
                  />


                  <p
                    style={{
                      fontSize:
                        '12px',

                      color:
                        '#666'
                    }}
                  >
                    Session:{' '}
                    {session.session_id}
                  </p>

                </div>

              )}


              <SessionControls
                onTerminate={
                  handleTerminateSession
                }
                loading={
                  loading
                }
              />

            </div>

          ) : (

            <p
              style={{
                color:
                  '#999',

                margin:
                  '40px 0'
              }}
            >
              No active session.
              Create one to start!
            </p>

          )}

        </div>

      </div>


      {/* ==================================================== */}
      {/* CONNECTED USERS (auto-approved - no action needed)   */}
      {/* ==================================================== */}

      {session && (

        <div className="card">

          {/* ================================================= */}
          {/* CONNECTED USERS */}
          {/* ================================================= */}

          {connections
            .filter(
              connection =>
                connection.status ===
                'approved'
            )
            .map(
              connection => (

                <div
                  key={
                    connection.connection_id
                  }

                  style={{
                    marginTop:
                      '20px',

                    padding:
                      '20px',

                    background:
                      '#f8f9fa',

                    borderRadius:
                      '10px',

                    border:
                      '1px solid #ddd'
                  }}
                >

                  <h3>
                    🖥️ Remote Connection
                  </h3>


                  <p>
                    <strong>
                      User:
                    </strong>{' '}

                    {
                      connection.remote_user
                    }

                  </p>


                  <p>
                    <strong>
                      Connection:
                    </strong>{' '}

                    {
                      connection.connection_id
                    }

                  </p>


                  {/* ======================================= */}
                  {/* SCREEN SHARING */}
                  {/* ======================================= */}

                  {!screenSharing ? (

                    <button
                      onClick={() =>
                        startScreenSharing(
                          connection.connection_id
                        )
                      }

                      style={{
                        padding:
                          '12px 20px',

                        border:
                          'none',

                        borderRadius:
                          '8px',

                        background:
                          '#4f6bed',

                        color:
                          'white',

                        cursor:
                          'pointer',

                        fontSize:
                          '16px',

                        marginTop:
                          '10px'
                      }}
                    >
                      🖥️ Start Screen Sharing
                    </button>

                  ) : (

                    <button
                      onClick={() =>
                        stopScreenSharing(
                          connection.connection_id
                        )
                      }

                      style={{
                        padding:
                          '12px 20px',

                        border:
                          'none',

                        borderRadius:
                          '8px',

                        background:
                          '#e74c3c',

                        color:
                          'white',

                        cursor:
                          'pointer',

                        fontSize:
                          '16px',

                        marginTop:
                          '10px'
                      }}
                    >
                      🛑 Stop Screen Sharing
                    </button>

                  )}


                  {sharingConnectionId ===
                    connection.connection_id &&
                    screenSharing && (

                    <p
                      style={{
                        color:
                          '#27ae60',

                        marginTop:
                          '10px'
                      }}
                    >
                      🟢 Screen is being
                      shared with this user.
                    </p>

                  )}

                </div>

              )
            )}

        </div>

      )}


      {/* ==================================================== */}
      {/* ERROR */}
      {/* ==================================================== */}

      {error && (

        <div
          className="card"

          style={{
            background:
              '#fee',

            color:
              '#c0392b'
          }}
        >

          <p>
            ❌ {error}
          </p>

        </div>

      )}

    </div>

  );

}


export default HostDashboard;