import React, { useState, useEffect } from 'react';
import { approveConnection, getSessionStatus } from '../../services/api';

function ConnectionRequests({ sessionId, connections, onConnectionUpdate }) {
  const [pendingRequests, setPendingRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!sessionId) return;

    let isMounted = true;

    const fetchRequests = async () => {
      try {
        setChecking(true);

        const response = await getSessionStatus(sessionId);

        console.log('🔍 Session status response:', response);

        // Backend returns:
        // {
        //   success: true,
        //   session: {
        //      ...
        //      connections: [...]
        //   }
        // }

        const backendConnections =
          response?.session?.connections || [];

        console.log('🔗 Backend connections:', backendConnections);

        if (isMounted) {
          setPendingRequests(
            backendConnections.filter(
              (connection) => connection.status === 'pending'
            )
          );

          // Send complete connection list to parent
          if (onConnectionUpdate) {
            onConnectionUpdate(backendConnections);
          }
        }
      } catch (error) {
        console.error(
          '❌ Error fetching connection requests:',
          error
        );
      } finally {
        if (isMounted) {
          setChecking(false);
        }
      }
    };

    // Fetch immediately
    fetchRequests();

    // Check every 2 seconds
    const interval = setInterval(fetchRequests, 2000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [sessionId, onConnectionUpdate]);

  const handleApprove = async (connectionId) => {
    setLoading(true);

    try {
      const response = await approveConnection(
        sessionId,
        connectionId,
        true
      );

      console.log('✅ Approve response:', response);

      // Update UI immediately
      setPendingRequests((prev) =>
        prev.filter(
          (request) => request.connection_id !== connectionId
        )
      );

      // Refresh from backend
      const statusResponse = await getSessionStatus(sessionId);

      const updatedConnections =
        statusResponse?.session?.connections || [];

      if (onConnectionUpdate) {
        onConnectionUpdate(updatedConnections);
      }
    } catch (error) {
      console.error('❌ Error approving connection:', error);

      alert(
        'Failed to approve connection: ' +
          (error.response?.data?.detail || error.message)
      );
    } finally {
      setLoading(false);
    }
  };

  const handleReject = async (connectionId) => {
    setLoading(true);

    try {
      const response = await approveConnection(
        sessionId,
        connectionId,
        false
      );

      console.log('❌ Reject response:', response);

      // Remove from pending UI
      setPendingRequests((prev) =>
        prev.filter(
          (request) => request.connection_id !== connectionId
        )
      );

      // Refresh from backend
      const statusResponse = await getSessionStatus(sessionId);

      const updatedConnections =
        statusResponse?.session?.connections || [];

      if (onConnectionUpdate) {
        onConnectionUpdate(updatedConnections);
      }
    } catch (error) {
      console.error('❌ Error rejecting connection:', error);

      alert(
        'Failed to reject connection: ' +
          (error.response?.data?.detail || error.message)
      );
    } finally {
      setLoading(false);
    }
  };

  const requestCard = {
    background: '#f8f9fa',
    borderRadius: '8px',
    padding: '15px',
    margin: '10px 0',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
  };

  const requestInfo = {
    textAlign: 'left',
  };

  const buttonGroup = {
    display: 'flex',
    gap: '10px',
  };

  return (
    <div className="connection-requests">
      <h2>🔗 Connection Requests</h2>

      {checking && pendingRequests.length === 0 && (
        <p style={{ color: '#999' }}>
          🔄 Checking for new requests...
        </p>
      )}

      {!checking && pendingRequests.length === 0 && (
        <p style={{ color: '#999' }}>
          No pending connection requests
        </p>
      )}

      {pendingRequests.length > 0 && (
        <div>
          {pendingRequests.map((request) => (
            <div
              key={request.connection_id}
              style={requestCard}
            >
              <div style={requestInfo}>
                <p>
                  <strong>User:</strong>{' '}
                  {request.remote_user || 'Anonymous'}
                </p>

                <p>
                  <strong>Connection ID:</strong>{' '}
                  {request.connection_id}
                </p>

                <p>
                  <strong>Requested:</strong>{' '}
                  {request.requested_at
                    ? new Date(
                        request.requested_at
                      ).toLocaleString()
                    : 'Unknown'}
                </p>

                <p>
                  <strong>Status:</strong>{' '}
                  <span style={{ color: '#f39c12' }}>
                    {request.status}
                  </span>
                </p>
              </div>

              <div style={buttonGroup}>
                <button
                  className="btn-success"
                  onClick={() =>
                    handleApprove(request.connection_id)
                  }
                  disabled={loading}
                >
                  {loading ? '⏳' : '✅'} Approve
                </button>

                <button
                  className="btn-danger"
                  onClick={() =>
                    handleReject(request.connection_id)
                  }
                  disabled={loading}
                >
                  {loading ? '⏳' : '❌'} Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default ConnectionRequests;