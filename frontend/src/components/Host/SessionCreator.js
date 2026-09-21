import React, { useState } from 'react';

function SessionCreator({ onCreateSession, loading }) {
  const [sessionName, setSessionName] = useState('');
  const [expiryMinutes, setExpiryMinutes] = useState(5);
  const [permissions, setPermissions] = useState({
    screen_sharing: true,
    mouse_control: true,
    keyboard_control: false,
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onCreateSession({
      session_name: sessionName || `Session-${Date.now()}`,
      expiry_minutes: expiryMinutes,
      permissions: permissions,
    });
  };

  const inputStyle = {
    width: '100%',
    padding: '10px',
    margin: '10px 0',
    border: '1px solid #ddd',
    borderRadius: '5px',
    fontSize: '16px',
    boxSizing: 'border-box',
  };

  const checkboxGrid = {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '5px',
    margin: '10px 0',
    textAlign: 'left',
  };

  const checkboxLabel = {
    display: 'flex',
    alignItems: 'center',
    gap: '5px',
    fontSize: '14px',
  };

  return (
    <div className="session-creator">
      <h2>🆕 Create Session</h2>
      <form onSubmit={handleSubmit}>
        <div>
          <label style={{ display: 'block', textAlign: 'left', fontWeight: 'bold' }}>
            Session Name:
          </label>
          <input
            type="text"
            value={sessionName}
            onChange={(e) => setSessionName(e.target.value)}
            placeholder="Enter session name"
            style={inputStyle}
          />
        </div>

        <div>
          <label style={{ display: 'block', textAlign: 'left', fontWeight: 'bold' }}>
            Expiry (minutes):
          </label>
          <input
            type="number"
            value={expiryMinutes}
            onChange={(e) => setExpiryMinutes(parseInt(e.target.value))}
            min="1"
            max="60"
            style={inputStyle}
          />
        </div>

        <div>
          <label style={{ display: 'block', textAlign: 'left', fontWeight: 'bold' }}>
            Permissions:
          </label>
          <div style={checkboxGrid}>
            {Object.entries(permissions).map(([key, value]) => (
              <label key={key} style={checkboxLabel}>
                <input
                  type="checkbox"
                  checked={value}
                  onChange={() => setPermissions(prev => ({
                    ...prev,
                    [key]: !prev[key]
                  }))}
                />
                {key.replace('_', ' ').toUpperCase()}
              </label>
            ))}
          </div>
        </div>

        <button 
          type="submit" 
          className="btn-primary"
          disabled={loading}
          style={{ width: '100%' }}
        >
          {loading ? 'Creating...' : '🚀 Create Session'}
        </button>
      </form>
    </div>
  );
}

export default SessionCreator;