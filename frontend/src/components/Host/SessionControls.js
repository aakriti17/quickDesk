import React from 'react';

function SessionControls({ onTerminate, loading }) {
  return (
    <div className="session-controls">
      <button
        className="btn-danger"
        onClick={onTerminate}
        disabled={loading}
        style={{ width: '100%', marginTop: '10px' }}
      >
        🛑 Terminate Session
      </button>
    </div>
  );
}

export default SessionControls;