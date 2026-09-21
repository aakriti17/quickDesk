import React, { useState } from 'react';
import './App.css';

import HostDashboard from './components/Host/HostDashboard';
import RemoteScanner from './components/Remote/RemoteScanner';

function App() {
  const [mode, setMode] = useState('host');

  // Opened straight from a scanned QR code
  // (http://<host-ip>:3000/connect?session=...&token=...):
  // show just the connect flow, no Host/Remote tabs to confuse
  // someone who is just trying to get remote support.
  const isDirectConnectLink =
    window.location.pathname === '/connect';

  if (isDirectConnectLink) {

    return (
      <div className="App">
        <header className="App-header">
          <h1>🖥️ QuickDesk</h1>
        </header>

        <main className="App-content">
          <RemoteScanner />
        </main>
      </div>
    );

  }

  return (
    <div className="App">
      <header className="App-header">
        <h1>🖥️ QuickDesk</h1>

        <div className="mode-buttons">
          <button
            className={mode === 'host' ? 'active' : ''}
            onClick={() => setMode('host')}
          >
            🖥️ Host
          </button>

          <button
            className={mode === 'remote' ? 'active' : ''}
            onClick={() => setMode('remote')}
          >
            📱 Remote User
          </button>
        </div>
      </header>

      <main className="App-content">
        {mode === 'host' ? (
          <HostDashboard />
        ) : (
          <RemoteScanner />
        )}
      </main>
    </div>
  );
}

export default App;